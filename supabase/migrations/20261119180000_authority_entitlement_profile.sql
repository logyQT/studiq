-- Phase 2a-1 of the role-authority programme (ADR-0015 §5.3, §6.1, §6.3, §8.1).
--
-- `org_roles.entitlement_profile` makes the role the entitlement subject:
--   * `all`     — the org ceiling minus the four legacy management markers;
--   * `learner` — `LEARNER_ENTITLEMENTS` intersected with the ceiling;
--   * `none`    — nothing (custom roles, fail-closed).
-- The profile governs non-marker entitlement keys. The four legacy management
-- markers (`org.manage`, `member.manage`, `role.builder`, `group.manage`) stay
-- row-sourced in `org_role_features` until phase 2b replaces their gates with
-- permissions (D6/D18, FP-04): a Teacher profile is `all` and must never pick up
-- `member.manage`/`role.builder` from it.
--
-- Both the resolver (API) and `has_org_feature` (RLS/PostgREST) read this
-- column, in the same PR, because the zero-row fallback was exploitable through
-- PostgREST (R4, FP-01).

alter table public.org_roles
  add column entitlement_profile text not null default 'none'
    check (entitlement_profile in ('all', 'learner', 'none'));

comment on column public.org_roles.entitlement_profile is
  'Entitlement profile for the role (ADR-0015 §5.3): all | learner | none. '
  'The four legacy management markers stay row-sourced in org_role_features until phase 2b.';

-- One-time backfill of the existing system roles. `is_system` is nullable, so
-- the predicate is explicit: a NULL stays on the fail-closed default `none`.
update public.org_roles
set entitlement_profile = case when name = 'member' then 'learner' else 'all' end
where is_system is true
  and name in ('admin', 'teacher', 'member');

-- ==========================================
-- System-role permission seeding, as a callable function.
--
-- A `db reset` runs migrations before any organization exists, so the backfill
-- above touches nothing there; the trigger and `09_perms.sql` call this instead.
-- That is the phase-1b lesson: a data fix that runs where no data exists yet
-- needs a callable form, because "it ran in the migration" is not evidence.
--
-- `on conflict do nothing` is load-bearing: the function is called on every org
-- creation and on every seed run, and it must never overwrite a permission an
-- admin granted through the role editor.
-- ==========================================
create or replace function public.seed_system_role_permissions(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  -- admin: every content, group and org key at organization scope.
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT r.id, p.key, 'organization'
  FROM public.org_roles r
  JOIN public.permissions p ON p.category IN ('content', 'group', 'org')
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND r.name = 'admin'
  ON CONFLICT DO NOTHING;

  -- teacher: every content key (assignment.* included) at own scope, except
  -- `stats.read` (ADR §4.2: group scope); the four group keys at group scope.
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT r.id, p.key,
    CASE
      WHEN p.key = 'stats.read' THEN 'group'
      WHEN p.category = 'content' THEN 'own'
      ELSE 'group'
    END
  FROM public.org_roles r
  JOIN public.permissions p ON p.category IN ('content', 'group')
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND r.name = 'teacher'
  ON CONFLICT DO NOTHING;

  -- member: every content key except the staff-only `assignment.*` family. Reads
  -- are group-scoped, writes own-scoped — except `stats.read`, which the ADR
  -- §4.2 matrix grants at own scope (nothing reads it until phase 5, so this is
  -- free, but the matrix is the contract).
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT r.id, p.key,
    CASE
      WHEN p.key = 'stats.read' THEN 'own'
      WHEN p.key LIKE '%.read' THEN 'group'
      ELSE 'own'
    END
  FROM public.org_roles r
  JOIN public.permissions p
    ON p.category = 'content'
   AND p.key NOT LIKE 'assignment.%'
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND r.name = 'member'
  ON CONFLICT DO NOTHING;

  -- member: read the class roster (nothing else from the group catalog).
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT r.id, 'group.read', 'group'
  FROM public.org_roles r
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND r.name = 'member'
  ON CONFLICT DO NOTHING;
END;
$$;

revoke all on function public.seed_system_role_permissions(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_system_role_permissions(uuid) to service_role;

-- Existing organizations created before the trigger learned the function.
select public.seed_system_role_permissions(id) from public.organizations;

-- ==========================================
-- Org-creation trigger: roles carry their profile, permissions come from the
-- function.
--
-- The `org_role_features` plan-seeding loop stays unchanged. The legacy writer
-- survives until phase 3 (D19); the profile is authoritative for non-marker
-- keys, and `apply_org_plan` keeps the plan-shaped rows the RLS explicit-row
-- branch and the marker grants read.
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

-- ==========================================
-- RLS twin of the resolver's org layer (FP-01).
--
-- The `(r.is_system AND r.name = 'admin')` branch and the explicit-row EXISTS
-- branch are kept exactly as they were. Only the zero-row fallback changes: it
-- used to inherit `plan_entitlements(organizations.plan)`, which handed a
-- zero-row custom role the whole ceiling through PostgREST. It now reads the
-- profile, and unions the seat plan the way the resolver does:
--
--   profile 'all'     → ceiling minus the four legacy markers
--   profile 'learner' → LEARNER_ENTITLEMENTS ∩ ceiling
--   profile 'none'    → nothing
--   + seat plan keys  → zero-row roles only, minus the three admin-only markers
--                       (a seated non-admin is stripped by
--                       `stripAdminOnlyForNonAdmin`)
--
-- The union matters inside this branch: the resolver composes profile base + seat
-- plan, so a substitution would be narrower than the API for a zero-row seated
-- learner.
--
-- It is not full seat parity: the seat `OR` sits inside `NOT EXISTS(rows)`, so a
-- role that owns any `org_role_features` row never sees its seat plan while the
-- resolver applies it unconditionally. No user-visible gap today (every
-- seat-eligible key is reachable through the row branch for such a role); phase 4
-- closes it when `org_seat_pools.plan_key` becomes all-`seatEligible` (D15) — see
-- this slice's follow-up in the phase-2 ledger.
-- ==========================================
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
        -- Equivalent to the resolver's enabled `org.manage` row: the trigger
        -- grants it to the admin role and `apply_org_plan` never revokes it.
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
            -- Profile base layer (ADR-0015 §5.3).
            CASE r.entitlement_profile
              WHEN 'all' THEN
                p_feature NOT IN (
                  'org.manage', 'member.manage', 'role.builder', 'group.manage'
                )
                AND EXISTS (
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
            -- runs after the profile and before the admin-only strip.
            OR (
              p_feature NOT IN ('org.manage', 'member.manage', 'role.builder')
              AND EXISTS (
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
      )
  );
$$;

-- ACLs are unchanged by CREATE OR REPLACE; `has_org_feature` stays service-role
-- only and `handle_new_organization` is a trigger.
