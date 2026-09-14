-- =============================================
-- Performance indexes for flashcard list queries
-- =============================================
-- These indexes fix "canceling statement due to statement timeout"
-- on GET /api/v1/flashcards?deckIds=...&limit=50 queries with 1M+ cards.
--
-- The hot query pattern:
--   SELECT f.*, fda(deck_id)
--   FROM flashcards f
--   INNER JOIN flashcard_deck_assignments fda ON fda.flashcard_id = f.id
--   WHERE fda.deck_id = '?'
--   ORDER BY f.created_at DESC, f.id
--   LIMIT N+1
--
-- Without these indexes Postgres does:
--   Index Scan on fda(deck_id) → 100k+ rows → Nested Loop → Sort → Limit
-- With these indexes Postgres does:
--   Index Only Scan on fda(deck_id, flashcard_id)
--   → Nested Loop (Index Scan on flashcards(created_at, id))
--   → Limit
-- No Sort node, sequential I/O, stops at LIMIT.

-- Covering index for ORDER BY created_at DESC, id (cursor pagination)
CREATE INDEX IF NOT EXISTS idx_flashcards_created_at_id
  ON public.flashcards (created_at DESC, id);

-- Composite index for deck-filtered queries (deck_id → flashcard_id)
CREATE INDEX IF NOT EXISTS idx_fda_deck_flashcard
  ON public.flashcard_deck_assignments (deck_id, flashcard_id);

-- Composite index for topic-filtered queries (topic_id → flashcard_id)
CREATE INDEX IF NOT EXISTS idx_fta_topic_flashcard
  ON public.flashcard_topic_assignments (topic_id, flashcard_id);
