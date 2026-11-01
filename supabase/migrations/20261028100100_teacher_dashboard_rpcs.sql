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
-- Organization isolation (operator decision A2): only attempts and reviews STAMPED with this
-- organization count (see 20261028100000_activity_organization.sql). A learner who also belongs
-- to another organization contributes nothing from there, and rows that belong to no
-- organization (personal resources) are in no aggregate.
--
-- Numbers: the totals count each learner and each attempt once, never the sum of the group rows
-- (a learner in two groups is one learner). An assignment submission waits for a mark when it has
-- an `open` answer to mark, when its still-linked assignment contains an `open` question, or when
-- it has no answers at all; an auto-scored MCQ submission is final and enters the average.
--
-- SECURITY DEFINER so the dashboard can aggregate every learner of the caller's groups in one
-- query: same-org reads now cover `flashcard_practice`, but the PostgREST row cap does not go
-- away. It therefore must not trust its arguments: only the caller's own dashboard (or the
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
      RETURN '{"groups": [], "totals": {"students": 0, "completedAttempts": 0, "awaitingGrade": 0}}'::jsonb;
    END IF;

    IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '')
       NOT IN ('educator', 'manager') THEN
      RETURN '{"groups": [], "totals": {"students": 0, "completedAttempts": 0, "awaitingGrade": 0}}'::jsonb;
    END IF;
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN '{"groups": [], "totals": {"students": 0, "completedAttempts": 0, "awaitingGrade": 0}}'::jsonb;
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
  learner_set AS (
    SELECT DISTINCT user_id FROM learners
  ),
  learner_counts AS (
    SELECT group_id, COUNT(*)::int AS students
    FROM learners
    GROUP BY group_id
  ),
  -- One row per completed attempt of this organization, however many groups its learner is in.
  attempt_rows AS (
    SELECT
      qa.id,
      qa.user_id,
      -- Assignment attempts score in awarded points, practice quizzes in correct answers:
      -- every attempt is normalised to its own scale before averaging (see stats.service).
      LEAST(100, GREATEST(0,
        COALESCE(qa.score, 0) * 100.0
          / GREATEST(COALESCE(qa.total_points, qa.total_questions, 0), 1)
      )) AS pct,
      -- `assignment_id` is ON DELETE SET NULL and a client can clear it; the durable marker
      -- `is_assignment_attempt` (trigger-preserved, #657) is what says this was an assignment.
      (
        qa.is_assignment_attempt
        AND qa.graded_at IS NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.student_answers sa WHERE sa.attempt_id = qa.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.student_answers sa
            LEFT JOIN public.questions q ON q.id = sa.question_id
            WHERE sa.attempt_id = qa.id
              AND COALESCE(
                sa.question_type::text,
                q.type::text,
                CASE WHEN sa.text_answer IS NOT NULL THEN 'open' END
              ) = 'open'
          )
          OR EXISTS (
            SELECT 1
            FROM public.assignment_questions aq
            JOIN public.questions q ON q.id = aq.question_id
            JOIN public.teacher_assignments assignment_org ON assignment_org.id = aq.assignment_id
            WHERE aq.assignment_id = qa.assignment_id
              AND assignment_org.organization_id = p_organization_id
              AND q.type = 'open'
          )
        )
      ) AS awaiting
    FROM learner_set ls
    JOIN public.quiz_attempts qa ON qa.user_id = ls.user_id
    WHERE qa.organization_id = p_organization_id
      AND qa.completed_at IS NOT NULL
      AND qa.completed_at >= v_since
  ),
  attempt_stats AS (
    SELECT
      l.group_id,
      COUNT(*)::int AS completed,
      COUNT(*) FILTER (WHERE ar.awaiting)::int AS awaiting,
      ROUND(AVG(ar.pct) FILTER (WHERE NOT ar.awaiting))::int AS avg_pct
    FROM learners l
    JOIN attempt_rows ar ON ar.user_id = l.user_id
    GROUP BY l.group_id
  ),
  review_rows AS (
    SELECT fp.user_id, fp.was_correct
    FROM learner_set ls
    JOIN public.flashcard_practice fp ON fp.user_id = ls.user_id
    WHERE fp.organization_id = p_organization_id
      AND fp.practiced_at >= v_since
  ),
  review_stats AS (
    SELECT
      l.group_id,
      COUNT(*)::int AS reviews,
      ROUND(COUNT(*) FILTER (WHERE rr.was_correct) * 100.0 / COUNT(*))::int AS accuracy
    FROM learners l
    JOIN review_rows rr ON rr.user_id = l.user_id
    GROUP BY l.group_id
  ),
  group_rows AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'groupId', mg.id,
          'groupName', mg.name,
          'students', COALESCE(lc.students, 0),
          'completedAttempts', COALESCE(ast.completed, 0),
          'awaitingGrade', COALESCE(ast.awaiting, 0),
          -- NULL (not 0) when nothing was graded: "no data" is not "0 %".
          'avgScore', ast.avg_pct,
          'flashcardReviews', COALESCE(rs.reviews, 0),
          'flashcardAccuracy', rs.accuracy
        )
        ORDER BY mg.name
      ),
      '[]'::jsonb
    ) AS data
    FROM my_groups mg
    LEFT JOIN learner_counts lc ON lc.group_id = mg.id
    LEFT JOIN attempt_stats ast ON ast.group_id = mg.id
    LEFT JOIN review_stats rs ON rs.group_id = mg.id
  )
  SELECT jsonb_build_object(
    'groups', (SELECT data FROM group_rows),
    'totals', jsonb_build_object(
      'students', (SELECT COUNT(*) FROM learner_set),
      'completedAttempts', (SELECT COUNT(*) FROM attempt_rows),
      'awaitingGrade', (SELECT COUNT(*) FROM attempt_rows WHERE awaiting)
    )
  )
  INTO result;

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

    IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '')
       NOT IN ('educator', 'manager') THEN
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
        -- The durable marker, not `assignment_id` (nullable, client-clearable) says what this was:
        -- `is_assignment_attempt` is preserved by its trigger (#657).
        CASE WHEN qa.is_assignment_attempt THEN 'assignment_submitted' ELSE 'quiz_completed' END AS kind,
        qa.completed_at AS at,
        qa.user_id AS person_id,
        -- The id and the title come from the assignment ONLY when it belongs to this organization:
        -- the stamp of the attempt alone must never surface a foreign assignment.
        ta.id AS assignment_id,
        -- A practice quiz keeps no title of its own (its config is the generator request): name it
        -- after its bank. NULL when there is nothing to show; the UI then drops the quoted title.
        COALESCE(ta.title, qa.config->>'title', qb.name) AS title,
        LEAST(100, GREATEST(0,
          COALESCE(qa.score, 0) * 100.0
            / GREATEST(COALESCE(qa.total_points, qa.total_questions, 0), 1)
        ))::int AS score_pct,
        (
          qa.is_assignment_attempt
          AND qa.graded_at IS NULL
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.student_answers sa WHERE sa.attempt_id = qa.id
            )
            OR EXISTS (
              SELECT 1
              FROM public.student_answers sa
              LEFT JOIN public.questions q ON q.id = sa.question_id
              WHERE sa.attempt_id = qa.id
                AND COALESCE(
                  sa.question_type::text,
                  q.type::text,
                  CASE WHEN sa.text_answer IS NOT NULL THEN 'open' END
                ) = 'open'
            )
            OR EXISTS (
              SELECT 1
              FROM public.assignment_questions aq
              JOIN public.questions q ON q.id = aq.question_id
              JOIN public.teacher_assignments assignment_org ON assignment_org.id = aq.assignment_id
              WHERE aq.assignment_id = qa.assignment_id
                AND assignment_org.organization_id = p_organization_id
                AND q.type = 'open'
            )
          )
        ) AS needs_grading,
        NULL::uuid AS question_id
      FROM learners l
      JOIN public.quiz_attempts qa ON qa.user_id = l.user_id
      LEFT JOIN public.teacher_assignments ta
        ON ta.id = qa.assignment_id AND ta.organization_id = p_organization_id
      LEFT JOIN public.question_banks qb
        ON qb.organization_id = p_organization_id
       AND qb.id = CASE
             WHEN qa.config->>'bankId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             THEN (qa.config->>'bankId')::uuid
           END
      WHERE qa.organization_id = p_organization_id
        AND qa.completed_at IS NOT NULL
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
      -- Mirrors the questions read policy within the scoped organization: a member may report any
      -- known question id, so the excerpt must not leak one outside their read scope. Group
      -- reports (question_id IS NULL) still show, with title NULL.
      LEFT JOIN public.questions q
        ON q.id = qr.question_id
       AND (q.created_by = p_user_id OR q.organization_id = p_organization_id)
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
  -- Mirrors the profiles read policy ("Own or same-org profile read"): SECURITY DEFINER bypasses
  -- RLS, so a client-chosen reporter id must not surface a foreign user's name.
  LEFT JOIN public.profiles p
    ON p.id = n.person_id
   AND (
     auth.role() = 'service_role'
     OR p.id = p_user_id
     OR p.id IN (SELECT c.user_id FROM public.rls_caller_org_user_ids() c)
   );

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
