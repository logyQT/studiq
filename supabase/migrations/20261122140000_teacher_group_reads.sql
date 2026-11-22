-- Phase 3d of the role-authority programme (ADR-0015 §4.2, D29).
--
-- Teacher content reads move to `group`; writes stay `own`, and
-- `assignment.read` / `stats.read` move with the other content reads. `group`
-- is a superset of `own` in the API layer, so a read that worked at `own` keeps
-- working and a deck/topic/bank shared to a class becomes readable too.
--
-- Two writers carry the matrix and they need different fixes:
--   * `seed_system_role_permissions` only inserts missing rows (its
--     `on conflict do nothing` is load-bearing — a re-seed must not overwrite an
--     admin's role-editor edit), so the template change reaches organizations
--     created after this migration through the re-created function;
--   * every existing system Teacher role keeps its old `own` rows, because the
--     function will never update them. The backfill below is the data migration;
--     without it the template and the callable seed would agree with each other
--     and disagree with the database.
--
-- The closing guard pins the resulting **rows**. The function body and the
-- template are pinned together by the integration matrix tests
-- (`entitlement-profile`, `assignment-permissions-seed`), so a change to either
-- that forgets this file's rows still fails loudly.
--
-- The backfill normalises *any* non-`group` system Teacher content read, a
-- role-editor widening to `organization` included: the guard demands the exact
-- matrix, so the canonical row is the only accepted state.

-- ==========================================
-- The callable seed: teacher reads at `group`, writes at `own`.
--
-- This is the newest definition (`20261119211000` re-created the body for the
-- renamed `permission_key` column) with only the teacher `CASE` changed. The
-- admin and member arms are untouched.
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

  -- teacher: every content key reads at group and writes at own (D29;
  -- assignment.* included); the four group keys at group scope.
  INSERT INTO public.org_role_permissions (org_role_id, permission_key, scope)
  SELECT r.id, p.key,
    CASE
      WHEN p.key LIKE '%.read' THEN 'group'
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

-- ==========================================
-- Backfill: existing system Teacher rows.
--
-- Only a content `.read` row moves; a write key stays `own`, and custom roles,
-- the Admin role and the Member role are not touched. Idempotent: the
-- `scope <> 'group'` predicate makes a replay a no-op.
-- ==========================================
update public.org_role_permissions as orp
set scope = 'group'
from public.org_roles as r
join public.permissions as p
  on p.category = 'content'
 and p.key like '%.read'
where orp.org_role_id = r.id
  and orp.permission_key = p.key
  and r.is_system
  and r.name = 'teacher'
  and orp.scope <> 'group';

-- Existing organizations created before the teacher `CASE` moved: the seed is
-- insert-only, so it fills rows a pre-3d seed did not create and never
-- overwrites an existing row — a role-editor edit survives. Kept in the same
-- file as the backfill so a fresh and an upgrade path converge on the same rows.
select public.seed_system_role_permissions(id) from public.organizations;

-- ==========================================
-- Closing guard (R26): every system Teacher carries exactly one row per content
-- key, reads at group and writes at own — the template in
-- `SYSTEM_ROLE_TEMPLATES.teacher` and the function's teacher arm, as written by
-- the backfill and the seed above. Idempotent, so a replay passes.
-- ==========================================
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.org_roles r
  cross join public.permissions p
  left join public.org_role_permissions orp
    on orp.org_role_id = r.id
   and orp.permission_key = p.key
  where r.is_system
    and r.name = 'teacher'
    and p.category = 'content'
    and orp.scope is distinct from
      case when p.key like '%.read' then 'group' else 'own' end;

  if v_bad <> 0 then
    raise exception
      'system teacher role(s) carry % content row(s) that disagree with D29 (reads group, writes own)',
      v_bad;
  end if;
end;
$$;
