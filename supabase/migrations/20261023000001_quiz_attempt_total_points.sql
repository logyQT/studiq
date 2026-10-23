-- ==========================================
-- Assignment attempts are scored in points, not in correct-answer counts.
--
-- Before this migration `quiz_attempts.score` held the number of correct
-- answers and `total_questions` the number of questions, so a submitted
-- kartkówka showed e.g. "1/4" while the teacher's card showed "5 pkt", and
-- manually graded points (`student_answers.teacher_points`) never reached the
-- attempt's score at all (issue #167).
--
-- New semantics:
--   * assignment attempts: `score` = awarded points, `total_points` = the
--     assignment's max points snapshot taken when the attempt starts.
--   * practice quizzes: unchanged (`score` = correct-answer count,
--     `total_points` NULL → consumers fall back to `total_questions`).
-- ==========================================

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS total_points int;

COMMENT ON COLUMN public.quiz_attempts.total_points IS
  'Max awardable points for assignment attempts; NULL for practice quizzes (count-based scoring).';

-- Snapshot the assignment scale for attempts created before this migration.
UPDATE public.quiz_attempts AS qa
SET total_points = ta.total_points
FROM public.teacher_assignments AS ta
WHERE qa.assignment_id = ta.id
  AND qa.total_points IS NULL;

-- Repair attempts graded before this fix: recompute awarded points from the
-- persisted answers (manual teacher points win over auto correctness).
-- Answers are deduplicated per question because multi-select / matching
-- questions store one `student_answers` row per selected unit.
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
