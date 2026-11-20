-- Phase 2b slice 5 of the role-authority programme (ADR-0015 §4.3, §7.1, §10,
-- §15 #7; D7, D25, R4, R25, R26).
--
-- Class invites. ADR-0015 §4.3/§10 assume `invitations.group_id` +
-- `target_group_role`; the table did not have them. This migration adds the two
-- columns and makes the class-invite rule real in both planes:
--
--   * an ORG invite (both columns null) is `org.invitation.manage` on the
--     invitation's organization — the capability 2b-3 already moved the list,
--     retarget and revoke routes onto;
--   * a CLASS invite (both columns set) is `group.invite` on that group, via
--     2b-2's `rls_caller_has_group_permission`, unchanged. §4.1 gives
--     `group.invite` no `own` scope, so the helper's creator branch (guarded by
--     `allowed_scopes @> '{own}'`) grants nothing here; the API applies the
--     role-row conjunct where it already does (`resolveGroupScope` /
--     `requireGroupPermission` in the controller), because the helper's teacher
--     branch is scope-agnostic by 2b-2 design — the same asymmetry
--     `group.manage`/`group.member.manage` already carry.
--
-- `can_assign_org_role`'s manager half moves off the legacy `member.manage`
-- marker onto `org.invitation.manage` (the key the invitation write now asks
-- for), and its teacher-role-name exception is DELETED (§8.3, §15 #7): a
-- teacher invites through `group.invite` on a class invite, never through an
-- org invite. The invitation SELECT moves in the same file (R25): PostgREST
-- refuses an UPDATE whose row the SELECT policy hides, so the read and the
-- write halves land together — 2b-4 measured exactly that.
--
-- The accept RPC gains the class branch: a class invite's invitee must already
-- be an org member (D7 — checked BEFORE the claim so a refused accept never
-- consumes the token), the org-role upsert becomes a no-op for that member, and
-- the target group is joined with `target_group_role` (idempotent upsert). A
-- class invite can therefore never create an org membership or grant/change an
-- org role, no matter what `target_org_role_id` the row carries.
--
-- Re-runnable: `add column if not exists`, guarded constraint DO blocks,
-- `if not exists` index, `alter policy` (replaces in place), `create or replace`
-- function/trigger — a `db reset` and a hand re-apply both end in the same
-- state (R19).

-- ==========================================
-- Schema: the two class-invite columns.
--
-- The pair CHECK is the invariant: an org invite has neither, a class invite
-- has both. `target_group_role` is constrained to the `group_members.role`
-- values (the table's CHECK is the same two literals). The index serves the
-- per-group read of the class branch. `on delete cascade`: deleting a class
-- deletes its pending invites.
-- ==========================================
alter table public.invitations
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

alter table public.invitations
  add column if not exists target_group_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invitations'::regclass
      and conname = 'invitations_target_group_role_check'
  ) then
    alter table public.invitations
      add constraint invitations_target_group_role_check
      check (target_group_role in ('teacher', 'member'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invitations'::regclass
      and conname = 'invitations_group_pair_check'
  ) then
    alter table public.invitations
      add constraint invitations_group_pair_check
      check ((group_id is null) = (target_group_role is null));
  end if;
end;
$$;

create index if not exists invitations_group_id_idx on public.invitations (group_id);

-- ==========================================
-- The write trigger also validates the group: a class invite whose group
-- belongs to another organization would write that tenant's class into this
-- org's `group_members` on accept.
-- ==========================================
create or replace function public.validate_invitation_target_org_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role_org  uuid;
  v_group_org uuid;
begin
  select r.organization_id into v_role_org
  from public.org_roles r
  where r.id = new.target_org_role_id;

  if v_role_org is null or v_role_org is distinct from new.organization_id then
    raise exception 'invitation target role % does not belong to organization %',
      new.target_org_role_id, new.organization_id
      using errcode = '23514';
  end if;

  if new.group_id is not null then
    select g.organization_id into v_group_org
    from public.groups g
    where g.id = new.group_id;

    if v_group_org is null or v_group_org is distinct from new.organization_id then
      raise exception 'invitation group % does not belong to organization %',
        new.group_id, new.organization_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger validate_invitation_target_org_role
  before insert or update of target_org_role_id, organization_id, group_id
  on public.invitations
  for each row execute function public.validate_invitation_target_org_role();

-- ==========================================
-- Actor-parameterized capability helpers (service_role only), so the
-- service-role accept/preview flow can re-check the INVITER's authority with
-- an explicit actor — the same shape `is_org_manager(p_actor, …)` uses. The
-- `rls_caller_*` wrappers delegate to them, so each rule has one definition.
--
-- SECURITY DEFINER + `search_path = ''` is load-bearing (R18): these read
-- `org_members`/`org_role_permissions`/`group_members`/`groups`, whose own
-- policies call the wrappers back.
-- ==========================================
create or replace function public.has_permission(
  p_actor uuid,
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
    join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
    where om.user_id = p_actor
      and om.organization_id = p_organization_id
      and rp.permission_key = p_permission
  );
$$;

create or replace function public.has_group_permission(
  p_actor uuid,
  p_group_id uuid,
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
    from public.groups g
    join public.org_members om
      on om.organization_id = g.organization_id
     and om.user_id = p_actor
    where g.id = p_group_id
      and p_permission like 'group.%'
      and exists (
        select 1
        from public.permissions p
        where p.key = p_permission
          and p.category = 'group'
      )
      and (
        exists (
          select 1
          from public.group_members gm
          where gm.group_id = g.id
            and gm.user_id = p_actor
            and gm.role = 'teacher'
        )
        or (
          g.created_by = p_actor
          and exists (
            select 1
            from public.permissions p
            where p.key = p_permission
              and p.category = 'group'
              and p.allowed_scopes @> array['own'::text]
          )
        )
        or exists (
          select 1
          from public.org_role_permissions rp
          where rp.org_role_id = om.org_role_id
            and rp.permission_key = p_permission
            and rp.scope = 'organization'
        )
      )
  );
$$;

revoke all on function public.has_permission(uuid, uuid, text) from public;
revoke all on function public.has_permission(uuid, uuid, text) from anon;
grant execute on function public.has_permission(uuid, uuid, text) to service_role;

revoke all on function public.has_group_permission(uuid, uuid, text) from public;
revoke all on function public.has_group_permission(uuid, uuid, text) from anon;
grant execute on function public.has_group_permission(uuid, uuid, text) to service_role;

-- The wrappers keep their grants (create or replace preserves the ACL, and the
-- grants are restated so a re-apply cannot drift — R19) and now delegate.
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
  select public.has_permission(auth.uid(), p_organization_id, p_permission);
$$;

create or replace function public.rls_caller_has_group_permission(
  p_group_id uuid,
  p_permission text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.has_group_permission(auth.uid(), p_group_id, p_permission);
$$;

revoke all on function public.rls_caller_has_permission(uuid, text) from public;
revoke all on function public.rls_caller_has_permission(uuid, text) from anon;
grant execute on function public.rls_caller_has_permission(uuid, text)
  to authenticated, service_role;

revoke all on function public.rls_caller_has_group_permission(uuid, text) from public;
revoke all on function public.rls_caller_has_group_permission(uuid, text) from anon;
grant execute on function public.rls_caller_has_group_permission(uuid, text)
  to authenticated, service_role;

-- ==========================================
-- `can_assign_org_role`: the manager half moves from the legacy
-- `member.manage` marker (`is_org_manager`) onto `org.invitation.manage`, and
-- the teacher-role-name exception (system `member` grantable by a system
-- `teacher`) is deleted — §8.3, §15 #7. A teacher invites students through a
-- CLASS invite (`group.invite` on the group), never through an org invite.
-- The service-role wrapper and its grants are unchanged.
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
  );
$$;

-- ==========================================
-- The four invitations policies, split by row shape. The tenant floor
-- (`rls_caller_org_ids()`) and the `inviter_id = auth.uid()` branch stay on
-- every read/write; the org-invite capability branch is
-- `org.invitation.manage` (+ `can_assign_org_role` on INSERT/UPDATE), the
-- class-invite branch is `group.invite` on the row's group. The SELECT moves
-- with the writes (R25).
-- ==========================================
alter policy "Org managers or inviter read invitations" on public.invitations
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      (group_id is null
        and public.rls_caller_has_permission(organization_id, 'org.invitation.manage'))
      or (group_id is not null
        and public.rls_caller_has_group_permission(group_id, 'group.invite'))
      or inviter_id = auth.uid()
    )
  );

