-- Phase 2b slice 6 of the role-authority programme (ADR-0015 §4.1, §7; R4).
--
-- The content-route sweep moved the teacher/assignment API gates from the persona
-- (`allowedAccountTypes` on the route files) to the catalog keys the controllers
-- now check, so the one content write policy that still asked the persona moves
-- with it: `teacher_assignments` INSERT asked
-- `(auth.jwt() -> 'app_metadata' ->> 'account_type') IN ('educator', 'manager')`.
-- 2b-4 recorded that boundary and deliberately left it for this slice, because the
-- 15 `teacher/assignments/*` route files were still persona-gated then and moving
-- the insert alone would have made the API and the data plane disagree.
--
-- The policy now asks `assignment.create`, the key POST /api/v1/teacher/assignments
-- and POST /api/v1/teacher/quizzes/:id/create-assignment gate on in the controller.
-- `created_by = auth.uid()` is the own-scope rule for a row being created (ADR-0015
-- §6.3), so a holder of the key at any scope may mint its own run — a Teacher at
-- `own`/`group`, an Admin at `organization`, and a student-persona Admin too (D13:
-- the persona is irrelevant). The tenant floor (`rls_caller_org_ids()`) stays.
--
-- Deliberately not moved here: the org-wide `Visible teacher assignments` SELECT
-- stays as 2b-4 shipped it (its readers — the student attempt flows, the cohort
-- helpers — are audited in phase 5), and UPDATE/DELETE keep the 2b-4 keys.

alter policy "Authored teacher assignments insert" on public.teacher_assignments
  with check (
    created_by = auth.uid()
    and public.rls_caller_has_permission(organization_id, 'assignment.create')
    and organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
  );

-- Guard (R26): each boundary is a `count(*) = 1` over the policy row AND its
-- predicate, so a dropped or renamed policy raises here instead of passing
-- vacuously (`count(*) = 0 … not like` stays green when the row is gone). A
-- re-application is a no-op because `alter policy` replaces the predicate in place.
do $$
declare
  bad_boundary text;
begin
  select string_agg(boundary.label, ', ')
  into bad_boundary
  from (
    values
      (
        'Authored teacher assignments insert policy is missing',
        (
          select count(*) = 1
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = 'teacher_assignments'
            and p.policyname = 'Authored teacher assignments insert'
        )
      ),
      (
        'Authored teacher assignments insert not on assignment.create, or still persona-keyed',
        (
          select count(*) = 1
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = 'teacher_assignments'
            and p.policyname = 'Authored teacher assignments insert'
            and coalesce(p.with_check, '') like '%assignment.create%'
            and coalesce(p.with_check, '') not like '%account_type%'
        )
      )
  ) as boundary(label, ok)
  where not ok;

  if bad_boundary is not null then
    raise exception 'teacher_assignments insert policy does not hold the 2b-6 boundary: %', bad_boundary;
  end if;
end;
$$;
