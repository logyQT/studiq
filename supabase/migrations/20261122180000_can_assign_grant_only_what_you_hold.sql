-- Phase 5b of the role-authority programme (ADR-0015 §4.4; 2b-9 register row 9
-- in docs/plans/role-authority-plan.md; D16, D21; R4, R18, R19, R26).
--
-- §4.4: "You may only grant permissions/scopes you hold yourself (except an
-- `org.admin` holder, who may grant anything)." 2b-8 built the covers logic as
-- `rls_caller_covers_permission` and used it in the role-editor guard
-- (`rls_caller_may_set_role_permission`); the invite helper
-- `can_assign_org_role` still checked only the `org.invitation.manage`
-- capability, so any holder of that key could mint an org invite targeting the
-- system Admin role. This migration adds the conjunct:
--
--   1. the covers logic is factored into ONE actor-parameterized definition,
--      `public.covers_permission(p_actor, p_org, p_key, p_scope)`, and
--      `rls_caller_covers_permission` is re-expressed as a one-line delegate
--      (`select public.covers_permission(auth.uid(), …)`) with byte-identical
--      semantics — no second copy of the scope-rank rule;
--   2. `can_assign_org_role(p_actor, p_role_id)` = the existing
--      `org.invitation.manage` capability AND (`covers_permission(p_actor, org,
--      'org.admin', 'organization')` OR every target-role row with a non-null
--      scope is an `assignable` key the caller covers at that scope). NULL-scope
--      rows are revocations and grant nothing, so they are ignored.
--
-- Pinned consequences: a capability holder who is not `org.admin` can never
-- invite into the system Admin role (its `org.admin` row is `assignable =
-- false` and they do not hold it); an `org.admin` holder can invite into any
-- role; a role whose keys are all held at covering scopes is assignable.
--
-- Re-runnable: `create or replace function` plus a guarded DO block — a
-- `db reset` and a hand re-apply end in the same state (R19).

-- ==========================================
-- 1. The single definition of the scope-coverage rule.
--
-- SECURITY DEFINER + `search_path = ''` is load-bearing (R18): the body reads
-- `org_members`/`org_role_permissions`, whose policies call the
-- `rls_caller_*` wrappers back. Like `has_permission`, the actor-parameterized
-- helper is service_role-only; the `rls_caller_*` wrappers (granted to
-- `authenticated`) delegate to it, which is safe because a SECURITY DEFINER
-- function's inner calls run as its owner (R19).
-- The scope ranks mirror `scopeCovers` in @studiq/authz (own < group <
-- organization); an unknown value ranks as covering nothing / needing more
-- than anything, so the comparison fails closed both ways.
-- ==========================================
create or replace function public.covers_permission(
  p_actor uuid,
  p_org uuid,
  p_key text,
  p_scope text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.org_members om
    join public.org_role_permissions p on p.org_role_id = om.org_role_id
    where om.user_id = p_actor
      and om.organization_id = p_org
      and (
        -- D21: an org.admin holder at organization scope covers anything — a
        -- single-admin org must still be able to edit its own Admin role.
        (p.permission_key = 'org.admin' and p.scope = 'organization')
        or (
          p.permission_key = p_key
          and case p.scope
                when 'own' then 0
                when 'group' then 1
                when 'organization' then 2
                else -1
              end
              >= case p_scope
                   when 'own' then 0
                   when 'group' then 1
                   when 'organization' then 2
                   else 3
                 end
        )
      )
  );
$$;

revoke all on function public.covers_permission(uuid, uuid, text, text) from public;
revoke all on function public.covers_permission(uuid, uuid, text, text) from anon;
revoke all on function public.covers_permission(uuid, uuid, text, text) from authenticated;
grant execute on function public.covers_permission(uuid, uuid, text, text) to service_role;