alter policy "Authorized inviter insert invitations" on public.invitations
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and inviter_id = auth.uid()
    and (
      (group_id is null
        and public.rls_caller_has_permission(organization_id, 'org.invitation.manage')
        and public.rls_caller_can_assign_org_role(target_org_role_id))
      or (group_id is not null
        and public.rls_caller_has_group_permission(group_id, 'group.invite'))
    )
  );

alter policy "Org managers or inviter update invitations" on public.invitations
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      (group_id is null
        and public.rls_caller_has_permission(organization_id, 'org.invitation.manage'))
      or (group_id is not null
        and public.rls_caller_has_group_permission(group_id, 'group.invite'))
      or inviter_id = auth.uid()
    )
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      (group_id is null
        and (
          public.rls_caller_has_permission(organization_id, 'org.invitation.manage')
          or inviter_id = auth.uid()
        )
        and public.rls_caller_can_assign_org_role(target_org_role_id))
      or (group_id is not null
        and (
          public.rls_caller_has_group_permission(group_id, 'group.invite')
          or inviter_id = auth.uid()
        ))
    )
  );

alter policy "Org managers or inviter delete invitations" on public.invitations
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and (
      (group_id is null
        and public.rls_caller_has_permission(organization_id, 'org.invitation.manage'))
      or (group_id is not null
        and public.rls_caller_has_group_permission(group_id, 'group.invite'))
      or inviter_id = auth.uid()
    )
  );

