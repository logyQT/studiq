-- ==========================================
-- Issue #654: a problem-question alert links to its question.
--
-- `get_teacher_problematic_questions` (20261025181221) is replaced with two
-- changes: each row carries `bankId`, the only way to address a question, and
-- soft-deleted questions are left out, because the bank no longer shows them.
-- Everything else is unchanged.
--
-- Deploy this before the app: the app requires `bankId` and shows an empty
-- list without it, while the previous app ignores the extra key.
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_teacher_problematic_questions(
  p_user_id uuid,
  p_organization_id uuid DEFAULT NULL,
  p_bank_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Same guard style as get_teacher_stats: never a cross-teacher oracle.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'get_teacher_problematic_questions may only be called for the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  WITH scoped_questions AS (
    SELECT q.id, q.type::text AS type, q.content, q.bank_id
    FROM public.questions q
    WHERE q.created_by = p_user_id
      -- Deletion is soft, and a deleted question is gone from its bank (#1171).
      AND q.status <> 'deleted'
      AND (p_organization_id IS NULL OR q.organization_id = p_organization_id)
      -- Same scope as the ?subjectId= type split in stats.service.
      AND (p_bank_id IS NULL OR q.bank_id = p_bank_id)
  ),
  -- Learners (`member` role) of an org the caller belongs to — the active org
  -- when one is set. Written out explicitly so the service-role path is
  -- tenant-safe without relying on RLS, and so teachers' own practice attempts
  -- cannot inflate the numbers.
  visible_students AS (
    SELECT DISTINCT om.user_id
    FROM public.org_members om
    JOIN public.org_roles r ON r.id = om.org_role_id
    WHERE r.name = 'member'
      AND om.organization_id IN (
        SELECT mine.organization_id
        FROM public.org_members mine
        WHERE mine.user_id = p_user_id
          AND (p_organization_id IS NULL OR mine.organization_id = p_organization_id)
      )
  ),
  attempt_answers AS (
    SELECT sa.question_id, sa.attempt_id, bool_or(sa.is_correct) AS was_correct
    FROM public.student_answers sa
    JOIN public.quiz_attempts qa ON qa.id = sa.attempt_id
    JOIN scoped_questions sq ON sq.id = sa.question_id
    WHERE qa.completed_at IS NOT NULL
      AND qa.user_id IS DISTINCT FROM p_user_id
      AND qa.user_id IN (SELECT user_id FROM visible_students)
    GROUP BY sa.question_id, sa.attempt_id
  ),
  answer_stats AS (
    SELECT question_id,
           COUNT(*)::int AS total_answers,
           COUNT(*) FILTER (WHERE was_correct)::int AS correct_answers
    FROM attempt_answers
    GROUP BY question_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sq.id,
        'content', sq.content,
        'type', sq.type,
        'bankId', sq.bank_id,
        -- 0..1 fraction: the UI renders Math.round(correctRate * 100).
        'correctRate', ROUND(st.correct_answers::numeric / st.total_answers, 4),
        'totalAnswers', st.total_answers
      )
      ORDER BY st.correct_answers::numeric / st.total_answers ASC, sq.content ASC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM scoped_questions sq
  JOIN answer_stats st ON st.question_id = sq.id
  WHERE sq.type <> 'open'
    AND st.correct_answers::numeric / st.total_answers < 0.5;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_problematic_questions(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_problematic_questions(uuid, uuid, uuid)
  TO authenticated, service_role;
