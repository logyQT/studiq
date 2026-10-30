-- ==========================================
-- Follow-ups to the student insights aggregate (#657)
--
-- 1. Assignment provenance on quiz attempts. `quiz_attempts.assignment_id` is
--    `ON DELETE SET NULL`, so deleting an assignment leaves its completed attempts behind with
--    `assignment_id = NULL` — indistinguishable from a practice quiz. The insights aggregate
--    must exclude assignment attempts even after that (their per-topic accuracy may cover
--    results a teacher withheld), which needs a marker that survives the deletion:
--      * `is_assignment_attempt` is written once, when the attempt is created, never changes;
--      * existing attempts are backfilled from the still-present `assignment_id`;
--      * the insights RPC filters on the marker instead of the nullable foreign key.
--
-- 2. An index for the retention curve: the aggregate partitions the caller's whole review
--    history by card and orders it by time (`lag()` over flashcard_practice).
-- ==========================================

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS is_assignment_attempt boolean NOT NULL DEFAULT false;

-- Best effort for rows created before the marker: attempts whose assignment still exists keep
-- their provenance. An attempt whose assignment was already deleted cannot be recovered.
UPDATE public.quiz_attempts
SET is_assignment_attempt = true
WHERE assignment_id IS NOT NULL;

-- The retention curve partitions the caller's whole review history by card and time (`lag()`
-- over flashcard_practice), so the per-user scan must not sort every review of the user. This
-- index serves both the partition and its order and supersedes the `user_id`-only index for
-- that access path; it is kept for the other readers of the index.
CREATE INDEX IF NOT EXISTS idx_flashcard_practice_user_card_time
  ON public.flashcard_practice (user_id, flashcard_id, practiced_at);
