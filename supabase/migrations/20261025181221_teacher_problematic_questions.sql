-- ==========================================
-- Issue #204 (EDU-ST-02): „Problematyczne pytania” never listed a question.
--
-- The subjects removal (5cd167a3) deleted `QuestionService.getStatsBySubject`,
-- but `/edu/stats/results` and `/edu/statistics` kept reading
-- `data.subject.problematicQuestions`. The endpoint never produced that field,
-- so the card always fell back to its empty state — even for a question
-- answered correctly 2/5 times (40 %).
--
-- The per-question accuracy is aggregated here instead of in Node because the
-- answer volume is per-class, not per-teacher: loading `student_answers` rows
-- through PostgREST hits the 1000-row cap and would silently understate the
-- sample.
--
-- Two rules matter:
--   * one answer per (attempt, question): multi-select / matching store one row
--     per atomic option, so counting rows would weight a question by how many
--     options a student touched. `bool_or(is_correct)` mirrors
--     `quiz-attempt.service.submit`, which awards points when any row is right.
--   * `open` questions are excluded: an ungraded free-text row has
--     `is_correct = false`, so including it would report every pending
--     short-answer question as 0 % (a new false positive).
--
-- SECURITY INVOKER: RLS on `questions` / `student_answers` / `quiz_attempts`
-- stays the floor for user-session calls. The accompanying `visible_students`
-- / org filters are explicit because the same RPC is also called by the
-- service-role client (backend, integration tests), which bypasses RLS.
-- ==========================================

-- The aggregation filters `student_answers` by question; only an attempt_id
-- index existed, so every stats request would scan the table.
CREATE INDEX IF NOT EXISTS idx_student_answers_question
  ON public.student_answers(question_id);

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
    SELECT q.id, q.type::text AS type, q.content
    FROM public.questions q
    WHERE q.created_by = p_user_id
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
