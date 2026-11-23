-- Phase 5e-1 of the role-authority programme (ADR-0015 §7.1; 2b-9 deferral
-- register rows 4 and 11 in docs/plans/role-authority-plan.md; decisions
-- D-5e1, D-5e2, D-5e3; R4, R18, R19, R26, R27).
--
-- "Learner on an assignment" becomes DATA, not persona (D-5e1). One
-- definition, three arms, identical in the SQL and the TS halves
-- (packages/server/src/lib/question-seal.ts): a caller is a learner for a
-- published, in-window (or held-back) assignment when it targets them
--
--   1. directly: assignment_targets.student_id = caller;
--   2. through a group where the caller's group_members.role = 'member'
--      (a group teacher is staff of that class, not a learner in it);
--   3. org-wide (seal_org_wide) and the caller's org role in the
--      assignment's organization has org_roles.entitlement_profile =
--      'learner' (the system Member role; Admin/Teacher are 'all').
--
-- This file owns three objects:
--
--   1. public.rls_caller_is_sealed_item — the JWT account_type conjunct is
--      replaced by the three arms (the published/window/withheld logic is
--      kept verbatim). The function stays security definer,
--      search_path = '', stable, granted to authenticated + service_role.
--   2. The exposure_events SELECT policy — the persona staff half moves to
--      a capability at a staff scope:
--      rls_caller_covers_permission(organization_id, 'stats.read', 'group')
--      ('stats.read' is the teacher-dashboard key; the scope rank own <
--      group < organization means a Member's stats.read at own does NOT
--      qualify). INSERT/UPDATE/DELETE stay revoked.
--   3. The quiz_attempts "Own or staff quiz attempts" policy — one
--      predicate for USING and WITH CHECK (grading writes another user's
--      row, so the two clauses must stay identical): own row, or a
--      same-org row the caller covers via stats.read / assignment.read /
--      assignment.update at group-or-wider scope, or an attempt of an
--      assignment the caller authored. quiz_attempts.organization_id is
--      trigger-stamped since 20261028100000.
--
-- Re-runnable: create or replace / drop+create policy plus a guarded DO
-- block — a db reset and a hand re-apply end in the same state (R19).
-- R27: this file is now the newest owner of all three objects, so the
-- replay lists replay it after 20261122180000 (which owns
-- rls_caller_covers_permission) and after 20261114170000/…180000/…130000.

