-- ==========================================
-- Taught items (#1172, R9)
--
-- An item whose key a student already saw is excluded from that student's graded sample. Some items
-- are deliberately taught before the assessment — the class solved them together — and those must
-- still be graded. `taught_item` is that declaration: per assessment item, off by default, and the
-- only way an item with a ledger event or a prior answer stays eligible.
--
-- The flag waives eligibility **only**. Sealing is untouched: a taught item is still absent from
-- practice and its key is still withheld while the window is live (R2/R4), and it never releases a
-- `withhold_from_review` hold (R10). Results label the item and fairness statistics exclude it, so a
-- pre-exposed item that is graded is declared rather than silently averaged (R9).
--
-- Read by staff only: `assignment_questions` is staff-readable at the row-policy boundary, and the
-- flag is a teacher decision a student must not see (it would tell them what was pre-exposed).
--
-- Deploy: migration first, app in the same release. `false` is the previous behaviour, so no
-- existing item becomes declared retroactively.
-- ==========================================

ALTER TABLE public.assignment_questions
  ADD COLUMN IF NOT EXISTS taught_item boolean NOT NULL DEFAULT false;

GRANT SELECT (taught_item) ON public.assignment_questions TO authenticated;
