-- ==========================================================
-- #961: a content write cannot hold `group`.
--
-- The operator decision (2026-11-27): "Only the creator acts. Sharing means
-- others can view it, not that it is editable. An edit share would need a
-- separate permission, like Google's view link vs edit link."
--
-- So `group` on a content **write** is not a grant. The eleven keys below lose
-- it from `allowed_scopes`: the role editor renders no `Grupa` radio for them,
-- the save schema refuses the grant, `resolveStoredScope` resolves a surviving
-- row to `null`, and this migration removes the rows that already exist. A
-- stored row is deleted and not only ignored because `rls_caller_has_permission`
-- checks the key and not the scope, so a surviving row would still satisfy a
-- content-write RLS policy.
--
-- `permissions.allowed_scopes` is the single mirror of the TypeScript catalog:
-- `__tests__/integration/catalog-invariants.test.ts` fails when any row
-- disagrees with `PERMISSIONS`, including these eleven. The trigger below reads
-- that table, so no SQL copy of the ban can drift from it.
-- ==========================================================

-- ==========================================================
-- 1. The eleven keys, in one place for every statement in this file.
-- ==========================================================
drop table if exists no_group_content_write_keys;
create temp table no_group_content_write_keys (key text primary key);

insert into no_group_content_write_keys (key) values
  ('deck.update'),
  ('deck.delete'),
  ('flashcard.create'),
  ('flashcard.update'),
  ('flashcard.delete'),
  ('question.update'),
  ('question.delete'),
  ('question_bank.update'),
  ('question_bank.delete'),
  ('topic.update'),
  ('topic.delete');

-- ==========================================================
-- 2. Narrow the catalogue rows. Exactly eleven must match: a missing catalog
--    row means the chain never inserted the base content keys, and the guard
--    must stop the migration instead of leaving that key unbanned.
-- ==========================================================
do $$
declare
  v_changed int;
begin
  update public.permissions p
  set allowed_scopes = array['own', 'organization']::text[]
  from no_group_content_write_keys k
  where p.key = k.key;

  get diagnostics v_changed = row_count;
  if v_changed <> 11 then
    raise exception 'guard: narrowed % permission rows (expected 11)', v_changed
      using errcode = '23514';
  end if;
end $$;

-- ==========================================================
-- 3. Delete the stored grants. Count the rows that must survive first, so the
--    closing guard can prove the delete removed nothing else.
-- ==========================================================
drop table if exists no_group_content_write_grants;
create temp table no_group_content_write_grants as
select count(*)::bigint as total
from public.org_role_permissions orp
where not (
  orp.scope = 'group'
  and orp.permission_key in (select key from no_group_content_write_keys)
);

delete from public.org_role_permissions orp
using no_group_content_write_keys k
where orp.permission_key = k.key
  and orp.scope = 'group';

-- ==========================================================
-- 4. Guard the table. Any writer — the role editor, a template copy, a future
--    migration, a hand-written statement — must stay inside the catalogue's
--    `allowed_scopes`. This is a data invariant, not a caller-authority rule, so
--    there is no `auth.role()` bypass.
-- ==========================================================
create or replace function public.guard_org_role_permission_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.permissions p
    where p.key = new.permission_key
      and new.scope = any (p.allowed_scopes)
  ) then
    raise exception 'scope % is not allowed for %', new.scope, new.permission_key
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_org_role_permission_scope() from public, anon;

drop trigger if exists guard_org_role_permission_scope on public.org_role_permissions;
create trigger guard_org_role_permission_scope
  before insert or update of permission_key, scope on public.org_role_permissions
  for each row execute function public.guard_org_role_permission_scope();

-- ==========================================================
-- 5. Closing guard: the end state, read back from the tables rather than from
--    the statements above. Idempotent, so a replay passes.
-- ==========================================================
do $$
declare
  v_bad int;
  v_before bigint;
  v_after bigint;
begin
  -- The function and the trigger exist.
  if to_regprocedure('public.guard_org_role_permission_scope()') is null then
    raise exception 'guard: public.guard_org_role_permission_scope() is missing'
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from pg_trigger
  where tgrelid = 'public.org_role_permissions'::regclass
    and tgname = 'guard_org_role_permission_scope'
    and not tgisinternal;
  if v_bad <> 1 then
    raise exception 'guard: % guard_org_role_permission_scope trigger(s) (expected 1)', v_bad
      using errcode = '23514';
  end if;

  -- The eleven rows carry exactly {own,organization}.
  select count(*) into v_bad
  from public.permissions p
  join no_group_content_write_keys k on k.key = p.key
  where p.allowed_scopes <> array['own', 'organization']::text[];
  if v_bad <> 0 then
    raise exception 'guard: % content write(s) still allow group', v_bad
      using errcode = '23514';
  end if;

  -- The keys that keep `group` still allow it: an over-broad update fails here.
  select count(*) into v_bad
  from public.permissions p
  where p.key in ('assignment.update', 'deck.read', 'stats.read', 'group.manage')
    and not (p.allowed_scopes @> array['group']::text[]);
  if v_bad <> 0 then
    raise exception 'guard: % key(s) lost their group scope', v_bad
      using errcode = '23514';
  end if;

  -- No row grants a banned key at group.
  select count(*) into v_bad
  from public.org_role_permissions orp
  join no_group_content_write_keys k on k.key = orp.permission_key
  where orp.scope = 'group';
  if v_bad <> 0 then
    raise exception 'guard: % stored group content write(s) remain', v_bad
      using errcode = '23514';
  end if;

  -- The delete removed only the banned rows.
  select total into v_before from no_group_content_write_grants;
  select count(*) into v_after
  from public.org_role_permissions orp
  where not (
    orp.scope = 'group'
    and orp.permission_key in (select key from no_group_content_write_keys)
  );
  if v_after <> v_before then
    raise exception 'guard: the delete removed % non-offending grant(s)', v_before - v_after
      using errcode = '23514';
  end if;
end $$;

drop table if exists no_group_content_write_keys;
drop table if exists no_group_content_write_grants;
