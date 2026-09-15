-- ==========================================================
-- Migration: Seat-based licensing (Phase 2)
-- Adds per-user tier control via seat pools and assignments.
-- ==========================================================

-- ==========================================================
-- 1. Seat pools — buckets of available seats per plan tier
-- ==========================================================
CREATE TABLE public.org_seat_pools (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_key        text NOT NULL,
  total           integer NOT NULL,
  assigned        integer NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(organization_id, plan_key)
);

-- ==========================================================
-- 2. Seat assignments — links a user to a specific pool
-- ==========================================================
CREATE TABLE public.org_seat_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pool_id         uuid NOT NULL REFERENCES public.org_seat_pools(id),
  user_id         uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at     timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- ==========================================================
-- 3. Plan seat allocations — default seat counts per org plan
-- ==========================================================
CREATE TABLE public.plan_seat_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_plan    text NOT NULL,
  seat_plan   text NOT NULL,
  default_qty integer NOT NULL DEFAULT 0,
  UNIQUE(org_plan, seat_plan)
);

-- ==========================================================
-- 4. Hard block: prevent over-assignment
-- ==========================================================
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

-- ==========================================================
-- 5. Maintain assigned counter on insert/delete
-- ==========================================================
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

-- ==========================================================
-- 6. Extend handle_new_organization — also seed seat pools
-- ==========================================================
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id   uuid;
  v_teacher_id uuid;
  v_member_id  uuid;
  v_rec        record;
BEGIN
  -- 1. Create default roles
  INSERT INTO public.org_roles (organization_id, name, description, is_system)
  VALUES (NEW.id, 'admin', 'Org manager — settings, members, roles', true)
  RETURNING id INTO v_admin_id;

  INSERT INTO public.org_roles (organization_id, name, description, is_system)
  VALUES (NEW.id, 'teacher', 'Educator — CRUD over own content', true)
  RETURNING id INTO v_teacher_id;

  INSERT INTO public.org_roles (organization_id, name, description, is_system)
  VALUES (NEW.id, 'member', 'Base learner — read own + group content, create own', true)
  RETURNING id INTO v_member_id;

  -- 2. Seed permissions per role
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_admin_id, name, 'organization' FROM public.permissions
  ON CONFLICT DO NOTHING;

  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_teacher_id, name, 'own' FROM public.permissions
  ON CONFLICT DO NOTHING;

  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_member_id, name,
    CASE WHEN name LIKE '%.read' THEN 'group' ELSE 'own' END
  FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- 3. Seed features per role from plan template
  FOR v_rec IN
    SELECT feature_key FROM public.plan_features WHERE plan_key = NEW.plan
  LOOP
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_admin_id, v_rec.feature_key, true)
    ON CONFLICT DO NOTHING;

    IF v_rec.feature_key NOT IN ('member.manage', 'role.builder') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_teacher_id, v_rec.feature_key, true)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_rec.feature_key IN ('flashcards', 'quiz', 'ai.chat', 'documents') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_member_id, v_rec.feature_key, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- 4. Seed org limits from plan template
  INSERT INTO public.org_limits (organization_id, limit_key, max_value)
  SELECT NEW.id, limit_key, limit_value
  FROM public.plan_limits
  WHERE plan_key = NEW.plan
  ON CONFLICT DO NOTHING;

  -- 5. Seed default seat pools from plan_seat_allocations
  INSERT INTO public.org_seat_pools (organization_id, plan_key, total)
  SELECT NEW.id, seat_plan, default_qty
  FROM public.plan_seat_allocations
  WHERE org_plan = NEW.plan;

  RETURN NEW;
END;
$$;

-- ==========================================================
-- 7. Default seat allocation data
-- ==========================================================
INSERT INTO public.plan_seat_allocations (org_plan, seat_plan, default_qty) VALUES
  ('launch', 'launch', 1),
  ('team',   'team',   5),
  ('hub',    'hub',    20),
  ('campus', 'pro',    50),
  ('campus', 'master', 10),
  ('campus', 'campus', 5)
ON CONFLICT DO NOTHING;
