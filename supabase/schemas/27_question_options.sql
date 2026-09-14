-- ==========================================
-- TABLE: question_options
-- Stores options, items, and match pairs for all question types.
-- Depends on: 24_questions.sql
-- ==========================================

CREATE TABLE public.question_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  content      text NOT NULL,
  is_correct   boolean NOT NULL DEFAULT false,
  order_index  int NOT NULL DEFAULT 0,
  match_group  uuid,
  match_side   text CHECK (match_side IN ('left', 'right'))
);

CREATE INDEX idx_question_options_question ON public.question_options(question_id);
