-- ==========================================
-- TABLE: flashcard_topics
-- Teacher-created, university-scoped topic tags for flashcards
-- Depends on: 03_universities.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcard_topics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name          text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcard_topics_created_by ON public.flashcard_topics(created_by);
CREATE INDEX idx_flashcard_topics_university ON public.flashcard_topics(university_id);
