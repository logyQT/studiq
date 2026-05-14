-- ==========================================
-- TABLE: flashcards
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  front      text NOT NULL,
  back       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcards_created_by ON public.flashcards(created_by);