-- The wrapper keeps its grants (restated so a re-apply cannot drift — R19) and
-- is now a one-line delegate: identical semantics, one definition of the rule.
create or replace function public.rls_caller_covers_permission(
  p_organization_id uuid,
  p_permission text,
  p_scope text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.covers_permission(auth.uid(), p_organization_id, p_permission, p_scope);
$$;

revoke all on function public.rls_caller_covers_permission(uuid, text, text) from public, anon;
grant execute on function public.rls_caller_covers_permission(uuid, text, text)
  to authenticated, service_role;

-- ==========================================
-- 2. `can_assign_org_role` gains the §4.4 conjunct. The capability half is
-- unchanged (`org.invitation.manage` in the target role's org); the new half is
-- the org.admin exemption OR the grant-only-what-you-hold check over the
-- target role's rows. Grants unchanged: service_role only (20261024124757).
-- ==========================================
create or replace function public.can_assign_org_role(p_actor uuid, p_role_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.org_roles target
    where target.id = p_role_id
      and public.has_permission(p_actor, target.organization_id, 'org.invitation.manage')
      and (
        -- §4.4 / D21: an org.admin holder at organization scope may invite
        -- into any role, including the system Admin role.
        public.covers_permission(p_actor, target.organization_id, 'org.admin', 'organization')
        or not exists (
          -- Every target-role row with a non-null scope must be an assignable
          -- key (D16: `org.admin` is never grantable) that the caller covers
          -- at that scope. NULL-scope rows are revocations and are ignored.
          select 1
          from public.org_role_permissions rp
          where rp.org_role_id = target.id
            and rp.scope is not null
            and (
              not exists (
                select 1
                from public.permissions perm
                where perm.key = rp.permission_key
                  and perm.assignable
              )
              or not public.covers_permission(
                   p_actor, target.organization_id, rp.permission_key, rp.scope
                 )
            )
        )
      )
  );
$$;

revoke all on function public.can_assign_org_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_assign_org_role(uuid, uuid) to service_role;

-- ==========================================
-- Closing guard (R26): the objects this file creates exist AND carry the
-- predicate they are supposed to carry — a dropped function, a wrapper that
-- still carries its own copy of the scope-rank rule, or a `can_assign_org_role`
-- that no longer references `covers_permission` (i.e. still returns the bare
-- capability) must fail the migration, not pass vacuously.
-- ==========================================
do $$
declare
  v_def text;
begin
  -- 1. covers_permission is the single security-definer definition of the
  --    coverage rule, with a pinned search_path, executable by service_role
  --    only.
  if not exists (
    select 1
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'covers_permission'
      and p.prosecdef
      and p.proconfig @> array['search_path=""']::text[]
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'covers_permission is not the expected security-definer, search_path-pinned, service_role-only helper';
  end if;

  -- 2. rls_caller_covers_permission delegates to covers_permission and no
  --    longer reads org_members/org_role_permissions itself (no second copy of
  --    the scope-rank rule).
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'rls_caller_covers_permission';

  if v_def is null
     or position('public.covers_permission(' in v_def) = 0
     or position('auth.uid()' in v_def) = 0
     or position('org_role_permissions' in v_def) > 0
  then
    raise exception 'rls_caller_covers_permission no longer delegates to covers_permission(auth.uid(), …) as a one-line wrapper';
  end if;

  -- 3. can_assign_org_role still requires org.invitation.manage AND now
  --    references covers_permission with the assignable/revocation conjunct —
  --    a definition without covers_permission is the bare capability.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'can_assign_org_role';

  if v_def is null
     or position('org.invitation.manage' in v_def) = 0
     or position('covers_permission' in v_def) = 0
     or position('assignable' in v_def) = 0
     or position('is not null' in v_def) = 0
  then
    raise exception 'can_assign_org_role no longer combines org.invitation.manage with the §4.4 covers_permission conjunct (assignable keys, NULL-scope revocations ignored)';
  end if;

  -- 4. can_assign_org_role stays service_role-only.
  if not exists (
    select 1
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'can_assign_org_role'
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'can_assign_org_role is no longer service_role-only';
  end if;
end;
$$;
