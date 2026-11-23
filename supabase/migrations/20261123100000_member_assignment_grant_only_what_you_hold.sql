-- Phase 5c of the role-authority programme (ADR-0015 §4.4; 2b-9 register row
-- 13 in docs/plans/role-authority-plan.md; the phase-5b review's should-fix;
-- D16, D21; R4, R18, R19, R26, R27, R40).
--
-- §4.4 "you may only grant permissions/scopes you hold yourself (except an
-- `org.admin` holder, who may grant anything)" held on the INVITE path since
-- 20261122180000, but the MEMBER-ASSIGNMENT path — `PUT
-- /api/v1/organization/members` (`organization-member.service.ts#changeRole`)
-- and the `org_members` UPDATE policy "Org managers update other members" —
-- still gated only on `org.member.manage`, so a member-manager without
-- `org.admin` could assign the system Admin role. This migration closes it
-- with the same machinery, in one definition:
--
--   1. the assignment half of `can_assign_org_role` is extracted into
--      `public.actor_may_assign_org_role(p_actor, p_role_id)` =
--      `covers_permission(p_actor, org, 'org.admin', 'organization')` OR every
--      target-role row with a non-null scope is an `assignable` key the actor
--      covers (the same `not exists` shape as before — no copy of the logic);
--   2. `can_assign_org_role` is redefined as `org.invitation.manage` AND
--      `actor_may_assign_org_role(...)` — one call, no second copy — so the
--      invite helper and the member path share the assignment predicate;
--   3. the wrapper `public.rls_caller_may_assign_org_role(p_role_id)` =
--      `actor_may_assign_org_role(auth.uid(), p_role_id)` is the surface for
--      authenticated callers (the service's API check and the policy's WITH
--      CHECK both call it); like `covers_permission`, the actor-parameterized
--      helper is service_role-only;
--   4. the `org_members` UPDATE policy's WITH CHECK gains
--      `and public.rls_caller_may_assign_org_role(org_role_id)` (the NEW
--      row's role), keeping every existing conjunct — the data-plane twin of
--      the service check (R4).
--
-- `org_role_id` is the only column the API path writes on `org_members`
-- (`changeRole` updates nothing else; the `validate_org_member_org_role`
-- trigger still guards the cross-org reference). Re-runnable: `create or
-- replace function`, `alter policy` and a guarded DO block — a `db reset`
-- and a hand re-apply end in the same state (R19). R27: this file is now the
-- newest owner of `can_assign_org_role` and of the "Org managers update other
-- members" policy, so the replay lists replay it after 20261122180000.

-- ==========================================
-- 1. The single definition of the §4.4 assignment predicate (actor-parameterized).
--
-- SECURITY DEFINER + `search_path = ''` is load-bearing (R18): the body reads
-- `org_roles`/`org_role_permissions`, whose policies call the `rls_caller_*`
-- wrappers back. service_role-only, because it takes an arbitrary actor (R19).
-- ==========================================
create or replace function public.actor_may_assign_org_role(p_actor uuid, p_role_id uuid)
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
      and (
        -- §4.4 / D21: an org.admin holder at organization scope may grant any
        -- role, including the system Admin role.
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

revoke all on function public.actor_may_assign_org_role(uuid, uuid) from public;
revoke all on function public.actor_may_assign_org_role(uuid, uuid) from anon;
revoke all on function public.actor_may_assign_org_role(uuid, uuid) from authenticated;
grant execute on function public.actor_may_assign_org_role(uuid, uuid) to service_role;

-- The authenticated wrapper: a one-line delegate (R40 — no second copy of the
-- predicate), granted like the other `rls_caller_*` wrappers.
create or replace function public.rls_caller_may_assign_org_role(p_role_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.actor_may_assign_org_role(auth.uid(), p_role_id);
$$;

revoke all on function public.rls_caller_may_assign_org_role(uuid) from public, anon;
grant execute on function public.rls_caller_may_assign_org_role(uuid)
  to authenticated, service_role;

-- ==========================================
-- 2. `can_assign_org_role` keeps its capability half and delegates the
--    assignment half — one definition, no copy. Grants unchanged
--    (service_role only, 20261024124757).
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
      and public.actor_may_assign_org_role(p_actor, p_role_id)
  );
$$;

revoke all on function public.can_assign_org_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_assign_org_role(uuid, uuid) to service_role;

-- ==========================================
-- 3. The `org_members` UPDATE policy's WITH CHECK: the new role must also be
--    one the caller may grant. Every existing conjunct stays (the capability,
--    the self-target ban, the same-org role reference); `org_role_id` is the
--    NEW row's column in a WITH CHECK.
-- ==========================================
alter policy "Org managers update other members" on public.org_members
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.member.manage')
    and user_id <> auth.uid()
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.member.manage')
    and user_id <> auth.uid()
    and org_role_id in (
      select r.id from public.org_roles r
      where r.organization_id = org_members.organization_id
    )
    and public.rls_caller_may_assign_org_role(org_role_id)
  );

-- ==========================================
-- Closing guard (R26): the objects this file creates exist AND carry the
-- predicate they are supposed to carry — a dropped function, a wrapper that
-- still carries its own copy, a policy whose WITH CHECK lost the wrapper, or
-- a helper that lost its grants must fail the migration, not pass vacuously.
-- ==========================================
do $$
declare
  v_def text;
begin
  -- 1. actor_may_assign_org_role is the security-definer, search_path-pinned,
  --    service_role-only owner of the assignment predicate, and it references
  --    covers_permission with the assignable/NULL-scope conjunct.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'actor_may_assign_org_role';

  if v_def is null
     or position('covers_permission' in v_def) = 0
     or position('assignable' in v_def) = 0
     or position('is not null' in v_def) = 0
     or not exists (
       select 1
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'actor_may_assign_org_role'
         and p.prosecdef
         and p.proconfig @> array['search_path=""']::text[]
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     )
  then
    raise exception 'actor_may_assign_org_role is not the expected security-definer, search_path-pinned, service_role-only assignment predicate';
  end if;

  -- 2. rls_caller_may_assign_org_role delegates to actor_may_assign_org_role
  --    with auth.uid() and reads no table itself; granted to authenticated and
  --    service_role.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'rls_caller_may_assign_org_role';

  if v_def is null
     or position('public.actor_may_assign_org_role(auth.uid(), p_role_id)' in v_def) = 0
     or position('org_role_permissions' in v_def) > 0
     or not exists (
       select 1
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'rls_caller_may_assign_org_role'
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
     )
  then
    raise exception 'rls_caller_may_assign_org_role no longer delegates to actor_may_assign_org_role(auth.uid(), p_role_id) with the expected grants';
  end if;

  -- 3. can_assign_org_role still requires org.invitation.manage AND delegates
  --    the assignment half to actor_may_assign_org_role — a definition without
  --    the delegate is the bare capability plus a stale copy.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'can_assign_org_role';

  if v_def is null
     or position('org.invitation.manage' in v_def) = 0
     or position('actor_may_assign_org_role' in v_def) = 0
     or position('covers_permission' in v_def) > 0
     or not exists (
       select 1
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'can_assign_org_role'
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     )
  then
    raise exception 'can_assign_org_role no longer combines org.invitation.manage with the delegated actor_may_assign_org_role conjunct (service_role-only)';
  end if;

  -- 4. The org_members UPDATE policy's WITH CHECK names the wrapper (and keeps
  --    the capability conjunct); its USING clause is untouched.
  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'org_members'
      and p.policyname = 'Org managers update other members'
      and p.cmd = 'UPDATE'
      and p.with_check is not null
      and position('rls_caller_may_assign_org_role' in p.with_check) > 0
      and position('org.member.manage' in p.with_check) > 0
      and p.qual is not null
      and position('org.member.manage' in p.qual) > 0
  ) then
    raise exception 'the org_members UPDATE policy no longer requires rls_caller_may_assign_org_role(org_role_id) in its WITH CHECK (with org.member.manage in every clause)';
  end if;

  -- 5. covers_permission still exists with its phase-5b shape and grants —
  --    this file must not drop or redefine it.
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
    raise exception 'covers_permission lost its phase-5b shape or grants (security-definer, search_path-pinned, service_role-only)';
  end if;
end;
$$;
