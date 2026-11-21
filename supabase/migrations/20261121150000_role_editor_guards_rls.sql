-- Phase 2b-8 of the role-authority programme (ADR-0015 §4.4, §9; D16, D21;
-- R4, R18, R19, R26, R27, R29).
--
-- 2a-2/2a-3 gave the role-editor API three guards — system roles cannot be
-- deleted, the last `org.role.manage` holder cannot be removed, and no grant
-- or removal beyond the caller's own authority — but RLS had none of them, so
-- every one was bypassable through PostgREST (R4, the FP-01 shape). This
-- migration mirrors them in the data plane without changing API behaviour:
--
--   1. `org_roles` DELETE refuses `is_system = true` (a policy conjunct), and
--      INSERT/UPDATE refuse to create or flip into a system role through
--      PostgREST. The API hardcodes `is_system = false`; the system rows come
--      from `handle_new_organization`, which runs as the table owner. The
--      rename half of "system roles cannot be renamed" is already enforced at
--      the data plane by the `guard_system_org_role_identity` trigger
--      (20261024124756) — this slice pins it with a test instead of adding a
--      second trigger.
--   2. The last `org.role.manage` holder of an org cannot be removed. A
--      `USING` subquery alone is not atomic (R29): READ COMMITTED gives every
--      statement a fresh snapshot, so two concurrent removals of the last two
--      holders can both count the other and both proceed. The guard therefore
--      runs in BEFORE DELETE/UPDATE triggers that lock the organization row
--      `FOR UPDATE` first — the lock serializes every gate-guarding write per
--      org, so the count sees the winner's committed state.
--   3. `org_role_permissions` INSERT/UPDATE/DELETE go through one SECURITY
--      DEFINER helper that restates §4.4: the caller needs `org.role.manage`
--      in the role's org, the key must be assignable (D16: `org.admin` is never
--      granted or withdrawn — the check precedes the ownership exemption, so
--      even an `org.admin` holder cannot move it), the target role must not be
--      the caller's own role unless the caller holds `org.admin` at
--      organization scope (D21), and the caller's own scope must cover the
--      scope being granted (the new row) or removed (the stored row).
--
-- R27: this file re-states all six write policies in full (`alter policy`
-- replaces the predicate in place), so it is the newest file that owns them
-- and the RLS suites replay this file, not 20261119190000.

-- ==========================================
-- §4.4 helper: does the caller's own authority cover `p_permission` at
-- `p_scope` in `p_organization_id`?
--
-- SECURITY DEFINER is load-bearing (R18): the body reads
-- `org_role_permissions`, and a plain SQL function called from a policy on
-- that table recurses (42P17). The EXECUTE grant lives in this file (R19).
-- The scope ranks mirror `scopeCovers` in @studiq/authz (own < group <
-- organization); an unknown value ranks as covering nothing / needing more
-- than anything, so the comparison fails closed both ways.
-- ==========================================
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
  select exists (
    select 1
    from public.org_members om
    join public.org_role_permissions p on p.org_role_id = om.org_role_id
    where om.user_id = auth.uid()
      and om.organization_id = p_organization_id
      and (
        -- D21: an org.admin holder at organization scope may grant or remove
        -- anything — a single-admin org must still be able to edit its own
        -- Admin role.
        (p.permission_key = 'org.admin' and p.scope = 'organization')
        or (
          p.permission_key = p_permission
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

revoke all on function public.rls_caller_covers_permission(uuid, text, text) from public, anon;
grant execute on function public.rls_caller_covers_permission(uuid, text, text)
  to authenticated, service_role;

-- ==========================================
-- §4.4 helper: may the caller grant or remove `p_permission_key` at `p_scope`
-- on the role `p_org_role_id`? This is the whole data-plane half of the
-- role-editor guard: tenant floor, the `org.role.manage` gate, D16, no
-- self-edit (D21 exemption) and the scope-coverage rule. In an UPDATE policy
-- the USING clause sees the stored (old) row and the WITH CHECK clause the new
-- one, so one predicate covers removal (old scope) and addition (new scope).
-- ==========================================
create or replace function public.rls_caller_may_set_role_permission(
  p_org_role_id uuid,
  p_permission_key text,
  p_scope text
)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_organization_id uuid;
  v_caller_role_id uuid;
begin
  -- Tenant floor: the role exists in an org the caller belongs to.
  select r.organization_id into v_organization_id
  from public.org_roles r
  where r.id = p_org_role_id
    and r.organization_id in (select c.organization_id from public.rls_caller_org_ids() c);
  if v_organization_id is null then
    return false;
  end if;

  -- The gate itself: defining or editing a role requires org.role.manage.
  if not public.rls_caller_has_permission(v_organization_id, 'org.role.manage') then
    return false;
  end if;

  -- D16: ownership is not a grant the editor may hand out or withdraw. This
  -- precedes the ownership exemption on purpose: even an org.admin holder
  -- cannot move the org.admin key through PostgREST.
  if not exists (
    select 1 from public.permissions p
    where p.key = p_permission_key and p.assignable
  ) then
    return false;
  end if;

  -- No self-edit (ADR-0015 §9) unless the caller holds org.admin at
  -- organization scope (D21).
  select om.org_role_id into v_caller_role_id
  from public.org_members om
  where om.user_id = auth.uid()
    and om.organization_id = v_organization_id;
  if v_caller_role_id = p_org_role_id
     and not public.rls_caller_covers_permission(v_organization_id, 'org.admin', 'organization')
  then
    return false;
  end if;

  -- §4.4: the caller's own scope must cover the scope being granted (new row)
  -- or removed (stored row).
  return public.rls_caller_covers_permission(v_organization_id, p_permission_key, p_scope);
end;
$$;

revoke all on function public.rls_caller_may_set_role_permission(uuid, text, text) from public, anon;
grant execute on function public.rls_caller_may_set_role_permission(uuid, text, text)
  to authenticated, service_role;

-- ==========================================
-- org_roles writes: all three policies re-stated in full (R27).
-- ==========================================
alter policy "Org managers insert roles" on public.org_roles
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
    -- 2b-8: no system role can be created through PostgREST.
    and not coalesce(is_system, false)
  );

alter policy "Org managers update roles" on public.org_roles
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
    -- 2b-8: a custom role cannot be flipped into a system one. Renaming or
    -- moving a system role is the guard_system_org_role_identity trigger.
    and not coalesce(is_system, false)
  );

alter policy "Org managers delete roles" on public.org_roles
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_permission(organization_id, 'org.role.manage')
    -- 2b-8 item 1: system roles cannot be deleted (the service answers
    -- FORBIDDEN on the same row).
    and not coalesce(is_system, false)
  );

