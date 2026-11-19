-- Phase 2b, slice 1 of the role-authority programme (ADR-0015 §4.1, §4.4, §8.1;
-- R2, R10, R19).
--
-- `org_role_permissions.permission_name` becomes `permission_key` and references
-- `permissions(key)`. Phase 1b's `migrate_org_role_permission_names()` already
-- normalised the rows it could see, but it ran in the migration — and a `db
-- reset` executes migrations before any organization exists, so only production
-- (`db push`) has rows for it to act on, and a free-string name from the old role
-- editor can survive there. It is called again below, before the rename and the
-- constraint, and then re-created against the renamed column: the callable form
-- is the contract, and a later replay of it must keep working — including the
-- catalog sweep, the one step that still has work to do once the foreign key
-- exists.
--
-- The rename happens after the rewrite because every historical migration that
-- writes this table (`20261119180000`, `20261119190000`, …) names the old
-- column, so the rewrite has to be written and run in the old names.
--
-- A foreign key to the catalog's `allowed_scopes` is not available here: the
-- column is an array and the child value is one of its elements.

-- ==========================================
-- 1. The rewrite, run before anything moves.
--
--    `0012_function_execute_parity` requires every function a migration creates
--    to revoke `PUBLIC`/`anon` itself, and `grant-parity` enumerates `pg_proc`.
--    Every statement is idempotent, so a production `db push` and a reset end in
--    the same state.
-- ==========================================
create or replace function public.migrate_org_role_permission_names()
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  -- 1. Dedupe: drop the old name where the role also holds the new one. The
  --    unique key is (org_role_id, permission_name), so the old row has to go
  --    before the update below.
  delete from public.org_role_permissions o
  using public.org_role_permissions n
  where o.org_role_id = n.org_role_id
    and (
      (o.permission_name = 'member.manage' and n.permission_name = 'org.member.manage')
      or (o.permission_name = 'role.builder' and n.permission_name = 'org.role.manage')
    );

  -- 2. Map the two management names the permission catalog now spells `org.*`.
  update public.org_role_permissions
  set permission_name = 'org.member.manage'
  where permission_name = 'member.manage';

  update public.org_role_permissions
  set permission_name = 'org.role.manage'
  where permission_name = 'role.builder';

  -- 3. Drop the entitlement names that were never permissions.
  delete from public.org_role_permissions
  where permission_name = 'org.manage'
     or permission_name = 'ai.chat'
     or permission_name = 'documents'
     or permission_name like 'study.%'
     or permission_name like 'test.%';
END;
$$;

revoke all on function public.migrate_org_role_permission_names() from public, anon;
grant execute on function public.migrate_org_role_permission_names() to service_role;

-- `create or replace` keeps the ACLs, but this restates the phase-2a-2 grant
-- because a missing one is invisible until a role write 403s: `grant_parity`
-- fails when a helper a policy calls is not executable by the policy's caller.
grant execute on function public.rls_caller_has_permission(uuid, text) to authenticated;

select public.migrate_org_role_permission_names();

-- ==========================================
-- 2. Rename. The unique key is the conflict target `setPermissions` passes to its
--    upsert (`onConflict: 'org_role_id,permission_key'`), so the constraint follows
--    the column.
-- ==========================================
alter table public.org_role_permissions rename column permission_name to permission_key;
alter table public.org_role_permissions
  rename constraint org_role_permissions_org_role_id_permission_name_key
  to org_role_permissions_org_role_id_permission_key_key;

-- ==========================================
-- 3. The scopes the old rows carry. `withAuth` accepts only the three scopes the
--    catalog declares (`isPermissionScope`), so the app has never honoured
--    `any`/`granted`; 2a-2's last-holder count is the only reader that still
--    recognises such a row, and it counts it as a holder of the gate on the
--    strength of a value that resolves nothing. Mapping them would mean deciding
--    what they meant — a role's capability is not a scope — so the rows go and the
--    CHECK says what the editor can send.
-- ==========================================
delete from public.org_role_permissions where scope in ('any', 'granted');

alter table public.org_role_permissions
  drop constraint org_role_permissions_scope_check,
  add constraint org_role_permissions_scope_check
    check (scope in ('own', 'group', 'organization'));

-- The foreign key below rejects a name the catalog does not know from this point
-- on, so a test cannot insert one and watch the rewrite delete it. The reachable
-- half is what `catalog-rename-rewrite` proves: the shipped function runs on the
-- rows an org trigger wrote without a `21000`, a second run leaves them unchanged,
-- and a role row whose catalog row has been removed is swept — see
-- `__tests__/integration/catalog-rename-rewrite.test.ts`.

