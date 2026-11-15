-- ==========================================
-- TABLES: org_seat_pools, org_seat_assignments
-- Per-user tier control through seat pools and assignments.
--
-- `org_seat_pools.total` is the purchased count and `assigned` the live number
-- of assignment rows (maintained by the `maintain_seat_counts` trigger).
-- `assigned` floors `total`: `org_seat_pools_total_not_below_assigned` is the
-- invariant an `UPDATE` must not break (#1068), added by
-- migrations/20261113130000_seat_pool_total_not_below_assigned.sql.
--
-- Pools are created on demand by `SeatService.addPool`. `handle_new_organization`
-- seeds none, and the default-allocation table it used to read
-- (`plan_seat_allocations`) was dropped together with that seeding in
-- migrations/20260915000003_drop_plan_seat_allocations.sql.
--
-- RLS/grants live in migrations/20261024124756_rls_all_public_tables.sql.
-- Depends on: 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.org_seat_pools (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_key        text NOT NULL,
  total           integer NOT NULL,
  assigned        integer NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(organization_id, plan_key),
  CONSTRAINT org_seat_pools_total_not_below_assigned CHECK (total >= assigned)
);

CREATE TABLE public.org_seat_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pool_id         uuid NOT NULL REFERENCES public.org_seat_pools(id),
  user_id         uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at     timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- ==========================================
-- FUNCTION: check_seat_available
-- Hard block on over-assignment. Locks the pool row so two concurrent inserts
-- cannot both read the last free seat.
-- ==========================================
CREATE OR REPLACE FUNCTION public.check_seat_available()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pool_record record;
BEGIN
  SELECT total, assigned INTO pool_record
  FROM public.org_seat_pools
  WHERE id = NEW.pool_id
  FOR UPDATE;

  IF pool_record.assigned >= pool_record.total THEN
    RAISE EXCEPTION 'SEAT_POOL_FULL'
      USING DETAIL = format('Pool %s is full (%s/%s assigned)', NEW.pool_id, pool_record.assigned, pool_record.total);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER check_seat_available
  BEFORE INSERT ON public.org_seat_assignments
  FOR EACH ROW EXECUTE FUNCTION public.check_seat_available();

-- ==========================================
-- FUNCTION: maintain_seat_counts
-- Keeps `org_seat_pools.assigned` in step with the assignment rows.
-- ==========================================
CREATE OR REPLACE FUNCTION public.maintain_seat_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.org_seat_pools
    SET assigned = assigned + 1
    WHERE id = NEW.pool_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.org_seat_pools
    SET assigned = assigned - 1
    WHERE id = OLD.pool_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER maintain_seat_counts
  AFTER INSERT OR DELETE ON public.org_seat_assignments
  FOR EACH ROW EXECUTE FUNCTION public.maintain_seat_counts();
