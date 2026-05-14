-- ==========================================
-- TABLE: flashcard_spaces
-- Personal user collections for focused flashcard practice
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcard_spaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcard_spaces_created_by ON public.flashcard_spaces(created_by);