-- ==========================================
-- org_role_permissions writes: all three policies re-stated in full (R27).
-- The single helper carries the tenant floor, the org.role.manage gate, D16,
-- no self-edit and the scope-coverage rule.
-- ==========================================
alter policy "Org managers insert role permissions" on public.org_role_permissions
  with check (
    public.rls_caller_may_set_role_permission(org_role_id, permission_key, scope)
  );

alter policy "Org managers update role permissions" on public.org_role_permissions
  using (
    public.rls_caller_may_set_role_permission(org_role_id, permission_key, scope)
  )
  with check (
    public.rls_caller_may_set_role_permission(org_role_id, permission_key, scope)
  );

alter policy "Org managers delete role permissions" on public.org_role_permissions
  using (
    public.rls_caller_may_set_role_permission(org_role_id, permission_key, scope)
  );

-- ==========================================
-- The last org.role.manage holder (R29).
--
-- Deleting a role cascades its permission rows, deleting a permission row
-- removes the grant, and an update can move the key away — all three can take
-- the last holder. The count alone is not atomic, so each guard first locks
-- the organization row FOR UPDATE: every gate-guarding write in an org takes
-- that lock before touching a role or permission row, which serializes the
-- count against concurrent removals.
--
-- Like `guard_system_org_role_identity`, the guard applies to the
-- `authenticated` (PostgREST) surface only: service-role and owner writes are
-- trusted, and without that branch deleting an organization — whose cascade
-- removes its roles and their permission rows — would raise on its own last
-- holder, and so would every test cleanup.
-- ==========================================
create or replace function public.guard_org_roles_last_role_manage_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holders int;
  v_lock int;