-- ==========================================
-- The accept RPC gains the class branch (see the header). The org branch is
-- byte-for-byte the old behaviour; the class branch refuses a non-member
-- BEFORE the claim (a refused accept never consumes the token), performs the
-- org-membership write as a no-op for the existing member (the org role is
-- NOT granted or changed by a class invite), upserts the target group with
-- `target_group_role`, and joins the default group as the org path does.
-- ==========================================
create or replace function public.accept_org_invitation(p_token text, p_user_id uuid)
returns table (organization_id uuid, organization_name text, org_role_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite   public.invitations%rowtype;
  v_org_name text;
  v_group_id uuid;
begin
  select i.* into v_invite
  from public.invitations i
  where i.token = p_token
  for update;

  if not found then
    return;
  end if;

  -- `IS TRUE` (not `<> false`) is null-safe: a legacy NULL row is still claimable
  -- and a claimed one is not.
  if v_invite.is_accepted is true then
    return;
  end if;

  if v_invite.expires_at < now() then
    return;
  end if;

  if v_invite.organization_id is null then
    return;
  end if;

  -- A target role from another organization would grant that tenant's scopes.
  if not exists (
    select 1
    from public.org_roles r
    where r.id = v_invite.target_org_role_id
      and r.organization_id = v_invite.organization_id
  ) then
    return;
  end if;

  -- A class invite's group must belong to the invitation's organization (the
  -- write trigger enforces the same on insert/update; re-checked here as the
  -- accept-side backstop).
  if v_invite.group_id is not null and not exists (
    select 1
    from public.groups g
    where g.id = v_invite.group_id
      and g.organization_id = v_invite.organization_id
  ) then
    return;
  end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_invite.organization_id;

  if v_org_name is null then
    return;
  end if;

  -- Class invite (D7): the invitee must already be an org member. Checked
  -- BEFORE the claim so a refused accept leaves the token usable, and so a
  -- class invite can never create an org membership or grant an org role.
  if v_invite.group_id is not null and not exists (
    select 1
    from public.org_members m
    where m.organization_id = v_invite.organization_id
      and m.user_id = p_user_id
  ) then
    return;
  end if;

  update public.invitations
  set is_accepted = true
  where id = v_invite.id;

  if v_invite.group_id is not null then
    -- Class invite: the org-membership write is a no-op for the existing
    -- member (DO NOTHING keeps their current org role), the target group is
    -- joined with the invited role (idempotent upsert), and the default group
    -- join matches the org path.
    insert into public.org_members (organization_id, user_id, org_role_id)
    values (v_invite.organization_id, p_user_id, v_invite.target_org_role_id)
    on conflict on constraint org_members_organization_id_user_id_key
    do nothing;

    insert into public.group_members (group_id, user_id, role)
    values (v_invite.group_id, p_user_id, v_invite.target_group_role)
    on conflict on constraint group_members_group_id_user_id_key
    do update set role = excluded.role;

    select g.id into v_group_id
    from public.groups g
    where g.organization_id = v_invite.organization_id
      and g.is_default;

    if v_group_id is not null then
      insert into public.group_members (group_id, user_id, role)
      values (v_group_id, p_user_id, 'member')
      on conflict on constraint group_members_group_id_user_id_key do nothing;
    end if;
  else
    -- Org invite: re-accepting an existing member updates their `org_role_id`
    -- instead of failing on `UNIQUE(organization_id, user_id)`; an existing
    -- `group_members` row is left alone (DO NOTHING), so a re-accept cannot
    -- downgrade a member's group role.
    insert into public.org_members (organization_id, user_id, org_role_id)
    values (v_invite.organization_id, p_user_id, v_invite.target_org_role_id)
    on conflict on constraint org_members_organization_id_user_id_key
    do update set org_role_id = excluded.org_role_id;

    select g.id into v_group_id
    from public.groups g
    where g.organization_id = v_invite.organization_id
      and g.is_default;

    if v_group_id is not null then
      insert into public.group_members (group_id, user_id, role)
      values (v_group_id, p_user_id, 'member')
      on conflict on constraint group_members_group_id_user_id_key do nothing;
    end if;
  end if;

  return query select v_invite.organization_id, v_org_name, v_invite.target_org_role_id;
end;
$$;

revoke all on function public.accept_org_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_org_invitation(text, uuid) to service_role;

-- ==========================================
-- Guard (2b-3/2b-4 shape, R26): every invitations policy must name its
-- expected key in EVERY clause it has (`qual`/`with_check`), each policy row
-- must exist (a `count(*) = 0 … not like` shape is vacuously true when the
-- policy is dropped), no invitations policy may still name the legacy
-- `rls_caller_is_org_manager`, `can_assign_org_role` must resolve its manager
-- half from `org.invitation.manage` and carry no teacher-name exception, the
-- accept RPC must carry the class branch, and the schema objects must exist.
-- A re-application is a no-op because every statement above replaces in place.
-- ==========================================
do $$
declare
  missing text;
  legacy  text;
begin
  -- `clause` says where the key must appear: `any` = in every clause the
  -- policy has (a `with check` reverted to the legacy predicate is as wrong as
  -- a `using` one), `check` = in `with_check` only and present there (the
  -- grant-authority conjunct refers to the NEW row, so it belongs to the
  -- INSERT/UPDATE `with_check` alone).
  select string_agg(expected.tablename || '.' || expected.policyname || ' (' || expected.key || ')', ', ')
  into missing
  from (
    values
      ('invitations', 'Org managers or inviter read invitations', 'org.invitation.manage', 'any'),
      ('invitations', 'Org managers or inviter read invitations', 'group.invite', 'any'),
      ('invitations', 'Org managers or inviter read invitations', 'inviter_id = auth.uid()', 'any'),
      ('invitations', 'Authorized inviter insert invitations', 'inviter_id = auth.uid()', 'any'),
      ('invitations', 'Authorized inviter insert invitations', 'org.invitation.manage', 'any'),
      ('invitations', 'Authorized inviter insert invitations', 'group.invite', 'any'),
      ('invitations', 'Authorized inviter insert invitations', 'rls_caller_can_assign_org_role', 'check'),
      ('invitations', 'Org managers or inviter update invitations', 'org.invitation.manage', 'any'),
      ('invitations', 'Org managers or inviter update invitations', 'group.invite', 'any'),
      ('invitations', 'Org managers or inviter update invitations', 'inviter_id = auth.uid()', 'any'),
      ('invitations', 'Org managers or inviter update invitations', 'rls_caller_can_assign_org_role', 'check'),
      ('invitations', 'Org managers or inviter delete invitations', 'org.invitation.manage', 'any'),
      ('invitations', 'Org managers or inviter delete invitations', 'group.invite', 'any'),
      ('invitations', 'Org managers or inviter delete invitations', 'inviter_id = auth.uid()', 'any')
  ) as expected(tablename, policyname, key, clause)
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = expected.tablename
      and p.policyname = expected.policyname
      and (
        case expected.clause
          when 'check' then
            p.with_check is not null and p.with_check like '%' || expected.key || '%'
          else
            (p.qual is null or p.qual like '%' || expected.key || '%')
            and (p.with_check is null or p.with_check like '%' || expected.key || '%')
        end
      )
  );

  if missing is not null then
    raise exception 'invitations policies without the expected key in every clause: %', missing;
  end if;

  -- Positive boundaries (R26): the four policy rows exist.
  if exists (
    select 1
    from (values
      ('Org managers or inviter read invitations'),
      ('Authorized inviter insert invitations'),
      ('Org managers or inviter update invitations'),
      ('Org managers or inviter delete invitations')
    ) as expected(policyname)
    where not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'invitations'
        and p.policyname = expected.policyname
    )
  ) then
    raise exception 'an invitations policy row is missing (dropped, not rewritten)';
  end if;

  -- No invitations policy may still name the legacy helper.
  select string_agg(p.policyname, ', ')
  into legacy
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'invitations'
    and (
      p.qual like '%rls_caller_is_org_manager%'
      or p.with_check like '%rls_caller_is_org_manager%'
    );

  if legacy is not null then
    raise exception 'invitations policies still naming rls_caller_is_org_manager: %', legacy;
  end if;

  -- can_assign_org_role: manager half on the permission, teacher-name
  -- exception gone, legacy marker no longer read.
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'can_assign_org_role'
      and pg_get_functiondef(p.oid) like '%org.invitation.manage%'
      and pg_get_functiondef(p.oid) not like '%is_org_manager%'
      and pg_get_functiondef(p.oid) not like '%name = ''member''%'
      and pg_get_functiondef(p.oid) not like '%name = ''teacher''%'
  ) then
    raise exception 'can_assign_org_role no longer resolves its manager half from org.invitation.manage, or still carries the teacher-name exception / legacy marker';
  end if;

  -- The accept RPC carries the class branch: the branch guard AND the
  -- target-group upsert that only it performs (`v_invite.target_group_role`
  -- is referenced nowhere else in the function).
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'accept_org_invitation'
      and pg_get_functiondef(p.oid) like '%v_invite.group_id is not null%'
      and pg_get_functiondef(p.oid) like '%v_invite.target_group_role%'
  ) then
    raise exception 'accept_org_invitation no longer carries the class-invite branch';
  end if;

  -- Schema objects: both columns, both CHECKs, the index, the group-org trigger clause.
  if exists (
    select 1
    from (values ('group_id'), ('target_group_role')) as expected(column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'invitations'
        and c.column_name = expected.column_name
    )
  ) then
    raise exception 'invitations is missing group_id or target_group_role';
  end if;

  if exists (
    select 1
    from (values ('invitations_target_group_role_check'), ('invitations_group_pair_check')) as expected(conname)
    where not exists (
      select 1 from pg_constraint
      where conrelid = 'public.invitations'::regclass
        and conname = expected.conname
    )
  ) then
    raise exception 'invitations is missing a class-invite CHECK constraint';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'invitations'
      and indexname = 'invitations_group_id_idx'
  ) then
    raise exception 'invitations_group_id_idx is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.invitations'::regclass
      and tgname = 'validate_invitation_target_org_role'
      and pg_get_triggerdef(oid) like '%group_id%'
  ) then
    raise exception 'the invitations write trigger no longer validates group_id';
  end if;
end;
$$;
