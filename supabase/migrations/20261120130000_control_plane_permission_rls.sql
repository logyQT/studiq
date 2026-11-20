-- Phase 2b slice 4 of the role-authority programme (ADR-0015 §4.1, §7, §7.1;
-- R4).
--
-- The last control-plane policies that still asked a legacy capability helper
-- now ask the permission the route enforces:
--
--   * `billing_subscriptions` read moved its org branch from
--     `rls_caller_is_org_manager` (the `member.manage` entitlement marker) to
--     `org.billing.manage`, the key the billing service now gates on.
--   * `teacher_assignments` UPDATE/DELETE and the `assignment_questions` /
--     `assignment_targets` writes moved their manager branch to
--     `assignment.update` / `assignment.delete`.
--   * `rls_caller_can_read_assignment_items` replaced its staff-persona branch
--     with `assignment.read`.
--
-- Only the capability predicate moves. Every existing conjunct stays: the
-- billing `user_id = auth.uid()` self branch and `organization_id is not null`,
-- the assignment `created_by = auth.uid()` author branch, and the tenant scope
-- the helpers carry themselves.
--
-- Deliberately not moved in this slice (recorded boundary):
--
--   * `teacher_assignments` INSERT keeps its persona conjunct and its SELECT
--     policy stays org-wide. The 17 `teacher/assignments/*` handlers are still
--     persona-gated and belong to 2b-6; moving the insert here would make the
--     API and the data plane disagree and regress EDU-ASG-04 (its fixture is a
--     Member org role). The guard below pins both predicates so a later sweep
--     flips them on purpose.
--   * `can_assign_org_role` and the `invitations` SELECT policy keep
--     `rls_caller_is_org_manager`. Moving the helper's manager half alone does
--     not close 2b-3's recorded retarget asymmetry: measured on this stack,
--     PostgREST refuses an UPDATE whose row the SELECT policy hides, so a role
--     holding `org.invitation.manage` + `org.member.manage` still cannot retarget
--     an invitation it may not read. The write and the read move together, and
--     2b-5 owns both when class invites rewrite the policy onto
--     `rls_caller_has_group_permission`. 2b-3's migration also pins the legacy
--     read (it is replayed by its suite), so a half-move here would break a
--     merged guard rather than complete a sweep.
--   * `org_members` SELECT stays "own row or any org I belong to". D25 recorded
--     the API/RLS asymmetry (the roster read is four keys, the policy is
--     membership); narrowing it here would silently empty every reader audited
--     in the 2b-4 block (stats, assignment target validation, the report inbox,
--     the role list's member counts), which is R21's failure shape in the read
--     direction. Phase 5 owns the narrowing with those readers.
--
-- The any-scope caveat (R4's twin, learned in 2b-2): a Teacher holds every
-- `assignment.*` key at `own` scope, so `rls_caller_has_permission(org,
-- 'assignment.update')` alone would let a Teacher rewrite ANY assignment in the
-- org through PostgREST while the API refuses it. The manager branch therefore
-- asks for the key at **organization** scope, exactly as `verifyOwnership()`
-- does, and the author branch is what reaches a Teacher's own run. The read
-- helper keeps the any-scope key on purpose: the branch it replaces (staff
-- persona in the org) was org-wide too.

-- ==========================================
-- billing_subscriptions: the org branch is `org.billing.manage`. A personal
-- subscription stays readable by its owner; the org row reaches a role holding
-- the billing key, which is the same key BillingService checks.
-- ==========================================
alter policy "Own or org-manager subscription read" on public.billing_subscriptions
  using (
    user_id = auth.uid()
    or (
      organization_id is not null
      and public.rls_caller_has_permission(organization_id, 'org.billing.manage')
    )
  );

-- ==========================================
-- teacher_assignments: editing and deleting a run are `assignment.update` /
-- `assignment.delete`, at organization scope (the author branch covers `own`).
-- ==========================================
alter policy "Authored teacher assignments update" on public.teacher_assignments
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.org_members om
      join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
      where om.user_id = auth.uid()
        and om.organization_id = teacher_assignments.organization_id
        and rp.permission_key = 'assignment.update'
        and rp.scope = 'organization'
    )
  )
  with check (
    created_by = auth.uid()
    or exists (
      select 1
      from public.org_members om
      join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
      where om.user_id = auth.uid()
        and om.organization_id = teacher_assignments.organization_id
        and rp.permission_key = 'assignment.update'
        and rp.scope = 'organization'
    )
  );

