-- Covering indexes for flashcard list queries (cursor pagination).
-- Allows index-only scans for the common RBAC + ORDER BY pattern,
-- eliminating heap lookups and separate sort steps at scale.

CREATE INDEX IF NOT EXISTS idx_flashcards_owner_time
  ON public.flashcards (created_by, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_flashcards_uni_time
  ON public.flashcards (university_id, created_at DESC, id);
