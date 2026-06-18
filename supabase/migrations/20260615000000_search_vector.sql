-- Add search_vector tsvector column for bilingual full-text search (English + Polish)
-- Combined via || operator so a single GIN index covers both languages

-- Ensure Polish text search configuration exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'polish') THEN
    CREATE TEXT SEARCH CONFIGURATION public.polish (COPY = pg_catalog.simple);
  END IF;
END $$;

ALTER TABLE public.flashcards
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(front, '')) ||
    to_tsvector('polish', coalesce(front, '')) ||
    to_tsvector('english', coalesce(back, '')) ||
    to_tsvector('polish', coalesce(back, ''))
  ) STORED;

CREATE INDEX idx_flashcards_search_vector ON public.flashcards USING GIN (search_vector);
