-- ==========================================
-- Unseen-only sampling is an explicit choice, not the default (#1172 revisited)
--
-- Phase 3 excluded every item whose key a student had already met (practice, review, a prior
-- attempt) from their graded sample. A student who studied then got a shorter sample — or a
-- `409 NO_UNSEEN_ITEMS` on their **first** attempt — which punishes the behaviour the product
-- exists to produce. Exposure is information for the teacher (the ledger, the publish warning,
-- fairness), not a default exclusion for the student.
--
-- `unseen_only = false` is the new default: a first attempt draws from the whole bound pool, and a
-- retake still draws a fresh sample (served + answered items stay out, R6/R7). `unseen_only = true`
-- restores the previous rule exactly: served, answered and key-rendered items are all excluded, an
-- empty pool is `409 NO_UNSEEN_ITEMS`, and `taught_item` is the way back in.
--
-- The flag is frozen at publish like every other sampling rule: a live run's config decides the
-- samples of students who have not started yet.
--
-- Deploy: migration first, app in the same release. `false` is the new behaviour, so no existing
-- assessment becomes unseen-only retroactively.
-- ==========================================

ALTER TABLE public.teacher_assignments
  ADD COLUMN IF NOT EXISTS unseen_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.teacher_assignments.unseen_only IS
  'Exclude items this student has already met (served, answered, key rendered) from their sample. Off by default: exposure is reported, not excluded.';
