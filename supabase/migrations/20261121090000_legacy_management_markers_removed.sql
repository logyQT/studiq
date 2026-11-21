-- Phase 2b-7 of the role-authority programme (ADR-0015 §4.1, §5.1, §8.3).
--
-- The four legacy management entitlements — `role.builder`, `org.manage`,
-- `member.manage`, `group.manage` — leave the catalog. Every route and RLS
-- gate that read them was moved to a permission in slices 2a-2…2b-6, so the
-- keys are dead weight: the resolver can no longer resolve them, and no
-- `requireFeature(...)` caller names them any more. `group.manage` survives as
-- the permission of the same name (§4.1); the entitlement namespace is now
-- disjoint from `permissions`.
--
-- Delete order is forced by the foreign keys:
--   * `plan_entitlements.entitlement_key` → `entitlement_catalog(key)` has no
--     `ON DELETE CASCADE` (the 1b constraint), so the plan rows must go before
--     the catalog row;
--   * `org_role_features.feature_key` is untyped text with no foreign key at
--     all, so nothing cascades and the explicit delete is load-bearing;
--   * `user_feature_overrides.feature_key` → `entitlement_flags(key)` cascades,
--     but the delete is explicit as well so the intent does not depend on the
--     constraint (the 1c lesson);
--   * `entitlement_flags` rows for the markers are deleted as a guard, not
--     an FK: `entitlement_flags.key` has no foreign key to the catalog.
-- A later plan/flag write cannot reintroduce a key: the plan row fails the
-- catalog foreign key (23503, which the admin services map to BAD_REQUEST).

delete from public.org_role_features
where feature_key in ('role.builder', 'org.manage', 'member.manage', 'group.manage');

delete from public.plan_entitlements
where entitlement_key in ('role.builder', 'org.manage', 'member.manage', 'group.manage');

delete from public.user_feature_overrides
where feature_key in ('role.builder', 'org.manage', 'member.manage', 'group.manage');

delete from public.entitlement_flags
where key in ('role.builder', 'org.manage', 'member.manage', 'group.manage');

delete from public.entitlement_catalog
where key in ('role.builder', 'org.manage', 'member.manage', 'group.manage');

