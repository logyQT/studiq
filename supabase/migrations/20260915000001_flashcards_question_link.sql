-- ==========================================
-- Migration: 20260915000001
-- Description: link flashcards to their source question
-- A teacher can generate a flashcard from an official question
-- (front/back pre-filled, editable) instead of retyping the same
-- content twice. The link lets the flashcard surface the same
-- "report an issue" flow as the question.
-- ==========================================

ALTER TABLE public.flashcards
  ADD COLUMN question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL;

CREATE INDEX idx_flashcards_question_id ON public.flashcards(question_id);
