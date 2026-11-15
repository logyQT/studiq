-- ==========================================
-- Migration: 20261115120000
-- Description: topics gained no `updated_at`, so the three collection lists
-- could not offer the same sort orders: decks and question banks have
-- "recently updated", topics only "newest/oldest". Add the column (backfilled
-- from `created_at` for existing rows) and the generic update trigger, so
-- `TopicListQuerySchema` can accept `sortBy=updated_at` like its siblings.
-- ==========================================

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Existing rows: their last known change was their creation.
UPDATE public.topics SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS set_topics_updated_at ON public.topics;
CREATE TRIGGER set_topics_updated_at
  BEFORE UPDATE ON public.topics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