begin
  if auth.role() <> 'authenticated' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- FK cascades run deeper than depth 1: an organization delete cascades its
  -- roles and their permission rows, and a role delete cascades its own
  -- permission rows (already guarded by the parent trigger at depth 1).
  -- Teardown must not raise on its own last holder.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'UPDATE' and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  if not exists (
    select 1 from public.org_role_permissions p
    where p.org_role_id = old.id
      and p.permission_key = 'org.role.manage'
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- R29: serialize per org before counting.
  select 1 into v_lock
  from public.organizations o
  where o.id = old.organization_id
  for update;

  select count(*) into v_holders
  from public.org_role_permissions p
  join public.org_roles r on r.id = p.org_role_id
  where r.organization_id = old.organization_id
    and p.permission_key = 'org.role.manage'
    and p.org_role_id <> old.id;

  if v_holders = 0 then
    raise exception 'the last org.role.manage holder of the organization cannot be removed'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.guard_org_role_permissions_last_role_manage_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_holders int;
  v_lock int;
begin
  if auth.role() <> 'authenticated' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- FK cascades run deeper than depth 1 (an organization delete cascades its
  -- roles and their permission rows); the parent trigger already guarded the
  -- direct write at depth 1, and teardown must not raise on its own last
  -- holder.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Only a removal counts: a delete, or an update that moves the gate key to
  -- another key or another role.
  if tg_op = 'DELETE' then
    if old.permission_key <> 'org.role.manage' then return old; end if;
  else
    if old.permission_key <> 'org.role.manage' then return new; end if;
    if new.permission_key is not distinct from old.permission_key
       and new.org_role_id is not distinct from old.org_role_id
    then
      return new;
    end if;
  end if;

  select r.organization_id into v_org_id
  from public.org_roles r
  where r.id = old.org_role_id;

  -- R29: serialize per org before counting.
  select 1 into v_lock
  from public.organizations o
  where o.id = v_org_id
  for update;

  select count(*) into v_holders
  from public.org_role_permissions p
  join public.org_roles r on r.id = p.org_role_id
  where r.organization_id = v_org_id
    and p.permission_key = 'org.role.manage'
    and p.org_role_id <> old.org_role_id;

  if v_holders = 0 then
    raise exception 'the last org.role.manage holder of the organization cannot be removed'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.guard_org_roles_last_role_manage_holder() from public, anon;
revoke all on function public.guard_org_role_permissions_last_role_manage_holder() from public, anon;

drop trigger if exists guard_org_roles_last_role_manage_holder on public.org_roles;
create trigger guard_org_roles_last_role_manage_holder
  before delete or update on public.org_roles
  for each row execute function public.guard_org_roles_last_role_manage_holder();

drop trigger if exists guard_org_role_permissions_last_role_manage_holder on public.org_role_permissions;
create trigger guard_org_role_permissions_last_role_manage_holder
  before delete or update on public.org_role_permissions
  for each row execute function public.guard_org_role_permissions_last_role_manage_holder();

-- ==========================================
-- Closing guard (R26): every object this file creates exists AND carries the
-- predicate it is supposed to carry — a dropped policy, a dropped trigger or
-- a weakened conjunct must fail the migration, not pass vacuously.
-- ==========================================
do $$
declare
  v_bad int;
begin
  -- 1. The six write policies exist (R26: absence is not a pass).
  select count(*) into v_bad
  from pg_policies p
  where p.schemaname = 'public'
    and (
      (p.tablename = 'org_roles' and p.policyname in (
        'Org managers insert roles', 'Org managers update roles', 'Org managers delete roles'
      ))
      or (p.tablename = 'org_role_permissions' and p.policyname in (
        'Org managers insert role permissions', 'Org managers update role permissions',
        'Org managers delete role permissions'
      ))
    );
  if v_bad <> 6 then
    raise exception 'expected the six role write policies on org_roles/org_role_permissions, found %', v_bad;
  end if;

  -- 2. The org_roles writes still carry the tenant floor and the
  --    org.role.manage gate, and the insert/update/delete conjunct that keeps
  --    system roles out of PostgREST writes (whitespace-stripped, the way
  --    pg_policies decompiles the qual / with_check).
  select count(*) into v_bad
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'org_roles'
    and p.policyname in ('Org managers insert roles', 'Org managers update roles', 'Org managers delete roles')
    and (regexp_replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), '\s+', '', 'g')) like '%rls_caller_org_ids(%'
    and (regexp_replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), '\s+', '', 'g')) like '%rls_caller_has_permission(%'
    and (regexp_replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), '\s+', '', 'g')) like '%NOTCOALESCE(is_system,false)%';
  if v_bad <> 3 then
    raise exception 'org_roles write policies lost the tenant floor, the gate or the is_system conjunct: % of 3 carry them', v_bad;
  end if;

  -- 3. The org_role_permissions writes carry the §4.4 helper.
  select count(*) into v_bad
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'org_role_permissions'
    and p.policyname in (
      'Org managers insert role permissions', 'Org managers update role permissions',
      'Org managers delete role permissions'
    )
    and (regexp_replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), '\s+', '', 'g')) like '%rls_caller_may_set_role_permission(%';
  if v_bad <> 3 then
    raise exception 'org_role_permissions write policies lost the §4.4 helper: % of 3 carry it', v_bad;
  end if;

  -- 4. The two §4.4 helpers exist, bypass RLS themselves (R18: security
  --    definer with search_path pinned) and are executable by the role the
  --    policies run as (R19).
  select count(*) into v_bad
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('rls_caller_may_set_role_permission', 'rls_caller_covers_permission')
    and p.prosecdef
    and p.proconfig @> array['search_path=""']::text[]
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_bad <> 2 then
    raise exception 'expected both §4.4 helpers (security definer, search_path pinned, executable by authenticated), found %', v_bad;
  end if;

  -- 5. The last-holder triggers exist on both tables and their functions
  --    carry the org-row lock (R29) and the gate count.
  select count(*) into v_bad
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid in ('public.org_roles'::regclass, 'public.org_role_permissions'::regclass)
    and not t.tgisinternal
    and t.tgname in ('guard_org_roles_last_role_manage_holder',
                     'guard_org_role_permissions_last_role_manage_holder')
    and p.prosecdef
    and lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) like '%forupdate%'
    and lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) like '%org.role.manage%'
    and lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) like '%auth.role()%'
    and lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) like '%pg_trigger_depth()%';
  if v_bad <> 2 then
    raise exception 'expected both last-holder guard triggers (org row FOR UPDATE + gate count), found %', v_bad;
  end if;
end;
$$;
