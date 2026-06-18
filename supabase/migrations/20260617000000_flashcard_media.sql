-- Add media jsonb column to flashcards for storing image/audio attachments
ALTER TABLE public.flashcards
  ADD COLUMN media jsonb NOT NULL DEFAULT '[]'::jsonb;
