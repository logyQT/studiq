-- Phase 1c of the role-authority programme (ADR-0015 §5.1, §13 batch 1).
--
-- `documents` has no surface today, so it is absent from the catalog — and from
-- the flags, plans and role/override rows — until its surface ships. The
-- catalog is open (ADR-0015 §5.1): re-entry is data-only — catalog metadata, a
-- flag row and the plan/seed rows that should carry it — and the resolver needs
-- no new code path. Nothing gates on the key today, so no read changes.
--
-- Delete order is forced by the foreign keys added in 20261119140000:
--   * `plan_entitlements.entitlement_key` → `entitlement_catalog` has no
--     `ON DELETE CASCADE`, so the plan rows must go before the catalog row;
--   * `org_role_features.feature_key` has NO foreign key at all — only
--     `org_role_id` and the unique pair are constrained — so nothing cascades
--     and the explicit delete below is load-bearing. That column is
--     unconstrained schema debt: phase 2 must either give it a foreign key or
--     remove it with the table;
--   * `user_feature_overrides.feature_key` → `entitlement_flags` is
--     `ON DELETE CASCADE`, but it is deleted explicitly as well so the intent
--     does not depend on the constraint;
--   * no `org_role_permissions` row can carry `documents`: the phase-1b
--     `migrate_org_role_permission_names()` sweep deleted that name from every
--     role (it was never a permission).
-- A later plan/role write cannot reintroduce the key: the plan row fails the
-- catalog foreign key (23503, which the admin services map to BAD_REQUEST).

delete from public.plan_entitlements where entitlement_key = 'documents';
delete from public.org_role_features where feature_key = 'documents';
delete from public.user_feature_overrides where feature_key = 'documents';
delete from public.entitlement_catalog where key = 'documents';
delete from public.entitlement_flags where key = 'documents';

-- ==========================================
-- Functions whose member allowlist still named the removed key.
--
-- The bodies are the newest (20261119140000) definitions with only the member
-- allowlist changed. They are re-created now because a future data-only
-- re-entry of a key in the same position would otherwise be silently granted
-- to `member` by these functions long after the catalog and seed rows were
-- updated. `create or replace` keeps the existing ACLs.
-- ==========================================
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  -- 2. Seed permissions per role — content permissions only. Group and org
  --    authority is granted explicitly (phase 2 templates); entitlement keys
  --    live in `entitlement_catalog` and are never permissions.
  -- admin: organization scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_admin_id, p.key, 'organization' FROM public.permissions p
  WHERE p.category = 'content'
  ON CONFLICT DO NOTHING;

  -- teacher: own scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_teacher_id, p.key, 'own' FROM public.permissions p
  WHERE p.category = 'content'
  ON CONFLICT DO NOTHING;

  -- member: group scope for read, own for everything else — except the
  -- assessment family, which is staff-only (DEFAULT_ROLE_PERMISSIONS has no
  -- member `assignment.*` row).
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_member_id, p.key,
    CASE WHEN p.key LIKE '%.read' THEN 'group' ELSE 'own' END
  FROM public.permissions p
  WHERE p.category = 'content'
    AND p.key NOT LIKE 'assignment.%'
  ON CONFLICT DO NOTHING;

  -- 3. Seed features per role from plan template
  FOR v_rec IN
    SELECT entitlement_key FROM public.plan_entitlements WHERE plan_key = NEW.plan
  LOOP
    -- admin: everything
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_admin_id, v_rec.entitlement_key, true)
    ON CONFLICT DO NOTHING;

    -- teacher: everything except member_manage and role_builder
    IF v_rec.entitlement_key NOT IN ('member.manage', 'role.builder') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_teacher_id, v_rec.entitlement_key, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- member: only flashcards, quiz, ai — plus `branding`, which is
    -- display-only (write path requires AccountType.MANAGER).
    IF v_rec.entitlement_key IN ('flashcards', 'quiz', 'ai.chat', 'branding') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_member_id, v_rec.entitlement_key, true)
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

create or replace function public.apply_org_plan(p_org_id uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
      SELECT entitlement_key FROM public.plan_entitlements WHERE plan_key = p_plan
    );

  -- Grant the plan's features to the system roles.
  INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
  SELECT r.id, pf.entitlement_key, true
  FROM public.org_roles r
  JOIN public.plan_entitlements pf ON pf.plan_key = p_plan
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND (
      r.name = 'admin'
      OR (r.name = 'teacher' AND pf.entitlement_key NOT IN ('member.manage', 'role.builder'))
      OR (r.name = 'member'
          AND pf.entitlement_key IN ('flashcards', 'quiz', 'ai.chat', 'branding'))
    )
  ON CONFLICT (org_role_id, feature_key) DO NOTHING;

  -- NOTE: Limits are no longer synced (#229). They are derived live from
  -- organizations.plan -> plan_limits, so changing the plan is enough.
END;
$$;
