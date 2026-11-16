-- ==========================================
-- Taught items (#1172, R9)
--
-- An item whose key a student already saw is excluded from that student's graded sample, and so is
-- an item they already answered. Some items are deliberately taught before the assessment — the
-- class solved them together — and those must still be graded. `taught_item` is that declaration:
-- per assessment item, off by default, and the only way an item with a ledger event or a prior
-- answer stays eligible.
--
-- The flag waives eligibility **only**. Sealing is untouched: a taught item is still absent from
-- practice and its key is still withheld while the window is live (R2/R4), and it never releases a
-- `withhold_from_review` hold (R10). Results must label the item and fairness statistics must leave
-- it out, so a pre-exposed item that is graded is declared rather than silently averaged (R9).
--
-- Declared while the run is a draft and frozen with the published snapshot: a flag that could move
-- after publish would change a sample mid-window.
--
-- Deploy: migration first, app in the same release. `false` is the previous behaviour, so no
-- existing item becomes declared retroactively.
-- ==========================================

ALTER TABLE public.assignment_questions
  ADD COLUMN IF NOT EXISTS taught_item boolean NOT NULL DEFAULT false;

-- `assignment_questions` is staff-readable at the row-policy boundary, so the flag never reaches a
-- student payload; the column grant only decides which staff columns PostgREST may project.
GRANT SELECT (taught_item) ON public.assignment_questions TO authenticated;
