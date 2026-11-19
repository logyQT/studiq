-- Phase 2a-2 of the role-authority programme (ADR-0015 §4.1, §4.4; R4).
--
-- The role write routes now gate on `org.role.manage` instead of the
-- `role.builder` entitlement. RLS must enforce the same capability in the same
-- PR: `rls_caller_is_org_manager` is `has_org_feature(..., 'member.manage')`, so
-- a custom role holding `org.role.manage` but not `member.manage` would pass the
-- API and be refused at the table (the FP-01 shape: the API/RLS divergence is
-- reachable through PostgREST, not only through a UI bug).
--
-- Scope is the six write policies over `org_roles` and `org_role_permissions`.
-- The two SELECT policies stay org-wide and permission-free: `with-auth.ts`
-- reads the caller's own role permissions on every request, and the role list
-- is readable by every member. `is_org_manager` and every other table's policy
-- are untouched — phase 2b moves the remaining control-plane predicates.

-- ==========================================
-- Caller capability helper.
--
-- SECURITY DEFINER is load-bearing, not decoration: the `org_role_permissions`
-- policies below call this function, and a plain SQL function reading
-- `org_role_permissions` from inside its own policy recurses (42P17). Running as
-- the owner bypasses RLS for the inner lookup, the same pattern
-- `rls_caller_org_ids()` uses for `org_members`.
-- ==========================================
create or replace function public.rls_caller_has_permission(
  p_organization_id uuid,
  p_permission text
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
    where om.user_id = auth.uid()
      and om.organization_id = p_organization_id
      and p.permission_name = p_permission
  );
$$;

revoke all on function public.rls_caller_has_permission(uuid, text) from public;
grant execute on function public.rls_caller_has_permission(uuid, text)
  to authenticated, service_role;

-- ==========================================
-- org_roles writes: org.role.manage (was member.manage via is_org_manager).
-- The `rls_caller_org_ids()` tenant scoping is kept; the capability check only
-- replaces the second predicate.
-- ==========================================
alter policy "Org managers insert roles" on public.org_roles
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
  );

alter policy "Org managers update roles" on public.org_roles
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
  );

alter policy "Org managers delete roles" on public.org_roles
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
  );

-- ==========================================
-- org_role_permissions writes: the role's organization must grant the caller
-- org.role.manage. Same tenant scoping through the parent role.
-- ==========================================
alter policy "Org managers insert role permissions" on public.org_role_permissions
  with check (
    exists (
      select 1 from public.org_roles r
      where r.id = org_role_id
        and r.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_permission(r.organization_id, 'org.role.manage')
    )
  );

alter policy "Org managers update role permissions" on public.org_role_permissions
  using (
    exists (
      select 1 from public.org_roles r
      where r.id = org_role_id
        and r.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_permission(r.organization_id, 'org.role.manage')
    )
  )
  with check (
    exists (
      select 1 from public.org_roles r
      where r.id = org_role_id
        and r.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_permission(r.organization_id, 'org.role.manage')
    )
  );

alter policy "Org managers delete role permissions" on public.org_role_permissions
  using (
    exists (
      select 1 from public.org_roles r
      where r.id = org_role_id
        and r.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_permission(r.organization_id, 'org.role.manage')
    )
  );
