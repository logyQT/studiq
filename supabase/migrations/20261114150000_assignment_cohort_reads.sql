-- ==========================================
-- The sealed item set at the database boundary, and cohort-scoped assignment reads
-- (#1171, slice 2 — R1/R2/R14/R19).
--
-- Two client-readable surfaces had to move:
--
-- 1. `questions` was readable by every member of the organisation, so a student could read the stem
--    and options of an item a live assessment had sealed for them — the same leak the app filters
--    on every route, one layer down. A RESTRICTIVE SELECT policy now hides a sealed row from a
--    student; staff are untouched, and `question_options` / `question_topic_assignments` follow
--    automatically because their policies select from `questions`.
--
-- 2. `assignment_questions` was org-readable. Its `snapshot` column carries the reader-safe item
--    (stem + options), so a classmate — or a student below their own window — could read the whole
--    held item set. It is now staff-only: the author, an org manager, or an educator/manager in the
--    org. Every student-side read goes through the service role after the server has proved the
--    attempt/assignment is theirs (`readAssignmentLinks`), which is also why `startAttempt` no
--    longer embeds the links.
--
-- `assignment_targets` keeps a cohort view (a targeted student still needs to resolve their own
-- cohort server-side); the target list carries no item content.
--
-- The predicates are SECURITY DEFINER so a policy does not re-enter the RLS of the tables it reads
-- (the `rls_caller_is_org_manager` pattern). `rls_caller_is_sealed_item` takes one id: a caller can
-- only learn "is this specific id sealed for me", exactly what the app's `404` already answers —
-- never the set (R14).
--
-- Deploy: migration first, app in the same release (the student take/submit paths switch to the
-- service-role readers in the same commit).
-- ==========================================

-- Staff view of an assignment's item set: its author, an org manager, or an educator/manager in
-- the assignment's organisation.
CREATE OR REPLACE FUNCTION public.rls_caller_can_read_assignment_items(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_assignments a
    WHERE a.id = p_assignment_id
      AND (
        a.created_by = auth.uid()
        OR public.rls_caller_is_org_manager(a.organization_id)
        OR (
          COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '') IN ('educator', 'manager')
          AND a.organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.rls_caller_can_read_assignment_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_can_read_assignment_items(uuid)
  TO authenticated, service_role;

-- Cohort view of the target list: staff, plus a student the run targets directly or by group.
CREATE OR REPLACE FUNCTION public.rls_caller_can_read_assignment_targets(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.rls_caller_can_read_assignment_items(p_assignment_id)
    OR EXISTS (
      SELECT 1
      FROM public.assignment_targets t
      WHERE t.assignment_id = p_assignment_id
        AND (
          t.student_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.group_members gm
            WHERE gm.group_id = t.group_id
              AND gm.user_id = auth.uid()
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.rls_caller_can_read_assignment_targets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_can_read_assignment_targets(uuid)
  TO authenticated, service_role;

-- Whether one item is sealed for the calling student right now: a published run that targets them
-- and whose window is open binds it. `deadline IS NULL` leaves the window open (the publish gate
-- requires a deadline from this release on, so this only covers rows published before it).
CREATE OR REPLACE FUNCTION public.rls_caller_is_sealed_item(p_question_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '') = 'student'
    AND EXISTS (
      SELECT 1
      FROM public.assignment_questions aq
      JOIN public.teacher_assignments a ON a.id = aq.assignment_id
      WHERE aq.question_id = p_question_id
        AND a.status = 'published'
        AND (a.start_time IS NULL OR a.start_time <= now())
        AND (a.deadline IS NULL OR a.deadline > now())
        AND EXISTS (
          SELECT 1
          FROM public.assignment_targets t
          WHERE t.assignment_id = a.id
            AND (
              t.student_id = auth.uid()
              OR EXISTS (
                SELECT 1
                FROM public.group_members gm
                WHERE gm.group_id = t.group_id
                  AND gm.user_id = auth.uid()
              )
            )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.rls_caller_is_sealed_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_is_sealed_item(uuid) TO authenticated, service_role;

-- A sealed row is absent for the student that the window holds it from. RESTRICTIVE, so it
-- narrows the existing permissive "Own or same-org access" policy instead of widening it.
DROP POLICY IF EXISTS "Sealed items stay absent" ON public.questions;

CREATE POLICY "Sealed items stay absent" ON public.questions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.rls_caller_is_sealed_item(id));

DROP POLICY "Visible assignment questions" ON public.assignment_questions;

CREATE POLICY "Visible assignment questions" ON public.assignment_questions
  FOR SELECT TO authenticated
  USING (public.rls_caller_can_read_assignment_items(assignment_id));

DROP POLICY "Visible assignment targets" ON public.assignment_targets;

CREATE POLICY "Visible assignment targets" ON public.assignment_targets
  FOR SELECT TO authenticated
  USING (public.rls_caller_can_read_assignment_targets(assignment_id));
