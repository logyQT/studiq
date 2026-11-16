-- ==========================================
-- Migration: seed the `assignment.*` permission family (#1256)
--
-- `teacher_assignment.service.verifyOwnership` lets a non-author staff member write a run only when
-- their org role carries `assignment.update` at `organization` scope. `DEFAULT_ROLE_PERMISSIONS`
-- (packages/authz/src/lib/permissions.ts) declares exactly that for `admin` and `own` for `teacher`,
-- but the family was never in the `permissions` catalogue — so `handle_new_organization` (which
-- seeds every catalogue row) and `09_perms.sql` (which lists the families by hand) both left every
-- seeded role without a single `assignment.*` row. A manager who did not author the run was then
-- indistinguishable from a stranger: the override answered 404 instead of 409/200.
--
-- Three steps, because the family has to exist in the catalogue *before* either seeder can grant it:
--   1. add the six keys to `permissions` (also what makes the family grantable from the role
--      builder, which writes `org_role_permissions` from the catalogue);
--   2. backfill the system roles of every existing organization — the fix for databases that were
--      seeded before this migration;
--   3. redefine `handle_new_organization` so a new organization gets the same rows, and keep
--      `member` (student) out of the family: `DEFAULT_ROLE_PERMISSIONS` declares no `assignment.*`
--      for `member`, and an assessment write is staff-only.
--
-- `09_perms.sql` carries the same grants for a fresh `db reset` (seeds run after migrations, so the
-- organizations it creates postdate the backfill in step 2).
-- ==========================================

-- ==========================================
-- 1. The catalogue rows. Scope per role is decided below, not here.
-- ==========================================
INSERT INTO public.permissions (name) VALUES
  ('assignment.create'),
  ('assignment.read'),
  ('assignment.update'),
  ('assignment.delete'),
  ('assignment.publish'),
  ('assignment.grade')
ON CONFLICT DO NOTHING;

-- ==========================================
-- 2. Backfill every existing organization's system roles.
--
--    Matches DEFAULT_ROLE_PERMISSIONS exactly: `admin` gets the family at `organization` scope,
--    `teacher` at `own`. `member` gets nothing, and the DELETE enforces that even for a database
--    where the rows were added by hand (an org admin configuring the role before this migration).
--    `(organization_id, name)` is unique, so at most one role per org carries each of these names.
-- ==========================================
INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.name, 'organization'
FROM public.org_roles r, public.permissions p
WHERE r.name = 'admin'
  AND p.name LIKE 'assignment.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.name, 'own'
FROM public.org_roles r, public.permissions p
WHERE r.name = 'teacher'
  AND p.name LIKE 'assignment.%'
ON CONFLICT DO NOTHING;

DELETE FROM public.org_role_permissions orp
USING public.org_roles r
WHERE orp.org_role_id = r.id
  AND r.name = 'member'
  AND orp.permission_name LIKE 'assignment.%';

-- ==========================================
-- 3. handle_new_organization(): identical to the definition in
--    20261024151122_drop_org_limits.sql except the member grant excludes
--    `assignment.%`. Keep the role/permission seeding in sync with `09_perms.sql`.
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

  -- member: group scope for read, own for everything else — except the
  -- assessment family, which is staff-only (DEFAULT_ROLE_PERMISSIONS has no
  -- member `assignment.*` row).
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_member_id, name,
    CASE WHEN name LIKE '%.read' THEN 'group' ELSE 'own' END
  FROM public.permissions
  WHERE name NOT LIKE 'assignment.%'
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
