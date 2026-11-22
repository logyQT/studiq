-- Phase 3c of the role-authority programme (ADR-0015 §5 Batch 3, §6.1,
-- D19/D27/D31).
--
-- The org plan is the only org entitlement state. `organizations.plan` is
-- resolved live through `plan_entitlements`/`plan_limits`, and the role layer
-- through `org_roles.entitlement_profile`, so the legacy writer
-- `apply_org_plan` — which rewrote the `org_role_features` grant rows on every
-- plan change — has nothing left to keep in sync. It becomes
-- `change_org_plan`, which moves the plan and nothing else.
--
-- `org_role_features` flips to revokes-only (D19/D27): the plan-shaped grant
-- rows created by the old writer and the org-creation trigger are deleted, and
-- only a hand-inserted `is_enabled = false` row can still subtract a key from
-- the profile. An enabled row is inert — the resolver ignores it and so does
-- the RLS twin — so the column keeps its `true` default: a natural insert that
-- omits `is_enabled` changes nothing, while a `false` default would silently
-- revoke that key. Revoke rows stay readable until phase 7.
--
-- The function redefinitions come before the delete on purpose: a fresh replay
-- must never run a trigger body or an RLS twin that still expects the grant
-- shape the delete removes.

-- ==========================================
-- The plan writer, reduced to the plan move.
--
-- `apply_entitlement_fenced` (the webhook's fenced writer) calls this in the
-- same transaction that locks the subscription mirror. Authorization stays
-- where it was: only the service role executes it, and the webhook resolver
-- has already checked the purchaser owns the org.
-- ==========================================
create or replace function public.change_org_plan(p_org_id uuid, p_plan text)
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

  -- The org layer is derived live from the plan catalog plus the role's
  -- `entitlement_profile`, so a snapshot write here would only drift.
  UPDATE public.organizations SET plan = p_plan WHERE id = p_org_id;
END;
$$;

revoke all on function public.change_org_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.change_org_plan(uuid, text) to service_role;

-- ==========================================
-- Fenced webhook writer: same definition as
-- `20261106120000_billing_entitlement_owner_fence.sql`, with the org branch
-- calling `change_org_plan`. The owner/fence checks are unchanged.
-- ==========================================
CREATE OR REPLACE FUNCTION public.apply_entitlement_fenced(
  p_owner_type text,
  p_owner_id uuid,
  p_plan text,
  p_subscription_id text,
  p_event_created bigint,
  p_snapshot_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last_event_created bigint;
  v_snapshot_generation bigint;
  v_user_id uuid;
  v_organization_id uuid;
BEGIN
  IF p_owner_type NOT IN ('user', 'org') THEN
    RAISE EXCEPTION 'owner type must be user or org (got %)', p_owner_type USING ERRCODE = '22023';
  END IF;

  SELECT s.last_event_created, s.snapshot_generation, s.user_id, s.organization_id
    INTO v_last_event_created, v_snapshot_generation, v_user_id, v_organization_id
  FROM public.billing_subscriptions s
  WHERE s.stripe_subscription_id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_last_event_created > p_event_created THEN
    RETURN false;
  END IF;

  IF v_snapshot_generation <> p_snapshot_generation THEN
    RETURN false;
  END IF;

  -- Null-safe: an organization row has no user_id and a user row has no
  -- organization_id, so a crossed owner always differs.
  IF p_owner_type = 'user' THEN
    IF v_user_id IS DISTINCT FROM p_owner_id THEN
      RETURN false;
    END IF;
  ELSE
    IF v_organization_id IS DISTINCT FROM p_owner_id THEN
      RETURN false;
    END IF;
  END IF;

  IF p_owner_type = 'org' THEN
    PERFORM public.change_org_plan(p_owner_id, p_plan);
  ELSE
    UPDATE public.profiles
    SET personal_plan_key = p_plan
    WHERE id = p_owner_id;
  END IF;

  UPDATE public.billing_subscriptions
  SET entitlement_applied_plan_key = p_plan
  WHERE stripe_subscription_id = p_subscription_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint, bigint)
  TO service_role;

-- ==========================================
-- Org creation: profiles, permissions and roles only.
--
-- The plan-entitlements seeding loop is gone with the snapshot writer. The
-- three system roles keep their `entitlement_profile` (`all`, `all`,
-- `learner`), permissions come from `seed_system_role_permissions`, and no
-- per-role feature rows are written.
-- ==========================================
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  -- 1. Create default roles
  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system, entitlement_profile)
  VALUES (NEW.id, 'admin', 'Org manager — settings, members, roles', 'Admin', true, 'all');

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system, entitlement_profile)
  VALUES (NEW.id, 'teacher', 'Educator — CRUD over own content', 'Teacher', true, 'all');

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system, entitlement_profile)
  VALUES (NEW.id, 'member', 'Base learner — read own + group content, create own', 'Student', true, 'learner');

  -- 2. Seed the permission catalog per role (ADR-0015 §4.2 templates). Group
  --    and org authority is granted here; entitlement keys live in
  --    `entitlement_catalog` and are never permissions.
  PERFORM public.seed_system_role_permissions(NEW.id);

  -- NOTE: Org limits are no longer snapshotted (#229). They are resolved live
  -- from organizations.plan -> plan_limits.
  -- NOTE: Entitlements are profile-derived (ADR-0015 D19): each role carries
  -- its `entitlement_profile` and the org layer resolves live from
  -- organizations.plan, so no per-role feature rows are written here.
  -- NOTE: Seat pools are NO LONGER seeded at org creation (Phase B.5).
  -- Pools are created on-demand when seats are purchased (addPool).

  RETURN NEW;
END;
$$;

-- ==========================================
-- RLS twin of the resolver's org layer (FP-01).
--
-- `org_role_features` is revokes-only since this migration, so no row can
-- grant a key and the twin never tests for one: an enabled row is inert in the
-- resolver and here. The composition follows the resolver's order:
--
--   profile 'all'      → the plan ceiling
--   profile 'learner'  → LEARNER_ENTITLEMENTS ∩ ceiling
--   profile 'none'     → nothing
--   − revoke rows      → `is_enabled = false` subtracts its key from the
--                        profile arm only
--   + seat plan keys   → seat plan ∩ ceiling, added after the revokes, so a
--                        seat key re-adds a revoked one
--
-- One deliberate divergence, owned by phase 5: the system Admin role holds
-- every key. The resolver has no admin branch (admin is profile `all` ∩
-- ceiling); the wildcard is what keeps the deferred org-delete path working
-- until phase 5 aligns the two.
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
        -- The one deliberate divergence from the resolver (phase 5 owns it).
        (r.is_system AND r.name = 'admin')
        OR (
          (
            -- Profile base layer (ADR-0015 §5.3), then the revokes: the
            -- resolver applies revokes before the seat plan, so a revoke only
            -- subtracts what the profile granted.
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
            AND NOT EXISTS (
              SELECT 1
              FROM public.org_role_features fr
              WHERE fr.org_role_id = r.id
                AND fr.feature_key = p_feature
                AND NOT fr.is_enabled
            )
          )
          -- Seat plan ∩ ceiling: the seat can add a key the org plan carries,
          -- never one it does not, and it runs after the revokes.
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
              AND EXISTS (
                SELECT 1
                FROM public.plan_entitlements pfc
                WHERE pfc.entitlement_key = p_feature
                  AND pfc.plan_key = o.plan
              )
          )
        )
      )
  );
