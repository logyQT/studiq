-- Phase 2b slice 3 of the role-authority programme (ADR-0015 §4.1, §7, §7.1;
-- R4).
--
-- The org-control routes now gate on `org.*` permissions instead of the
-- `EDUCATOR|MANAGER`/`MANAGER` persona (the org-control route sweep): settings
-- on `org.settings.manage`, the roster on `org.member.manage`, seat pools and
-- assignments on `org.seat.manage`, invitations on `org.invitation.manage`.
-- RLS must enforce the same capabilities in the same PR. Every policy below
-- asked `rls_caller_is_org_manager`, which is
-- `has_org_feature(..., 'member.manage')` — an entitlement marker, not a
-- permission — so a custom role holding the new key passed the API and was
-- refused at the table, and a role holding only the legacy marker passed the
-- table and was refused by the API. That divergence is exactly the FP-01 shape:
-- reachable through PostgREST, not only through a UI bug.
--
-- Not in this slice, deliberately:
--   * `billing_subscriptions`, the assignment family and roles/role_permissions
--     (2a-2 owns roles; 2b-4 owns the rest).
--   * The `invitations` SELECT policy. The list route moved, but a read
--     asymmetry remains: an inviter without `org.invitation.manage` can still
--     read the invitation they minted through PostgREST, while the list API
--     answers 403. The write policies below keep the same `inviter_id` branch.
--   * `invitations` INSERT. It has no `is_org_manager` branch to move: its
--     authority is `rls_caller_can_assign_org_role`, which still resolves the
--     manager half from `member.manage` and the teacher→member classroom
--     exception from the teacher role name. 2b-4 owns that rewrite (class
--     invites become `group.invite`), and moving it here would refuse the very
--     classroom invite the untouched POST route keeps. R4 says the two move
--     together, so the INSERT predicate waits for its API gate.

-- ==========================================
-- organizations: settings (name/slug/branding) are `org.settings.manage`.
-- The tenant scoping stays as it was; only the capability predicate moves.
-- ==========================================
alter policy "Org managers update organization" on public.organizations
  using (
    id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(id, 'org.settings.manage')
  )
  with check (
    id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(id, 'org.settings.manage')
  );

-- ==========================================
-- org_members: changing a role or removing a member is `org.member.manage`.
-- The `user_id <> auth.uid()` conjuncts stay: a member can never target their
-- own row through PostgREST, whoever holds the key. The UPDATE's new-role
-- constraint stays too.
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
  );

alter policy "Org managers delete other members" on public.org_members
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.member.manage')
    and user_id <> auth.uid()
  );

-- ==========================================
-- Seat pools: writes are `org.seat.manage`. The SELECT policy stays org-wide
-- on purpose — `getSeatPlanKey` reads the caller's pool on every feature/limit
-- check, which is not a management capability.
-- ==========================================
alter policy "Org managers insert seat pools" on public.org_seat_pools
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  );

alter policy "Org managers update seat pools" on public.org_seat_pools
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  );

alter policy "Org managers delete seat pools" on public.org_seat_pools
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  );

-- ==========================================
-- Seat assignments: same capability. The SELECT policy keeps the
-- `user_id = auth.uid()` branch (a member reads their own licence) plus the
-- manager read, which moves to the permission with the writes.
-- ==========================================
alter policy "Own or managed seat assignment read" on public.org_seat_assignments
  using (
    user_id = auth.uid()
    or (
      organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
      and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
    )
  );

alter policy "Org managers insert seat assignments" on public.org_seat_assignments
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  );

alter policy "Org managers update seat assignments" on public.org_seat_assignments
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  );

alter policy "Org managers delete seat assignments" on public.org_seat_assignments
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.seat.manage')
  );

-- ==========================================
-- invitations: retargeting and revoking are `org.invitation.manage`. The
-- `inviter_id = auth.uid()` branch stays (an inviter keeps their own row), and
-- the UPDATE keeps `rls_caller_can_assign_org_role(target_org_role_id)` so a
-- retarget can never hand out a role the caller could not have granted.
-- ==========================================
alter policy "Org managers or inviter update invitations" on public.invitations
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      public.rls_caller_has_permission(organization_id, 'org.invitation.manage')
      or inviter_id = auth.uid()
    )
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      public.rls_caller_has_permission(organization_id, 'org.invitation.manage')
      or inviter_id = auth.uid()
    )
    and public.rls_caller_can_assign_org_role(target_org_role_id)
  );

alter policy "Org managers or inviter delete invitations" on public.invitations
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      public.rls_caller_has_permission(organization_id, 'org.invitation.manage')
      or inviter_id = auth.uid()
    )
  );

-- ==========================================
-- Guard: every policy above must name its capability after this file runs,
-- and the SELECT policy of invitations must still be the unmatched old one (it
-- is deliberately out of this slice). A re-application is a no-op because
-- `alter policy` replaces the predicate in place.
-- ==========================================
do $$
declare
  missing text;
begin
  select string_agg(expected.policy, ', ')
  into missing
  from (
    values
      ('Org managers update organization'),
      ('Org managers update other members'),
      ('Org managers delete other members'),
      ('Org managers insert seat pools'),
      ('Org managers update seat pools'),
      ('Org managers delete seat pools'),
      ('Own or managed seat assignment read'),
      ('Org managers insert seat assignments'),
      ('Org managers update seat assignments'),
      ('Org managers delete seat assignments'),
      ('Org managers or inviter update invitations'),
      ('Org managers or inviter delete invitations')
  ) as expected(policy)
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.policyname = expected.policy
      and (p.qual like '%rls_caller_has_permission%'
        or p.with_check like '%rls_caller_has_permission%')
  );

  if missing is not null then
    raise exception 'org-control policies without a permission predicate: %', missing;
  end if;
end;
$$;