-- ==========================================
-- Functions whose bodies still named the markers.
--
-- `has_org_feature` (latest definition: 20261119180000) carried the marker
-- `NOT IN (...)` lists in its `all`-profile and seat branches; with the keys
-- gone from every plan those lists are dead, so the `all` branch is simply the
-- plan ceiling and the only special case left is the system Admin role
-- (`is_system and name = 'admin'`), which is what the old `org.manage` row
-- meant. `apply_org_plan` (latest definition: 20261119160000) kept a
-- `<> 'org.manage'` revoke exception and a teacher `NOT IN` exclusion; both
-- are dead, so the plan sync is a plain ceiling diff. `handle_new_organization`
-- (latest definition: 20261119180000) seeds the same teacher exclusion in its
-- `org_role_features` loop. `create or replace` keeps the existing ACLs; the
-- old migration files are not edited.
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
  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system, entitlement_profile)
  VALUES (NEW.id, 'admin', 'Org manager — settings, members, roles', 'Admin', true, 'all')
  RETURNING id INTO v_admin_id;

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system, entitlement_profile)
  VALUES (NEW.id, 'teacher', 'Educator — CRUD over own content', 'Teacher', true, 'all')
  RETURNING id INTO v_teacher_id;

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system, entitlement_profile)
  VALUES (NEW.id, 'member', 'Base learner — read own + group content, create own', 'Student', true, 'learner')
  RETURNING id INTO v_member_id;

  -- 2. Seed the permission catalog per role (ADR-0015 §4.2 templates). Group
  --    and org authority is granted here; entitlement keys live in
  --    `entitlement_catalog` and are never permissions.
  PERFORM public.seed_system_role_permissions(NEW.id);

  -- 3. Seed features per role from plan template. The legacy management
  --    markers are gone from the catalog (this migration), so every plan key
  --    is a plain entitlement: admin and teacher take the whole plan, member
  --    takes the learner set.
  FOR v_rec IN
    SELECT entitlement_key FROM public.plan_entitlements WHERE plan_key = NEW.plan
  LOOP
    -- admin: everything
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_admin_id, v_rec.entitlement_key, true)
    ON CONFLICT DO NOTHING;

    -- teacher: everything
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_teacher_id, v_rec.entitlement_key, true)
    ON CONFLICT DO NOTHING;

    -- member: the learner set — flashcards, quiz, ai.chat, plus `branding`,
    -- which is display-only (the write path is `org.settings.manage` +
    -- the `branding` entitlement).
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

  -- Revoke features the new plan does not include, from every role. The plan
  -- ceiling is the whole truth: the legacy `org.manage` exception is gone with
  -- the marker (this migration deletes its rows).
  DELETE FROM public.org_role_features f
  USING public.org_roles r
  WHERE f.org_role_id = r.id
    AND r.organization_id = p_org_id
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
      OR r.name = 'teacher'
      OR (r.name = 'member'
          AND pf.entitlement_key IN ('flashcards', 'quiz', 'ai.chat', 'branding'))
    )
  ON CONFLICT (org_role_id, feature_key) DO NOTHING;

  -- NOTE: Limits are no longer synced (#229). They are derived live from
  -- organizations.plan -> plan_limits, so changing the plan is enough.
END;
$$;

-- RLS twin of the resolver's org layer (FP-01). The `(r.is_system AND
-- r.name = 'admin')` branch and the explicit-row EXISTS branch are kept exactly
-- as they were; only the zero-row fallback's marker lists are gone: profile
-- `all` is now simply the plan ceiling, and the seat union has no admin-only
-- strip because no plan carries a management marker any more.
create or replace function public.has_org_feature(
  p_actor uuid,
  p_organization_id uuid,
  p_feature text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    JOIN public.org_roles r
      ON r.id = om.org_role_id
     AND r.organization_id = om.organization_id
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_actor
      AND om.organization_id = p_organization_id
      AND (
        -- The system Admin role holds every entitlement; this branch is what
        -- the old `org.manage` row used to mean.
        (r.is_system AND r.name = 'admin')
        OR EXISTS (
          SELECT 1
          FROM public.org_role_features f
          WHERE f.org_role_id = r.id
            AND f.feature_key = p_feature
            AND f.is_enabled
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.org_role_features f2 WHERE f2.org_role_id = r.id
          )
          AND (
            -- Profile base layer (ADR-0015 §5.3): `all` is the plan ceiling.
            CASE r.entitlement_profile
              WHEN 'all' THEN
                EXISTS (
                  SELECT 1
                  FROM public.plan_entitlements pf
                  WHERE pf.entitlement_key = p_feature
                    AND pf.plan_key = o.plan
                )
              WHEN 'learner' THEN
                p_feature IN ('flashcards', 'quiz', 'ai.chat', 'branding')
                AND EXISTS (
                  SELECT 1
                  FROM public.plan_entitlements pf
                  WHERE pf.entitlement_key = p_feature
                    AND pf.plan_key = o.plan
                )
              ELSE false
            END
            -- Seat plan: additive, exactly as `addPlanFeatures(seatPlanKey)`
            -- runs after the profile.
            OR EXISTS (
              SELECT 1
              FROM public.plan_entitlements pfs
              WHERE pfs.entitlement_key = p_feature
                AND pfs.plan_key = (
                  SELECT sp.plan_key
                  FROM public.org_seat_assignments sa
                  JOIN public.org_seat_pools sp ON sp.id = sa.pool_id
                  WHERE sa.user_id = p_actor
                    AND sa.organization_id = p_organization_id
                    AND sp.plan_key IS NOT NULL
                  LIMIT 1
                )
            )
          )
        )
      )
  );
$$;

comment on column public.org_roles.entitlement_profile is
  'Entitlement profile for the role (ADR-0015 §5.3): all | learner | none. '
  'The four legacy management markers left the entitlement catalog in phase 2b-7; authority is permissions only.';

-- ==========================================
-- Closing guard (R26): the key set is gone from every table that carried it,
-- the catalog still holds the six remaining keys (so "zero rows" is not the
-- vacuous answer of an emptied catalog), and the `group.manage` permission —
-- the surviving half of the old overlap — is still in `permissions`.
-- ==========================================
do $$
declare
  v_leftover int;
  v_remaining int;
  v_permission int;
begin
  select count(*) into v_leftover from (
    select feature_key as marker from public.org_role_features
      where feature_key in ('role.builder', 'org.manage', 'member.manage', 'group.manage')
    union all
    select entitlement_key from public.plan_entitlements
      where entitlement_key in ('role.builder', 'org.manage', 'member.manage', 'group.manage')
    union all
    select feature_key from public.user_feature_overrides
      where feature_key in ('role.builder', 'org.manage', 'member.manage', 'group.manage')
    union all
    select key from public.entitlement_flags
      where key in ('role.builder', 'org.manage', 'member.manage', 'group.manage')
    union all
    select key from public.entitlement_catalog
      where key in ('role.builder', 'org.manage', 'member.manage', 'group.manage')
  ) markers;
  if v_leftover <> 0 then
    raise exception 'legacy management markers still present in % row(s)', v_leftover;
  end if;

  select count(*) into v_remaining from public.entitlement_catalog
  where key in ('ai.chat', 'flashcards', 'quiz', 'quiz.builder', 'advanced.stats', 'branding');
  if v_remaining <> 6 then
    raise exception 'entitlement_catalog lost keys it must keep: % of 6 present', v_remaining;
  end if;

  select count(*) into v_permission from public.permissions where key = 'group.manage';
  if v_permission <> 1 then
    raise exception 'the group.manage permission row is missing';
  end if;
end;
$$;
