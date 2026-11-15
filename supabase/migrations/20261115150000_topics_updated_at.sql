-- ==========================================
-- Migration: 20261115150000
-- Description: topics gained no `updated_at`, so the three collection lists
-- could not offer the same sort orders: decks and question banks have
-- "recently updated", topics only "newest/oldest". Add the column, backfill
-- existing rows from `created_at` — their last known change was their creation —
-- then set the default, and add the generic update trigger, so
-- `TopicListQuerySchema` can accept `sortBy=updated_at` like its siblings.
-- ==========================================

-- No default yet: `ADD COLUMN … DEFAULT now()` is a non-volatile default, so
-- PostgreSQL would fill every existing row from the ALTER and the backfill below
-- would have nothing left to match.
ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.topics SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE public.topics
  ALTER COLUMN updated_at SET DEFAULT now();

DROP TRIGGER IF EXISTS set_topics_updated_at ON public.topics;
CREATE TRIGGER set_topics_updated_at
  BEFORE UPDATE ON public.topics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
