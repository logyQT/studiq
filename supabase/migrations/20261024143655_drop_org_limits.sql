-- ==========================================
-- Migration: drop `org_limits`
-- Issue #229 (child of #226) — remove the per-org limit snapshot.
--
-- `org_limits` duplicated `plan_limits`: `handle_new_organization` copied
-- the org's plan template into it and `apply_org_plan` re-wrote it on every
-- plan change. Nothing else wrote it, every value is derivable from
-- `organizations.plan -> plan_limits`, and the snapshot could drift from the
-- template. Org capacity is now resolved live from
-- `organizations.plan -> plan_limits` (LimitsResolver).
--
-- Order matters: both functions are redefined BEFORE the table is dropped so
-- a fresh replay never runs a trigger body that references a missing relation.
--
-- Historical migrations that created/seeded the table are left untouched (they
-- are applied history). No backfill: there is no production deployment and no
-- writer outside the two functions below.
-- ==========================================

-- ==========================================
-- 1. handle_new_organization() without the org_limits seeding step.
--
--    Identical to the definition in 20260924000001_branding_feature.sql
--    except step 4 (seed org_limits from plan_limits) is removed. Keep the
--    role/permission/feature seeding in sync with apply_org_plan below.
-- ==========================================
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
  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system)
  VALUES (NEW.id, 'admin', 'Org manager — settings, members, roles', 'Admin', true)
  RETURNING id INTO v_admin_id;

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system)
  VALUES (NEW.id, 'teacher', 'Educator — CRUD over own content', 'Teacher', true)
  RETURNING id INTO v_teacher_id;

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system)
  VALUES (NEW.id, 'member', 'Base learner — read own + group content, create own', 'Student', true)
  RETURNING id INTO v_member_id;

  -- 2. Seed permissions per role
  -- admin: organization scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_admin_id, name, 'organization' FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- teacher: own scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_teacher_id, name, 'own' FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- member: group scope for read, own for everything else
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_member_id, name,
    CASE WHEN name LIKE '%.read' THEN 'group' ELSE 'own' END
  FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- 3. Seed features per role from plan template
  FOR v_rec IN
    SELECT feature_key FROM public.plan_features WHERE plan_key = NEW.plan
  LOOP
    -- admin: everything
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_admin_id, v_rec.feature_key, true)
    ON CONFLICT DO NOTHING;

    -- teacher: everything except member_manage and role_builder
    IF v_rec.feature_key NOT IN ('member.manage', 'role.builder') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_teacher_id, v_rec.feature_key, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- member: only flashcards, quiz, ai, documents — plus `branding`,
    -- which is display-only (write path requires AccountType.MANAGER).
    IF v_rec.feature_key IN ('flashcards', 'quiz', 'ai.chat', 'documents', 'branding') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_member_id, v_rec.feature_key, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- NOTE: Org limits are no longer snapshotted (#229). They are resolved live
  -- from organizations.plan -> plan_limits.
  -- NOTE: Seat pools are NO LONGER seeded at org creation (Phase B.5).
  -- Pools are created on-demand when seats are purchased (addPool).

  RETURN NEW;
END;
$$;

-- ==========================================
-- 2. apply_org_plan(org, plan) without the org_limits sync.
--
--    Identical to the definition in 20261020000002_apply_org_plan.sql except
--    the limits delete/upsert block is removed. Feature sync is unchanged.
-- ==========================================
CREATE OR REPLACE FUNCTION public.apply_org_plan(p_org_id uuid, p_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan) THEN
    RAISE EXCEPTION 'plan % not found', p_plan USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.organizations SET plan = p_plan WHERE id = p_org_id;

  -- Revoke features the new plan does not include, from every role.
  DELETE FROM public.org_role_features f
  USING public.org_roles r
  WHERE f.org_role_id = r.id
    AND r.organization_id = p_org_id
    AND f.feature_key <> 'org.manage'
    AND f.feature_key NOT IN (
      SELECT feature_key FROM public.plan_features WHERE plan_key = p_plan
    );

  -- Grant the plan's features to the system roles.
  INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
  SELECT r.id, pf.feature_key, true
  FROM public.org_roles r
  JOIN public.plan_features pf ON pf.plan_key = p_plan
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND (
      r.name = 'admin'
      OR (r.name = 'teacher' AND pf.feature_key NOT IN ('member.manage', 'role.builder'))
      OR (r.name = 'member'
          AND pf.feature_key IN ('flashcards', 'quiz', 'ai.chat', 'documents', 'branding'))
    )
  ON CONFLICT (org_role_id, feature_key) DO NOTHING;

  -- NOTE: Limits are no longer synced (#229). They are derived live from
  -- organizations.plan -> plan_limits, so changing the plan is enough.
END;
$$;

REVOKE ALL ON FUNCTION public.apply_org_plan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_org_plan(uuid, text) TO service_role;

-- ==========================================
-- 3. Drop the read surface.
--
--    The policies are dropped explicitly (DROP TABLE would take them with it)
--    so the intent is greppable. They must be qualified with
--    `ON public.org_limits`: `org_role_features` has a policy with the same
--    name ("Service role full access") that must survive.
-- ==========================================
DROP POLICY IF EXISTS "Service role full access" ON public.org_limits;
DROP POLICY IF EXISTS "Org members read limits" ON public.org_limits;
DROP TABLE IF EXISTS public.org_limits;
