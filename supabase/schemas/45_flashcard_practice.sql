-- ==========================================
-- TABLE: flashcard_practice
-- Depends on: 04_profiles.sql, 30_flashcards.sql
-- ==========================================

CREATE TABLE public.flashcard_practice (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  flashcard_id   uuid REFERENCES public.flashcards(id) ON DELETE CASCADE,
  was_correct    boolean NOT NULL,
  practiced_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcard_practice_user ON public.flashcard_practice(user_id);
CREATE INDEX idx_flashcard_practice_flashcard ON public.flashcard_practice(flashcard_id);
