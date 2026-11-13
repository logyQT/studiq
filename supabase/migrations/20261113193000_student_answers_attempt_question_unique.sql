-- ==========================================
-- student_answers: one row per question per attempt (#1066)
--
-- `submit` read `completed_at`, then updated the attempt and inserted the whole
-- answer sheet unconditionally, so two concurrent POSTs both passed the read and
-- both inserted. `awardedQuestions` kept the score honest, but the duplicate
-- rows still skew per-question accuracy (#204) and break the manual-grading path,
-- which reads a single row per question.
--
-- The service now makes the completion write conditional and upserts the sheet;
-- this key is the storage guard for the same contract. Rows written before the
-- fix can contain one duplicate per question (a double submit), so they are
-- collapsed first — under one explicit total order, best row first:
--
--   1. a teacher-graded row (`teacher_points` or `teacher_feedback` set) beats an
--      ungraded copy: `gradeAnswer` writes a human's points and feedback onto the
--      single row it found, and losing that row discards a grading decision;
--   2. otherwise the later write survives (`created_at` descending): a duplicate
--      pair comes from a retry of the same sheet, and the retry is what the
--      student meant;
--   3. `id` descending last, so the order is total and the statement is
--      repeatable. Rows written before this migration share the backfilled
--      `created_at`, so `id` is the tiebreak for them.
--
-- The table had no creation column, so the dedupe adds `created_at` first:
-- without it "the later write" is not expressible, and the previous rule
-- ("keep the smaller random UUID") could drop a graded row. `NULL` question ids
-- stay unconstrained — Postgres treats NULLs as distinct in the unique key — so
-- the `ON DELETE SET NULL` path for `question_id` keeps working.
-- ==========================================

ALTER TABLE public.student_answers
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.student_answers.created_at IS
  'Insert time; the duplicate collapse below is ordered by it.';

-- One statement, and the comparison is a strict total order (`id` is unique), so
-- a row is deleted only when a strictly better row exists — never both of a pair.
-- The tuple compares lexicographically; Postgres orders `false` before `true`, so
-- a graded keeper outranks an ungraded extra at the first element.
DELETE FROM public.student_answers AS extra
USING public.student_answers AS keeper
WHERE extra.attempt_id IS NOT NULL
  AND extra.question_id IS NOT NULL
  AND keeper.attempt_id = extra.attempt_id
  AND keeper.question_id = extra.question_id
  AND (
    (keeper.teacher_points IS NOT NULL OR keeper.teacher_feedback IS NOT NULL),
    keeper.created_at,
    keeper.id
  ) > (
    (extra.teacher_points IS NOT NULL OR extra.teacher_feedback IS NOT NULL),
    extra.created_at,
    extra.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS student_answers_attempt_question_key
  ON public.student_answers(attempt_id, question_id);
