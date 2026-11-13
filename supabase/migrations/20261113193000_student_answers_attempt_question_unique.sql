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
-- collapsed first — the duplicates are copies of the same submission, and manual
-- grading could not land on them (`gradeAnswer` reads `.single()` and fails while
-- two rows exist). `NULL` attempt/question ids stay unconstrained, keeping the
-- `ON DELETE SET NULL` paths intact.
-- ==========================================

DELETE FROM public.student_answers AS extra
USING public.student_answers AS keeper
WHERE extra.attempt_id IS NOT NULL
  AND extra.question_id IS NOT NULL
  AND keeper.attempt_id = extra.attempt_id
  AND keeper.question_id = extra.question_id
  -- Deterministic survivor; the dropped rows are copies of the kept one.
  AND keeper.id < extra.id;

CREATE UNIQUE INDEX IF NOT EXISTS student_answers_attempt_question_key
  ON public.student_answers(attempt_id, question_id);
