# Flashcard List Query Timeout Fix

## Background

Production list queries on GET /api/v1/flashcards time out with PostgreSQL error 57014
(canceling statement due to statement timeout) when a user has ~4M flashcards.

## Already Applied (migration 20260629000002)

Two covering composite indexes to handle the RBAC + ORDER BY pattern:

`sql
CREATE INDEX IF NOT EXISTS idx_flashcards_owner_time
  ON public.flashcards (created_by, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_flashcards_uni_time
  ON public.flashcards (university_id, created_at DESC, id);
`

These let PostgreSQL skip heap lookups and avoid a separate sort step for
WHERE created_by = ? ORDER BY created_at DESC, id LIMIT N queries.

Also increased statistics target on created_by and university_id columns
so PostgreSQL correctly estimates row counts for users with few cards:

`sql
ALTER TABLE flashcards ALTER COLUMN created_by SET STATISTICS 1000;
ALTER TABLE flashcards ALTER COLUMN university_id SET STATISTICS 1000;
`

## Remaining Problem — ILIKE Search

The q parameter triggers:

`sql
WHERE front ILIKE '%term%' OR back ILIKE '%term%'
`

With 4.3M rows this forces a full Parallel Seq Scan (~6.5s locally, worse on
production). Neither B-tree indexes nor the existing GIN search_vector index
can accelerate ILIKE with a leading wildcard.

## Options

### Option A — Trigram GIN index (no code changes)

Add pg_trgm extension + GIN trigram index:

`sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY idx_flashcards_front_back_trgm
  ON flashcards USING gin (front gin_trgm_ops, back gin_trgm_ops);
`

- **Pro**: Drops any ILIKE query to sub-100ms, no application code changes
- **Con**: New ~1GB index (trigram on two text columns × 4.3M rows)
- **Con**: CREATE INDEX CONCURRENTLY needed to avoid locking — long build time

### Option B — Full-text search (code change, no new index)

Rewrite the q filter in src/server/services/flashcard.service.ts to use the
existing search_vector column + plainto_tsquery:

`	ypescript
// Instead of ILIKE with leading wildcard:
query = query.textSearch('search_vector', filters!.q!);

// Or with tsquery for more control:
query = query.or(
  search_vector @@ plainto_tsquery('english', ''),
  search_vector @@ plainto_tsquery('polish', ''),
);
`

- **Pro**: Reuses existing idx_flashcards_search_vector GIN index — zero storage
- **Pro**: No migration, no long-running index build
- **Con**: Behavioral change — full-text stemming means "run" matches "running"
  but not "runnable-test". No substring matching. Users may get unexpected results.

## Decision Needed

Which tradeoff is acceptable for this project stage (pre-market)?