-- ==========================================
-- 1. The seal: learner-by-data, not persona (D-5e1).
-- ==========================================
CREATE OR REPLACE FUNCTION public.rls_caller_is_sealed_item(p_question_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignment_questions aq
    JOIN public.teacher_assignments a ON a.id = aq.assignment_id
    WHERE aq.question_id = p_question_id
      AND a.status = 'published'
      AND (a.start_time IS NULL OR a.start_time <= now())
      AND (
        -- the window is live …
        (a.closed_at IS NULL AND (a.deadline IS NULL OR a.deadline > now()))
        -- … or the item is held back from the review and not released yet (R10)
        OR (aq.withhold_from_review AND aq.released_at IS NULL)
      )
      AND (
        -- arm 1: the run targets the caller directly …
        EXISTS (
          SELECT 1
          FROM public.assignment_targets t
          WHERE t.assignment_id = a.id
            AND t.student_id = auth.uid()
        )
        -- … arm 2: through a group the caller is a *member* of (a group
        -- teacher is staff, not a learner) …
        OR EXISTS (
          SELECT 1
          FROM public.assignment_targets t
          WHERE t.assignment_id = a.id
            AND EXISTS (
              SELECT 1
              FROM public.group_members gm
              WHERE gm.group_id = t.group_id
                AND gm.user_id = auth.uid()
                AND gm.role = 'member'
            )
        )
        -- … arm 3: the run is org-wide and the caller's role in the run's
        -- organization is a learner profile.
        OR (
          a.seal_org_wide
          AND EXISTS (
            SELECT 1
            FROM public.org_members om
            JOIN public.org_roles r ON r.id = om.org_role_id
            WHERE om.user_id = auth.uid()
              AND om.organization_id = a.organization_id
              AND r.entitlement_profile = 'learner'
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.rls_caller_is_sealed_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_is_sealed_item(uuid) TO authenticated, service_role;

-- ==========================================
-- 2. The exposure ledger: the staff read is a capability at a staff scope.
--    `stats.read` is the teacher-dashboard key; 'group' is the floor a
--    Member's own-scope row does not meet (covers_permission ranks
--    own < group < organization).
-- ==========================================
DROP POLICY IF EXISTS "Exposure events readable by owner or org staff" ON public.exposure_events;

CREATE POLICY "Exposure events readable by owner or org staff" ON public.exposure_events
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
      AND public.rls_caller_covers_permission(organization_id, 'stats.read', 'group')
    )
  );

-- Writes stay server-only (R19: the migration owns the grants, so they are
-- restated — a re-apply cannot drift them).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.exposure_events FROM authenticated, anon;

-- ==========================================
-- 3. quiz_attempts: one predicate, both clauses (D-5e3). USING and WITH
--    CHECK are identical because grading updates another user's attempt
--    row (teacher-assignment.service.ts gradeAnswer). The staff branch
--    keys on org capability + the author, never the JWT persona. The keys:
--    stats.read (teacher dashboard), assignment.read and assignment.update
--    at group-or-wider (getResults/gradeAnswer gate on assignment.update;
--    a custom role holding assignment.update@organization but no read key
--    must still read its cohort), and the author arm keeps the
--    Teacher-author path. Do NOT use rls_caller_has_permission here: it is
--    any-scope and would admit a Member's own-scope stats.read.
-- ==========================================
DROP POLICY IF EXISTS "Own or staff quiz attempts" ON public.quiz_attempts;

CREATE POLICY "Own or staff quiz attempts" ON public.quiz_attempts
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
      AND (
        public.rls_caller_covers_permission(organization_id, 'stats.read', 'group')
        OR public.rls_caller_covers_permission(organization_id, 'assignment.read', 'group')
        OR public.rls_caller_covers_permission(organization_id, 'assignment.update', 'group')
        OR EXISTS (
          SELECT 1
          FROM public.teacher_assignments a
          WHERE a.id = quiz_attempts.assignment_id
            AND a.created_by = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
      AND (
        public.rls_caller_covers_permission(organization_id, 'stats.read', 'group')
        OR public.rls_caller_covers_permission(organization_id, 'assignment.read', 'group')
        OR public.rls_caller_covers_permission(organization_id, 'assignment.update', 'group')
        OR EXISTS (
          SELECT 1
          FROM public.teacher_assignments a
          WHERE a.id = quiz_attempts.assignment_id
            AND a.created_by = auth.uid()
        )
      )
    )
  );

-- ==========================================
-- Closing guard (R26): the objects this file creates exist AND carry the
-- predicate they are supposed to carry — a dropped function, a policy that
-- lost a conjunct or regained the persona branch must fail the migration,
-- not pass vacuously. Every check asserts the row exists (count = 1), so
-- it cannot pass on a missing object.
-- ==========================================
do $$
declare
  v_def text;
begin
  -- 1. rls_caller_is_sealed_item: the three learner arms are in, the JWT
  --    persona conjunct is out, and the function keeps its security-definer,
  --    search_path-pinned shape and its authenticated + service_role grants.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'rls_caller_is_sealed_item';

  if v_def is null
     or position('entitlement_profile' in v_def) = 0
     or position('''member''' in v_def) = 0
     or position('seal_org_wide' in v_def) = 0
     or position('account_type' in v_def) > 0
     or not exists (
       select 1
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'rls_caller_is_sealed_item'
         and p.prosecdef
         and p.proconfig @> array['search_path=""']::text[]
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
     )
  then
    raise exception 'rls_caller_is_sealed_item no longer carries the three D-5e1 learner arms (or still reads account_type) with its definer/search_path/grants';
  end if;

  -- 2. The exposure_events SELECT policy: owner branch plus the
  --    stats.read@group staff branch, no persona, and no write policy.
  if (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'exposure_events'
      and p.policyname = 'Exposure events readable by owner or org staff'
      and p.cmd = 'SELECT'
      and p.qual is not null
      and position('student_id = auth.uid()' in p.qual) > 0
      and position('rls_caller_covers_permission' in p.qual) > 0
      and position('stats.read' in p.qual) > 0
      and position('account_type' in p.qual) = 0
  ) <> 1
  then
    raise exception 'the exposure_events SELECT policy no longer combines the owner branch with rls_caller_covers_permission(organization_id, ''stats.read'', ''group'')';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'exposure_events'
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'exposure_events gained a client-write policy — writes are server-only';
  end if;

  -- 3. The quiz_attempts policy: exactly one row, USING and WITH CHECK both
  --    carry the three capability keys and the author arm, and neither
  --    reads the JWT persona.
  if (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'quiz_attempts'
      and p.policyname = 'Own or staff quiz attempts'
      and p.qual is not null
      and p.with_check is not null
      and position('user_id = auth.uid()' in p.qual) > 0
      and position('stats.read' in p.qual) > 0
      and position('assignment.read' in p.qual) > 0
      and position('assignment.update' in p.qual) > 0
      and position('teacher_assignments' in p.qual) > 0
      and position('account_type' in p.qual) = 0
      and position('stats.read' in p.with_check) > 0
      and position('assignment.read' in p.with_check) > 0
      and position('assignment.update' in p.with_check) > 0
      and position('teacher_assignments' in p.with_check) > 0
      and position('account_type' in p.with_check) = 0
  ) <> 1
  then
    raise exception 'the quiz_attempts "Own or staff quiz attempts" policy no longer carries the D-5e3 predicate identically in USING and WITH CHECK';
  end if;
end;
$$;
