-- ==========================================
-- Manual grading must stay within the question's maximum — #169
--
-- `gradeAnswer` validated only the lower bound (Zod `min(0)`), so a teacher
-- could award e.g. 5 points on a 2-point question. The value was persisted to
-- `student_answers.teacher_points` and summed into `quiz_attempts.score`,
-- inflating the result. The service now rejects `points > points` per
-- assignment question; this migration repairs the rows written before it.
-- ==========================================

-- 1) Clamp manual points to the question's current maximum.
UPDATE public.student_answers AS sa
SET teacher_points = aq.points
FROM public.quiz_attempts AS qa
JOIN public.assignment_questions AS aq
  ON aq.assignment_id = qa.assignment_id
WHERE sa.attempt_id = qa.id
  AND qa.assignment_id IS NOT NULL
  AND aq.question_id = sa.question_id
  AND sa.teacher_points > aq.points;

-- 2) Recompute awarded points for assignment attempts, with the same rule as
--    `computeAttemptScore` (manual teacher points win over auto correctness,
--    answers deduplicated per question). Mirrors
--    20261023233127_quiz_attempt_total_points.sql; idempotent.
WITH per_question AS (
  SELECT qa.assignment_id,
         sa.attempt_id,
         sa.question_id,
         MAX(sa.teacher_points) AS teacher_points,
         BOOL_OR(sa.is_correct) AS is_correct
  FROM public.student_answers AS sa
  JOIN public.quiz_attempts AS qa ON qa.id = sa.attempt_id
  WHERE qa.assignment_id IS NOT NULL
  GROUP BY qa.assignment_id, sa.attempt_id, sa.question_id
),
scored AS (
  SELECT pq.attempt_id,
         SUM(
           CASE
             WHEN pq.teacher_points IS NOT NULL THEN pq.teacher_points
             WHEN pq.is_correct THEN COALESCE(aq.points, 0)
             ELSE 0
           END
         )::int AS points
  FROM per_question AS pq
  LEFT JOIN public.assignment_questions AS aq
    ON aq.assignment_id = pq.assignment_id
   AND aq.question_id = pq.question_id
  GROUP BY pq.attempt_id
)
UPDATE public.quiz_attempts AS qa
SET score = scored.points
FROM scored
WHERE qa.id = scored.attempt_id;