-- ==========================================
-- 4. The callable contract, against the column the rest of the code reads.
--
--    Only the catalog sweep is load-bearing on this schema: the foreign key
--    rejects every pre-rename and entitlement name at insert, so the dedupe and
--    mapping steps can only match a row in a database that lost the constraint.
--    They stay because this body is also what a restore replays, and it has to
--    keep that job for a database the constraint has not reached yet.
-- ==========================================
create or replace function public.migrate_org_role_permission_names()
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  delete from public.org_role_permissions o
  using public.org_role_permissions n
  where o.org_role_id = n.org_role_id
    and (
      (o.permission_key = 'member.manage' and n.permission_key = 'org.member.manage')
      or (o.permission_key = 'role.builder' and n.permission_key = 'org.role.manage')
    );

  update public.org_role_permissions
  set permission_key = 'org.member.manage'
  where permission_key = 'member.manage';

  update public.org_role_permissions
  set permission_key = 'org.role.manage'
  where permission_key = 'role.builder';

  -- Deleting a name that is not in the catalog covers the entitlement names of
  -- phase 1b (`org.manage`, `ai.chat`, `documents`, `study.*`, `test.*`) and every
  -- free string the old editor wrote, without a list that can fall behind. It is
  -- an `exists` rather than a `not in` list: the predicate then depends on each
  -- key alone, so a null or a missing catalog row makes that key invalid instead
  -- of the whole comparison unknown.
  delete from public.org_role_permissions orp
  where orp.permission_key is null
     or not exists (
       select 1 from public.permissions p where p.key = orp.permission_key
     );
END;
$$;

revoke all on function public.migrate_org_role_permission_names() from public, anon;
grant execute on function public.migrate_org_role_permission_names() to service_role;

-- ==========================================
-- 5. The constraint.
--
--    No `on delete` and no `on update`: RESTRICT and NO ACTION behave identically
--    here (both refuse while a role holds the key), and the default records the
--    rule without implying the two differ. A permission key moves with a catalog
--    migration — the shape of `plan_entitlements.entitlement_key_fkey` — and a
--    role row cannot outlive its key, so there is no cascade to write.
-- ==========================================
alter table public.org_role_permissions
  add constraint org_role_permissions_permission_key_fkey
  foreign key (permission_key) references public.permissions(key);

-- ==========================================
-- 6. Functions that read or write the renamed column. Each body is the newest
--    definition with only the column name changed, so the write paths keep
--    working: `create or replace` keeps every ACL.
-- ==========================================
create or replace function public.seed_system_role_permissions(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  -- admin: every content, group and org key at organization scope.
  INSERT INTO public.org_role_permissions (org_role_id, permission_key, scope)
  SELECT r.id, p.key, 'organization'
  FROM public.org_roles r
  JOIN public.permissions p ON p.category IN ('content', 'group', 'org')
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND r.name = 'admin'
  ON CONFLICT DO NOTHING;

  -- teacher: every content key (assignment.* included) at own scope, except
  -- `stats.read` (ADR §4.2: group scope); the four group keys at group scope.
  INSERT INTO public.org_role_permissions (org_role_id, permission_key, scope)
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
  -- §4.2 matrix grants at own scope.
  INSERT INTO public.org_role_permissions (org_role_id, permission_key, scope)
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
  INSERT INTO public.org_role_permissions (org_role_id, permission_key, scope)
  SELECT r.id, 'group.read', 'group'
  FROM public.org_roles r
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND r.name = 'member'
  ON CONFLICT DO NOTHING;
END;
$$;

-- The caller-capability helper the role write policies call (2a-2).
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
      and p.permission_key = p_permission
  );
$$;

revoke all on function public.rls_caller_has_permission(uuid, text) from public, anon;
grant execute on function public.rls_caller_has_permission(uuid, text)
  to authenticated, service_role;

-- ==========================================
-- 7. Stale names from the phase-1b table rename. `plan_entitlements` keeps its
--    constraints under the old `plan_features_*` names (Postgres keeps them
--    across `alter table ... rename`); the type generator emits two of them as
--    `foreignKeyName`, so they are visible to TypeScript even though nothing
--    reads them by name. Nothing depends on the old names; the restatement is
--    so the table's constraints read as one set.
-- ==========================================
alter table public.plan_entitlements rename constraint plan_features_pkey to plan_entitlements_pkey;
alter table public.plan_entitlements
  rename constraint plan_features_plan_key_feature_key_key
  to plan_entitlements_plan_key_entitlement_key_key;
alter table public.plan_entitlements
  rename constraint plan_features_feature_key_fkey
  to plan_entitlements_entitlement_key_flag_fkey;
alter table public.plan_entitlements
  rename constraint plan_features_plan_key_fkey
  to plan_entitlements_plan_key_fkey;

-- ==========================================
-- 8. Assertions. Supabase records a migration as applied from the file name, so a
--    renumbered or hand-applied migration can leave a database whose ledger says
--    this one ran while the objects it owns are missing — and every later
--    `create or replace function` then compiles against a column that does not
--    exist and fails on the first write. These two make that state impossible to
--    reach quietly.
-- ==========================================
do $$
BEGIN
  if not exists (
    select 1 from pg_constraint
    where conname = 'org_role_permissions_permission_key_fkey'
      and conrelid = 'public.org_role_permissions'::regclass
  ) then
    raise exception 'org_role_permissions_permission_key_fkey is missing: this migration did not apply';
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'org_role_permissions_scope_check'
      and conrelid = 'public.org_role_permissions'::regclass
      and pg_get_constraintdef(oid) like '%''any''%'
  ) then
    raise exception 'org_role_permissions_scope_check still accepts any/granted';
  end if;
END;
$$;
