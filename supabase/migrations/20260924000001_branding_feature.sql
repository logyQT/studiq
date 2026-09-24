-- ==========================================
-- Migration: `branding` feature key
-- Issue #108 — gate org logo + brand color behind a plan feature.
--
-- Additive only: one feature_flags catalog row, two plan_features
-- entitlement rows (hub + campus, per product decision), and the
-- org_role_features backfill that the seed alone cannot deliver.
--
-- Why the backfill matters: `handle_new_organization` copies
-- plan_features -> org_role_features exactly once, at org creation.
-- FeatureResolver treats those role rows as AUTHORITATIVE for
-- non-seated users ("missing key = disabled"), so simply adding the
-- plan_features row would lock out every org that already exists —
-- including the hub/campus orgs that are supposed to have branding.
--
-- Why all three roles: branding is an org-wide *display* entitlement
-- (every member should see their org's logo in the navbar), not a
-- management capability. The write path is separately protected by
-- `allowedAccountTypes: [MANAGER]` on both branding routes, so
-- granting the feature to teacher/member cannot let them mutate
-- branding — requireFeature() here is defense in depth on top of
-- the account-type check.
-- ==========================================

-- 1. Catalog row (feature_flags is the kill switch + rollout layer)
INSERT INTO public.feature_flags (key, name, description, is_enabled, rollout_percentage)
VALUES (
  'branding',
  'Custom Branding',
  'Organization logo and brand color across the app',
  true,
  100
)
ON CONFLICT (key) DO NOTHING;

-- 2. Plan entitlement — hub + campus (product decision, issue #108)
INSERT INTO public.plan_features (plan_key, feature_key)
VALUES
  ('hub', 'branding'),
  ('campus', 'branding')
ON CONFLICT (plan_key, feature_key) DO NOTHING;

-- 3. Keep sysadmin consistent with the seed's "sysadmin gets everything"
--    rule. Functionally redundant (FeatureResolver short-circuits SYS_ADMIN
--    to the full FEATURES set), but the DB shouldn't disagree with the seed.
INSERT INTO public.plan_features (plan_key, feature_key)
SELECT 'sysadmin', key
FROM public.feature_flags
WHERE key = 'branding'
ON CONFLICT (plan_key, feature_key) DO NOTHING;

-- 4. Backfill org_role_features for orgs that already exist.
--    Scope: only orgs whose plan actually entitles them, so launch/team
--    and every other tier stay locked out.
INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
SELECT r.id, 'branding', true
FROM public.org_roles r
JOIN public.organizations o ON o.id = r.organization_id
WHERE o.plan IN ('hub', 'campus')
  AND r.name IN ('admin', 'teacher', 'member')
ON CONFLICT (org_role_id, feature_key) DO NOTHING;

-- ==========================================
-- 5. Rebuild handle_new_organization so orgs created AFTER this migration
--    seed `branding` for all three roles.
--
--    Identical to the definition in
--    20260915000003_drop_plan_seat_allocations.sql except for the
--    `member` allowlist, which gains 'branding'.
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

  -- 4. Seed org limits from plan template
  INSERT INTO public.org_limits (organization_id, limit_key, max_value)
  SELECT NEW.id, limit_key, limit_value
  FROM public.plan_limits
  WHERE plan_key = NEW.plan
  ON CONFLICT DO NOTHING;

  -- NOTE: Seat pools are NO LONGER seeded at org creation (Phase B.5).
  -- Pools are created on-demand when seats are purchased (addPool).

  RETURN NEW;
END;
$$;
