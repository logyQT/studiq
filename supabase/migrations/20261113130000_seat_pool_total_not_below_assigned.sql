-- ==========================================================
-- Migration: a seat pool can never be smaller than its assignments (#1068)
--
-- `check_seat_available` only guards INSERT on `org_seat_assignments`, so
-- `UPDATE org_seat_pools SET total = ...` could drop a pool below its
-- `assigned` count: the assignments stay, `total - assigned` goes negative and
-- the pool is permanently full. `SeatService.updatePool` now refuses that, but
-- the invariant belongs to the table — a direct PostgREST update from an org
-- manager has to hit the same wall.
-- ==========================================================

-- Repair first. Raising `total` keeps every existing assignment valid, where
-- lowering `assigned` would desynchronise the counter from the assignment rows.
UPDATE public.org_seat_pools
SET total = assigned
WHERE total < assigned;

ALTER TABLE public.org_seat_pools
  ADD CONSTRAINT org_seat_pools_total_not_below_assigned
  CHECK (total >= assigned);
