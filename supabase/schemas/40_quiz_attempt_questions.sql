-- ==========================================
-- TABLE: quiz_attempt_questions
-- Stores which questions were included in each generated quiz attempt
-- Depends on: 39_quiz_attempts.sql, 24_questions.sql
-- ==========================================

CREATE TABLE public.quiz_attempt_questions (
  attempt_id  uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE INDEX idx_quiz_attempt_questions_attempt ON public.quiz_attempt_questions(attempt_id);
