-- ==========================================
-- TABLE: question_answers
-- Depends on: 24_questions.sql
-- ==========================================

CREATE TABLE public.question_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  content      text NOT NULL,
  is_correct   boolean NOT NULL DEFAULT false,
  order_index  int NOT NULL DEFAULT 0
);

CREATE INDEX idx_question_answers_question ON public.question_answers(question_id);
