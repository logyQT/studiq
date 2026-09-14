-- Fix: flashcards.deck_id FK was added with ON DELETE SET NULL in
-- 20260710000001_drop_assignment_tables.sql, but deck_id is NOT NULL
-- (enforced by 20260714000001_enforce_fk_not_null.sql), making SET NULL
-- impossible. Recreate the FK as ON DELETE CASCADE to match the canonical
-- schema (supabase/schemas/30_flashcards.sql).

ALTER TABLE public.flashcards
  DROP CONSTRAINT IF EXISTS flashcards_deck_id_fkey;

ALTER TABLE public.flashcards
  ADD CONSTRAINT flashcards_deck_id_fkey
    FOREIGN KEY (deck_id) REFERENCES public.flashcard_decks(id) ON DELETE CASCADE;
