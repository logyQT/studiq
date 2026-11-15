-- ==========================================
-- The `cancelled` lifecycle state (#1174, R12/R19)
--
-- A published run had exactly one ending: `close`, which reveals. A run published for the wrong
-- class or with the wrong window therefore had no way out once it opened — withdrawing is refused
-- from live, and closing hands the key to the cohort. `cancel` is the third ending: the run stops,
-- its in-progress attempts expire, its reservations end, and **no review exists** at any time.
--
-- `cancelled` is terminal: a separate migration makes the status irreversible, the way
-- `closed_at` already is (20261114160000_assessment_close.sql).
--
-- `ALTER TYPE … ADD VALUE` may not be *used* in the transaction that adds it, so this file only
-- adds the value; the trigger that names it lands in the next migration.
-- ==========================================

ALTER TYPE public.assignment_status ADD VALUE IF NOT EXISTS 'cancelled';
