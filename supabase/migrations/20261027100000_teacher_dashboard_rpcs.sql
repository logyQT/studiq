-- ==========================================
-- Teacher dashboard (#654, ROADMAP 3D)
--
-- `/edu` showed two counts. The dashboard adds two aggregates, both written in SQL because
-- they span every learner of the teacher's groups and PostgREST would cut the rows at 1000:
--
--   * get_teacher_group_performance: per group of the caller, the number of learners, the
--     completed quiz / assignment attempts in a window, their average score and the
--     flashcard accuracy of the same learners.
--   * get_teacher_activity_feed: the latest completed attempts of those learners and the open
--     question reports addressed to the caller, newest first.
--
-- Scope (the same rule `get_teacher_stats` uses for its roster): learners are the `member`
-- rows of the groups of the active organization that also contain the caller; the caller is
-- never counted as a learner. The caller's own practice never inflates a number.
--
-- SECURITY DEFINER because teachers cannot read other users' `flashcard_practice` rows through
-- RLS. It therefore must not trust its arguments: only the caller's own dashboard (or the
-- service role) may aggregate, and an organization the caller does not belong to yields an
-- empty result instead of a tenant oracle.
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_teacher_group_performance(
  p_user_id uuid,
  p_organization_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  v_since timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 30), 365)));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_teacher_group_performance may only be called for the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_organization_id NOT IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c) THEN
      RETURN '[]'::jsonb;
    END IF;
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH my_groups AS (
    SELECT g.id, g.name
    FROM public.groups g
    WHERE g.organization_id = p_organization_id
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.user_id = p_user_id
      )
  ),
  learners AS (
    SELECT DISTINCT mg.id AS group_id, gm.user_id
    FROM my_groups mg
    JOIN public.group_members gm ON gm.group_id = mg.id
    WHERE gm.role = 'member'
      AND gm.user_id <> p_user_id
  ),
  learner_counts AS (
    SELECT group_id, COUNT(*)::int AS students
    FROM learners
    GROUP BY group_id
  ),
  attempts AS (
    SELECT
      l.group_id,
      -- Assignment attempts score in awarded points, practice quizzes in correct answers:
      -- every attempt is normalised to its own scale before averaging (see stats.service).
      LEAST(100, GREATEST(0,
        COALESCE(qa.score, 0) * 100.0
          / GREATEST(COALESCE(qa.total_points, qa.total_questions, 0), 1)
      )) AS pct
    FROM learners l
    JOIN public.quiz_attempts qa ON qa.user_id = l.user_id
    WHERE qa.completed_at IS NOT NULL
      AND qa.completed_at >= v_since
  ),
  attempt_stats AS (
    SELECT group_id, COUNT(*)::int AS completed, ROUND(AVG(pct))::int AS avg_pct
    FROM attempts
    GROUP BY group_id
  ),
  review_stats AS (
    SELECT
      l.group_id,
      COUNT(*)::int AS reviews,
      ROUND(COUNT(*) FILTER (WHERE fp.was_correct) * 100.0 / COUNT(*))::int AS accuracy
    FROM learners l
    JOIN public.flashcard_practice fp ON fp.user_id = l.user_id
    WHERE fp.practiced_at >= v_since
    GROUP BY l.group_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'groupId', mg.id,
        'groupName', mg.name,
        'students', COALESCE(lc.students, 0),
        'completedAttempts', COALESCE(ast.completed, 0),
        -- NULL (not 0) when nothing was completed: "no data" is not "0 %".
        'avgScore', ast.avg_pct,
        'flashcardReviews', COALESCE(rs.reviews, 0),
        'flashcardAccuracy', rs.accuracy
      )
      ORDER BY mg.name
    ),
    '[]'::jsonb
  )
  INTO result
  FROM my_groups mg
  LEFT JOIN learner_counts lc ON lc.group_id = mg.id
  LEFT JOIN attempt_stats ast ON ast.group_id = mg.id
  LEFT JOIN review_stats rs ON rs.group_id = mg.id;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_activity_feed(
  p_user_id uuid,
  p_organization_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_teacher_activity_feed may only be called for the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_organization_id NOT IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c) THEN
      RETURN '[]'::jsonb;
    END IF;
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH learners AS (
    SELECT DISTINCT gm.user_id
    FROM public.groups g
    JOIN public.group_members gm ON gm.group_id = g.id
    WHERE g.organization_id = p_organization_id
      AND gm.role = 'member'
      AND gm.user_id <> p_user_id
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.user_id = p_user_id
      )
  ),
  events AS (
    (
      SELECT
        CASE WHEN qa.assignment_id IS NOT NULL THEN 'assignment_submitted' ELSE 'quiz_completed' END AS kind,
        qa.completed_at AS at,
        qa.user_id AS person_id,
        qa.assignment_id AS assignment_id,
        COALESCE(ta.title, qa.config->>'title') AS title,
        LEAST(100, GREATEST(0,
          COALESCE(qa.score, 0) * 100.0
            / GREATEST(COALESCE(qa.total_points, qa.total_questions, 0), 1)
        ))::int AS score_pct,
        (qa.assignment_id IS NOT NULL AND qa.graded_at IS NULL) AS needs_grading,
        NULL::uuid AS question_id
      FROM learners l
      JOIN public.quiz_attempts qa ON qa.user_id = l.user_id
      LEFT JOIN public.teacher_assignments ta ON ta.id = qa.assignment_id
      WHERE qa.completed_at IS NOT NULL
      ORDER BY qa.completed_at DESC
      LIMIT v_limit
    )
    UNION ALL
    (
      SELECT
        'report_opened',
        qr.created_at,
        qr.reported_by,
        NULL::uuid,
        LEFT(q.content, 120),
        NULL::int,
        false,
        qr.question_id
      FROM public.question_reports qr
      LEFT JOIN public.questions q ON q.id = qr.question_id
      WHERE qr.teacher_id = p_user_id
        AND qr.organization_id = p_organization_id
        AND qr.status = 'open'
      ORDER BY qr.created_at DESC
      LIMIT v_limit
    )
  ),
  newest AS (
    SELECT * FROM events ORDER BY at DESC LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'kind', n.kind,
        'at', n.at,
        'personName', COALESCE(NULLIF(p.full_name, ''), split_part(p.email, '@', 1)),
        'title', n.title,
        'scorePct', n.score_pct,
        'needsGrading', n.needs_grading,
        'assignmentId', n.assignment_id,
        'questionId', n.question_id
      )
      ORDER BY n.at DESC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM newest n
  LEFT JOIN public.profiles p ON p.id = n.person_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_group_performance(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_group_performance(uuid, uuid, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_teacher_activity_feed(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_activity_feed(uuid, uuid, integer)
  TO authenticated, service_role;
