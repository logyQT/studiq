-- ==========================================
-- TABLE: flashcard_space_assignments
-- Many-to-many relationship between flashcards and spaces
-- Depends on: 30_flashcards.sql, 34_flashcard_spaces.sql
-- ==========================================

CREATE TABLE public.flashcard_space_assignments (
  flashcard_id uuid REFERENCES public.flashcards(id) ON DELETE CASCADE,
  space_id     uuid REFERENCES public.flashcard_spaces(id) ON DELETE CASCADE,
  PRIMARY KEY (flashcard_id, space_id)
);

CREATE INDEX idx_flashcard_space_assignments_space ON public.flashcard_space_assignments(space_id);
