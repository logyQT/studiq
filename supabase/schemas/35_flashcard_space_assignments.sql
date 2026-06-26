-- ==========================================
-- TABLE: flashcard_deck_assignments
-- Many-to-many relationship between flashcards and decks
-- Depends on: 30_flashcards.sql, 34_flashcard_spaces.sql
-- ==========================================

CREATE TABLE public.flashcard_deck_assignments (
  flashcard_id uuid REFERENCES public.flashcards(id) ON DELETE CASCADE,
  deck_id      uuid REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  PRIMARY KEY (flashcard_id, deck_id)
);

CREATE INDEX idx_flashcard_deck_assignments_deck ON public.flashcard_deck_assignments(deck_id);
CREATE INDEX idx_fda_deck_flashcard ON public.flashcard_deck_assignments (deck_id, flashcard_id);

-- ALTER TABLE public.flashcard_deck_assignments ENABLE ROW LEVEL SECURITY;
