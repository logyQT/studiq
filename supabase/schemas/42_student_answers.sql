-- ==========================================
-- TABLE: student_answers
-- One row per question per attempt: the answer value carries the student's
-- selection (`selected_option_id` for choice questions, `text_answer` for open
-- ones). Every product path builds the answer sheet as one entry per question
-- and `quiz-attempt.service` refuses a repeated question id (#1065); #1066's
-- `UNIQUE (attempt_id, question_id)` is the storage enforcement of that
-- contract. `submitted_position` / `match_pair_id` are reserved for multi-unit
-- question types and are never written today.
-- Depends on: 39_quiz_attempts.sql, 24_questions.sql, 27_question_options.sql
-- ==========================================

CREATE TABLE public.student_answers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id          uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  question_type        question_type,
  selected_option_id   uuid REFERENCES public.question_options(id) ON DELETE SET NULL,
  is_correct           boolean NOT NULL DEFAULT false,
  points_earned        numeric,
  ai_graded            boolean NOT NULL DEFAULT false,
  teacher_points       int,
  teacher_feedback     text,
  text_answer          text,
  submitted_position   int,
  match_pair_id        uuid,
  -- Insert time; the #1066 duplicate collapse is ordered by it.
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_answers_attempt ON public.student_answers(attempt_id);
-- Per-question accuracy aggregation (#204).
CREATE INDEX idx_student_answers_question ON public.student_answers(question_id);
-- One row per question per attempt (#1066): a double submit cannot write a
-- second answer sheet for the same question. `NULL` question ids stay
-- unconstrained (Postgres treats NULLs as distinct), which keeps the
-- `question_id` `ON DELETE SET NULL` path working.
CREATE UNIQUE INDEX student_answers_attempt_question_key
  ON public.student_answers(attempt_id, question_id);
