-- ==========================================
-- TABLE: quiz_answers
-- Depends on: 39_quiz_attempts.sql, 24_questions.sql, 27_question_answers.sql
-- ==========================================

CREATE TABLE public.quiz_answers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id          uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  selected_answer_id   uuid REFERENCES public.question_answers(id) ON DELETE SET NULL,
  is_correct           boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_quiz_answers_attempt ON public.quiz_answers(attempt_id);