alter policy "Authored teacher assignments delete" on public.teacher_assignments
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.org_members om
      join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
      where om.user_id = auth.uid()
        and om.organization_id = teacher_assignments.organization_id
        and rp.permission_key = 'assignment.delete'
        and rp.scope = 'organization'
    )
  );

-- ==========================================
-- The frozen item set and the target list: the same split, resolved on the
-- PARENT assignment's organization (a child row carries no organization_id of
-- its own). `assignment.read` is unchanged and stays in the cohort helper.
-- ==========================================
alter policy "Authored assignment questions insert" on public.assignment_questions
  with check (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.update'
            and rp.scope = 'organization'
        )
    )
  );

alter policy "Authored assignment questions update" on public.assignment_questions
  using (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.update'
            and rp.scope = 'organization'
        )
    )
  )
  with check (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.update'
            and rp.scope = 'organization'
        )
    )
  );

alter policy "Authored assignment questions delete" on public.assignment_questions
  using (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.delete'
            and rp.scope = 'organization'
        )
    )
  );

alter policy "Authored assignment targets insert" on public.assignment_targets
  with check (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.update'
            and rp.scope = 'organization'
        )
    )
  );

alter policy "Authored assignment targets update" on public.assignment_targets
  using (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.update'
            and rp.scope = 'organization'
        )
    )
  )
  with check (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.update'
            and rp.scope = 'organization'
        )
    )
  );

alter policy "Authored assignment targets delete" on public.assignment_targets
  using (
    assignment_id in (
      select a.id
      from public.teacher_assignments a
      where a.created_by = auth.uid()
        or exists (
          select 1
          from public.org_members om
          join public.org_role_permissions rp on rp.org_role_id = om.org_role_id
          where om.user_id = auth.uid()
            and om.organization_id = a.organization_id
            and rp.permission_key = 'assignment.delete'
            and rp.scope = 'organization'
        )
    )
  );

-- ==========================================
-- Staff read of an assignment's frozen item set: the author, or a role holding
-- `assignment.read` in the assignment's organization. This replaces the
-- staff-persona branch (educator/manager account type in the org) and the
-- `rls_caller_is_org_manager` branch; an Admin role satisfies it through the
-- catalog. The targeted-student branch lives in
-- `rls_caller_can_read_assignment_targets`, which calls this function, so it
-- gains the same staff answer without a second definition.
-- ==========================================
create or replace function public.rls_caller_can_read_assignment_items(
  p_assignment_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.teacher_assignments a
    where a.id = p_assignment_id
      and (
        a.created_by = auth.uid()
        or public.rls_caller_has_permission(a.organization_id, 'assignment.read')
      )
  );
$$;

revoke all on function public.rls_caller_can_read_assignment_items(uuid) from public, anon;
grant execute on function public.rls_caller_can_read_assignment_items(uuid)
  to authenticated, service_role;