$$;

-- ==========================================
-- The snapshot writer leaves.
--
-- Its only remaining caller was `apply_entitlement_fenced`, re-created above.
-- `if exists` keeps this migration replayable on a database that already ran
-- it.
-- ==========================================
drop function if exists public.apply_org_plan(uuid, text);

-- The plan-shaped grant rows are inert state that contradicts the live
-- resolution. Only explicit revokes (`is_enabled = false`) survive: an enabled
-- row is inert (ignored by both the resolver and the RLS twin), which is why
-- the column keeps its `true` default — a natural insert changes nothing.
-- Revoke rows are readable until phase 7 (D19/D27) and a role that carries
-- one still subtracts it.
delete from public.org_role_features
where is_enabled;

comment on table public.org_role_features is
  'Revokes-only since ADR-0015 phase 3c (D19/D27): an enabled row is inert '
  '(ignored by both resolveEntitlements() and has_org_feature()); only '
  'is_enabled = false has an effect, and it must be explicit.';

-- ==========================================
-- Closing guard (R26/R34): the writer is gone, the two callsites move, the
-- plan move is the whole write, the RLS twin reads revokes and never grants,
-- and no enabled row survives. Every assertion is idempotent, so re-running
-- this file on an already-migrated database passes.
-- ==========================================
do $$
declare
  v_body text;
  v_stripped text;
  v_forbidden text;
  v_enabled int;
  v_comment text;
