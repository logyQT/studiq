-- ==========================================
-- TABLE: flashcards
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  front      text NOT NULL,
  back       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcards_created_by ON public.flashcards(created_by);
CREATE INDEX idx_flashcards_university ON public.flashcards(university_id);

-- ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