-- ==========================================
-- Guard: every policy above must name its key in every clause it has — a
-- `with check` reverted to the legacy predicate passes a check that only looks
-- for the key somewhere. The recorded boundaries are pinned in the same block
-- so a later sweep flips them deliberately: the assignment INSERT keeps its
-- persona conjunct and the two assignment SELECTs keep the cohort helpers. The
-- remaining queries are the inventory claims: no policy on a moved table names
-- the legacy manager helper, no policy anywhere names `rls_caller_has_org_feature`
-- (2b-2's record) and the cohort helper reads `assignment.read`. The invitation
-- helper's legacy half is pinned by 2b-3's own migration, which its suite
-- replays, so a half-move here would break that guard instead of completing the
-- sweep — 2b-5 owns both halves.
-- A re-application is a no-op because `alter policy` replaces the predicate in
-- place.
-- ==========================================
do $$
declare
  missing text;
  legacy_in_moved_tables text;
  bad_boundary text;
begin
  select string_agg(expected.tablename || '.' || expected.policyname, ', ')
  into missing
  from (
    values
      ('billing_subscriptions', 'Own or org-manager subscription read', 'org.billing.manage'),
      ('teacher_assignments', 'Authored teacher assignments update', 'assignment.update'),
      ('teacher_assignments', 'Authored teacher assignments delete', 'assignment.delete'),
      ('assignment_questions', 'Authored assignment questions insert', 'assignment.update'),
      ('assignment_questions', 'Authored assignment questions update', 'assignment.update'),
      ('assignment_questions', 'Authored assignment questions delete', 'assignment.delete'),
      ('assignment_targets', 'Authored assignment targets insert', 'assignment.update'),
      ('assignment_targets', 'Authored assignment targets update', 'assignment.update'),
      ('assignment_targets', 'Authored assignment targets delete', 'assignment.delete')
  ) as expected(tablename, policyname, permission_key)
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = expected.tablename
      and p.policyname = expected.policyname
      and (p.qual is null or p.qual like '%' || expected.permission_key || '%')
      and (p.with_check is null or p.with_check like '%' || expected.permission_key || '%')
  );

  if missing is not null then
    raise exception 'control-plane policies without the expected permission in every clause: %', missing;
  end if;

  select string_agg(p.tablename || '.' || p.policyname, ', ')
  into legacy_in_moved_tables
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (
      'billing_subscriptions',
      'teacher_assignments',
      'assignment_questions',
      'assignment_targets'
    )
    and (
      coalesce(p.qual, '') like '%rls_caller_is_org_manager%'
      or coalesce(p.with_check, '') like '%rls_caller_is_org_manager%'
    );

  if legacy_in_moved_tables is not null then
    raise exception 'policies still reading the legacy manager helper after 2b-4: %', legacy_in_moved_tables;
  end if;

  select string_agg(boundary.label, ', ')
  into bad_boundary
  from (
    values
      (
        'teacher_assignments INSERT persona conjunct',
        (
          select count(*) = 0
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = 'teacher_assignments'
            and p.policyname = 'Authored teacher assignments insert'
            and coalesce(p.with_check, '') not like '%account_type%'
        )
      ),
      (
        'teacher_assignments SELECT stays org-wide',
        (
          select count(*) = 0
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = 'teacher_assignments'
            and p.policyname = 'Visible teacher assignments'
            and coalesce(p.qual, '') like '%assignment.%'
        )
      ),
      (
        'assignment_questions SELECT keeps the cohort helper',
        (
          select count(*) = 0
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = 'assignment_questions'
            and p.policyname = 'Visible assignment questions'
            and coalesce(p.qual, '') not like '%rls_caller_can_read_assignment_items%'
        )
      ),
      (
        'rls_caller_can_read_assignment_items reads assignment.read',
        (
          select count(*) = 0
          from pg_proc pr
          join pg_namespace n on n.oid = pr.pronamespace
          where n.nspname = 'public'
            and pr.proname = 'rls_caller_can_read_assignment_items'
            and (
              pr.prosrc not like '%assignment.read%'
              or pr.prosrc like '%rls_caller_is_org_manager%'
              or pr.prosrc like '%account_type%'
            )
        )
      ),
      (
        'assignment_targets SELECT keeps the cohort helper',
        (
          select count(*) = 0
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = 'assignment_targets'
            and p.policyname = 'Visible assignment targets'
            and coalesce(p.qual, '') not like '%rls_caller_can_read_assignment_targets%'
        )
      ),
      (
        'no policy still reads rls_caller_has_org_feature',
        (
          select count(*) = 0
          from pg_policies p
          where p.schemaname = 'public'
            and (
              coalesce(p.qual, '') like '%rls_caller_has_org_feature%'
              or coalesce(p.with_check, '') like '%rls_caller_has_org_feature%'
            )
        )
      )
  ) as boundary(label, ok)
  where not ok;

  if bad_boundary is not null then
    raise exception 'recorded 2b-4 boundary no longer holds: %', bad_boundary;
  end if;
end;
$$;
