-- Phase 7 of the role-authority programme (ADR-0015 D19/D27, R26).
--
-- `org_role_features` is the last legacy feature store. Since 2b-7 no row can
-- grant a key (the four management markers left the catalog), and since 3c the
-- table is revokes-only; the role layer is `org_roles.entitlement_profile`.
-- The table, its two table-local policies and the four helpers that read it are
-- dead: `has_org_feature(uuid,uuid,text)` and `is_org_manager(uuid,uuid)` have
-- no policy or function reader, and the two `rls_caller_*` wrappers have no
-- policy reader. `can_assign_org_role` stopped delegating to `is_org_manager`
-- in 2b-5, so dropping these leaves every live predicate untouched.
--
-- Premarket (0 users): delete, never shim; no compatibility view remains.

drop table if exists public.org_role_features cascade;

drop function if exists public.has_org_feature(uuid, uuid, text);
drop function if exists public.is_org_manager(uuid, uuid);
drop function if exists public.rls_caller_has_org_feature(uuid, text);
drop function if exists public.rls_caller_is_org_manager(uuid);

-- Closing guard (R26): the dropped objects must be gone and the state this
-- deletion leaves — the profile column and the phase-2/5e policies — must
-- still answer, so the guard cannot pass on an emptied schema.
do $$
declare
  v_missing text;
begin
  -- Dropped side: exactly the legacy table and the four helpers.
  if to_regclass('public.org_role_features') is not null then
    raise exception 'org_role_features still exists';
  end if;
  if to_regprocedure('public.has_org_feature(uuid,uuid,text)') is not null then
    raise exception 'has_org_feature(uuid,uuid,text) still exists';
  end if;
  if to_regprocedure('public.is_org_manager(uuid,uuid)') is not null then
    raise exception 'is_org_manager(uuid,uuid) still exists';
  end if;
  if to_regprocedure('public.rls_caller_has_org_feature(uuid,text)') is not null then
    raise exception 'rls_caller_has_org_feature(uuid,text) still exists';
  end if;
  if to_regprocedure('public.rls_caller_is_org_manager(uuid)') is not null then
    raise exception 'rls_caller_is_org_manager(uuid) still exists';
  end if;

  -- Surviving side: the role layer the deletion leaves behind is the profile
  -- column, and the phase-2/5e predicates still answer. Without this half the
  -- guard would pass on a database where the whole role-authority surface was
  -- dropped.
  if to_regclass('public.org_roles') is null then
    raise exception 'org_roles is missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_roles'
      and column_name = 'entitlement_profile'
      and is_nullable = 'NO'
  ) then
    raise exception 'org_roles.entitlement_profile is missing';
  end if;

  if to_regclass('public.teacher_assignments') is null then
    raise exception 'teacher_assignments is missing';
  end if;

  for v_missing in
    select expected.policy_name
    from (
      values
        ('org_roles', 'Org managers update roles'),
        ('org_roles', 'Org managers insert roles'),
        ('teacher_assignments', 'Visible teacher assignments')
    ) as expected(table_name, policy_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.policyname = expected.policy_name
    )
  loop
    raise exception 'policy % is missing', v_missing;
  end loop;

  -- The role write path is permission-owned after the deletion: no policy may
  -- still name one of the dropped helpers (it would be a dangling reference or
  -- a later migration resurrecting the legacy gate).
  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and (
        coalesce(p.qual, '') like '%has_org_feature%'
        or coalesce(p.with_check, '') like '%has_org_feature%'
        or coalesce(p.qual, '') like '%is_org_manager%'
        or coalesce(p.with_check, '') like '%is_org_manager%'
      )
  ) then
    raise exception 'a policy still reads a dropped org-feature helper';
  end if;
end;
$$;
