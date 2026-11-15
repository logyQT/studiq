-- ==========================================
-- How many items one attempt serves (#1174, R7)
--
-- An assessment binds a pool of items; `attempt_item_count` is how many of them one attempt serves
-- (NULL = the whole pool, the pre-#1174 behaviour). It is what makes a fresh-sample retake real:
-- with the whole pool served every time, every item is already served by the first attempt, nothing
-- unseen is left to draw, and the only honest answer is `409 NO_UNSEEN_ITEMS`.
--
-- The plan already prices this: "a class needs several times the items of one quiz for fresh-sample
-- retakes". The pool is the assessment's item set, so the teacher binds more items than one attempt
-- serves.
-- ==========================================

ALTER TABLE public.teacher_assignments
  ADD COLUMN IF NOT EXISTS attempt_item_count int
  CONSTRAINT teacher_assignments_attempt_item_count_positive
  CHECK (attempt_item_count IS NULL OR attempt_item_count > 0);