begin
  if to_regprocedure('public.apply_org_plan(uuid,text)') is not null then
    raise exception 'apply_org_plan still exists';
  end if;

  if to_regprocedure('public.change_org_plan(uuid,text)') is null then
    raise exception 'change_org_plan is missing';
  end if;

  v_body := lower(pg_get_functiondef('public.apply_entitlement_fenced(text,uuid,text,text,bigint,bigint)'::regprocedure));
  if position('change_org_plan' in v_body) = 0 then
    raise exception 'apply_entitlement_fenced does not call change_org_plan';
  end if;
  if position('apply_org_plan' in v_body) > 0 then
    raise exception 'apply_entitlement_fenced still calls apply_org_plan';
  end if;

  -- `change_org_plan` is the plan move and nothing else: it updates
  -- `organizations.plan` and names no other entitlements-bearing table.
  v_body := lower(pg_get_functiondef('public.change_org_plan(uuid,text)'::regprocedure));
  if position('update public.organizations set plan' in v_body) = 0 then
    raise exception 'change_org_plan does not move organizations.plan';
  end if;
  foreach v_forbidden in array array[
    'org_role_features',
    'plan_limits',
    'org_role_permissions',
    'plan_entitlements'
  ] loop
    if position(v_forbidden in v_body) > 0 then
      raise exception 'change_org_plan still writes % (the plan move is the whole write)', v_forbidden;
    end if;
  end loop;

  v_body := lower(pg_get_functiondef('public.handle_new_organization()'::regprocedure));
  if position('org_role_features' in v_body) > 0 then
    raise exception 'handle_new_organization still touches org_role_features';
  end if;

  v_body := lower(pg_get_functiondef('public.has_org_feature(uuid,uuid,text)'::regprocedure));

  -- The twin names the table exactly once: the revoke subtraction. A second
  -- reference is a grant row or a row-existence gate, which the table's
  -- polarity no longer supports.
  if regexp_count(v_body, 'org_role_features') <> 1 then
    raise exception 'has_org_feature must name org_role_features exactly once (revoke subtraction), found %',
      regexp_count(v_body, 'org_role_features');
  end if;

  -- `is_enabled` appears exactly once, negated. Strip the revoke shape
  -- (`not <alias>.is_enabled`) and any remainder is a positive predicate —
  -- keyed on the shape, not an alias, so renaming `fr` cannot evade it and
  -- `is_enabled = false` inside a NOT is not mistaken for a revoke.
  if regexp_count(v_body, 'is_enabled') <> 1 then
    raise exception 'has_org_feature references is_enabled % time(s), expected the one negated revoke', regexp_count(v_body, 'is_enabled');
  end if;
  v_stripped := regexp_replace(v_body, 'not[[:space:]]+[a-z_][a-z0-9_]*\.is_enabled', '', 'g');
  if position('is_enabled' in v_stripped) > 0 then
    raise exception 'has_org_feature has a positive is_enabled predicate';
  end if;

  -- Only meaningful on the upgrade path: a from-scratch database has no orgs,
  -- so this counts zero because there is nothing to count, not because the
  -- delete ran.
  select count(*) into v_enabled from public.org_role_features where is_enabled;
  if v_enabled <> 0 then
    raise exception 'org_role_features still holds % enabled row(s)', v_enabled;
  end if;

  select obj_description('public.org_role_features'::regclass) into v_comment;
  if v_comment is null or position('revoke' in lower(v_comment)) = 0 then
    raise exception 'org_role_features is missing its revokes-only comment';
  end if;
end;
$$;
