-- Phase 2b slice 2 of the role-authority programme (ADR-0015 §4.3, §6.3, §7,
-- §10; R4).
--
-- Runs after slice 1's `20261119211000_org_role_permission_key_fk.sql` on
-- purpose: that migration renames `org_role_permissions.permission_name` to
-- `permission_key`, and this file reads the column. A migration is applied by
-- file name, so landing this one earlier would have to name the old column and
-- would then break the moment the table is re-created by a replay.
--
-- The group routes now gate on permissions instead of the `group.manage`
-- entitlement and the `EDUCATOR|MANAGER` persona: `GET /organization/groups`
-- needs `group.read`, `POST` needs `group.manage`, and `PUT`/`DELETE` on a group
-- plus its roster (`members`, `addable-members`) need `group.manage` /
-- `group.member.manage` **for that group**. RLS must enforce the same rule in
-- the same PR: the six write policies below asked
-- `rls_caller_has_org_feature(org, 'group.manage')`, which is org-wide and
-- entitlement-sourced — so a teacher of one class could write every class in the
-- org through PostgREST, and a role holding the `group.manage` permission could
-- write none.
--
-- ==========================================
-- Caller capability helper, for ONE group.
--
-- True when the caller is an `org_members` row of the group's organization AND
--   - is a `teacher` of that group (`group_members.role = 'teacher'`),
--   - created that group (`groups.created_by = auth.uid`) for a key whose catalog
--     row lists `own`, or
--   - their role holds `p_permission` at `organization` scope.
--
-- ADR-0015 §4.3: a `teacher` membership means "may exercise `group.manage`,
-- `group.member.manage`, `group.invite` for THAT group"; §6.3: an
-- `organization`-scope row reaches the active org. A `member` membership is
-- read-only, so it satisfies neither branch on its own.
--
-- The creator branch mirrors `resolveGroupScope()` in
-- `packages/server/src/lib/authz.ts` scope for scope: §4.3 gives `group` manage
-- to "a `teacher`/owner of the group", and `own` to the creator. It is
-- load-bearing rather than decorative, because `setGroupMembers` replaces a
-- roster wholesale (delete, then insert): the caller's own `teacher` row is
-- gone while the INSERT is checked, so without this branch the creator could
-- never write back the roster they had just cleared, and the class would be
-- permanently unmanageable. The `allowed_scopes @> '{own}'` conjunct keeps the
-- two rules agreeing on `group.invite`, whose catalog row does not list `own`
-- (§4.1), so an owner gains nothing there the catalog withholds.
--
-- The org-membership conjunct is not redundant: `group_members` has no foreign
-- key to `org_members`, and #249's cleanup trigger only runs for this org's
-- removals, so a stale membership row must not authorize a former member.
--
-- The argument is checked against the catalog: a teacher of the group satisfies
-- every `p_permission` the caller passes, so without the guard one
-- `rls_caller_has_group_permission(<taught group>, 'deck.update')` answers true
-- and a future policy that wired a content key here would inherit that answer.
-- The payload is deliberately unconstrained, so the catalog is the only place
-- that knows which keys are `group.*`.
--
-- SECURITY DEFINER is load-bearing (R18): five of the policies below live on
-- `group_members` (and the sixth on `groups`), both of which this function
-- reads. Running as the owner bypasses their RLS for the inner lookup — the
-- same shape `rls_caller_has_permission()` uses for `org_role_permissions`.
-- ==========================================
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
  select exists (
    select 1
    from public.groups g
    join public.org_members om
      on om.organization_id = g.organization_id
     and om.user_id = auth.uid()
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
            and gm.user_id = auth.uid()
            and gm.role = 'teacher'
        )
        or (
          g.created_by = auth.uid()
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

-- Every function the migrations create revokes PUBLIC itself: the stack's
-- default privileges keep EXECUTE on PUBLIC, and `anon` — the key every browser
-- holds — must not see this RPC (`20261119200000_function_execute_parity.sql`,
-- R19).
revoke all on function public.rls_caller_has_group_permission(uuid, text) from public;
revoke all on function public.rls_caller_has_group_permission(uuid, text) from anon;
grant execute on function public.rls_caller_has_group_permission(uuid, text)
  to authenticated, service_role;

-- ==========================================
-- groups: insert, update and delete are per group.
--
-- The INSERT check asks the only question a create can: does the caller's role
-- hold `group.manage` in THIS organization, at any scope. The `own`/`group`/
-- `organization` scopes of §4.3 say where an existing class is reachable, not
-- who may start one — and §10 makes the class the teaching surface, so the
-- operator decision of 2b-2 is explicit: **a Teacher may create a class**, and
-- becomes its teacher. An Admin keeps working through `organization` scope. The
-- API's `canCreateGroup()` (`packages/server/src/lib/authz.ts`) is the same
-- rule, and R4 says the two move together.
--
-- The org-membership join is the active-org conjunct: a `group.manage` row on a
-- role of another org is not authority here, and `rls_caller_org_ids()` keeps
-- the tenant floor as in 2a-2.
-- ==========================================
alter policy "Group managers insert groups" on public.groups
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and exists (
      select 1
      from public.org_members om
      join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
      where om.user_id = auth.uid()
        and om.organization_id = groups.organization_id
        and rp.permission_key = 'group.manage'
        and rp.scope in ('own', 'group', 'organization')
    )
  );

alter policy "Group managers update groups" on public.groups
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_group_permission(id, 'group.manage')
  )
  with check (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_group_permission(id, 'group.manage')
  );

alter policy "Group managers delete groups" on public.groups
  using (
    organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
    and public.rls_caller_has_group_permission(id, 'group.manage')
  );

-- ==========================================
-- group_members: the roster is the `group.member.manage` surface. `group_id` is
-- the new row's value on insert/update (WITH CHECK) and the old one on delete
-- (USING), which is the group whose roster changes either way.
-- ==========================================
alter policy "Group managers insert group members" on public.group_members
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_id
        and g.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_group_permission(g.id, 'group.member.manage')
    )
  );

alter policy "Group managers update group members" on public.group_members
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_id
        and g.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_group_permission(g.id, 'group.member.manage')
    )
  )
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_id
        and g.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_group_permission(g.id, 'group.member.manage')
    )
  );

alter policy "Group managers delete group members" on public.group_members
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_id
        and g.organization_id in (
          select c.organization_id from public.rls_caller_org_ids() c
        )
        and public.rls_caller_has_group_permission(g.id, 'group.member.manage')
    )
  );
