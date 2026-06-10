-- ==========================================
-- TABLE: flashcard_decks
-- Personal user collections for focused flashcard practice
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcard_decks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcard_decks_created_by ON public.flashcard_decks(created_by);
CREATE INDEX idx_flashcard_decks_university ON public.flashcard_decks(university_id);
