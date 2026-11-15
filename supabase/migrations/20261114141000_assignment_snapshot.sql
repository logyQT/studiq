-- ==========================================
-- The frozen assessment snapshot (#1171, slice 1b-i).
--
-- `assignment_questions.snapshot` / `snapshot_key` freeze the item at publish. The reader-safe
-- content and the key are separate columns: `assignment_questions` is readable by students
-- through RLS, and a single column holding `is_correct`/`explanation` would be a new
-- client-readable key path (#1165). `snapshot_key` is therefore never granted to `authenticated`;
-- the server reads it with the service role.
--
-- This migration also closes a PRE-EXISTING hole the snapshot would otherwise inherit:
-- `teacher_assignments` was `FOR ALL` for the whole organisation, so any member could rewrite any
-- assignment row — including `created_by` — and the assignment_questions write policies trust
-- `created_by`. A student could therefore claim an assignment and rewrite its snapshot and key.
-- Writes are now the author's or an org manager's; reads stay org-wide (a student must read the
-- assignment they were targeted in). `assignment_targets` follows the same split.
--
-- Deploy: migration first, app in the same release. A published assignment without a snapshot is
-- backfilled below; the read paths land in the stacked follow-up.
-- ==========================================

ALTER TABLE public.assignment_questions
  ADD COLUMN snapshot jsonb,
  ADD COLUMN snapshot_key jsonb,
  ADD COLUMN snapshot_version int;

-- ==========================================
-- Backfill: every assessment that is already out of draft keeps the version it is serving now.
-- ==========================================
UPDATE public.assignment_questions AS aq
SET snapshot = jsonb_build_object(
      'id', q.id,
      'content', q.content,
      'type', q.type,
      'question_answers', COALESCE(
        (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'id', o.id,
                     'content', o.content,
                     'order_index', o.order_index,
                     'match_group', o.match_group,
                     'match_side', o.match_side
                   )
                   ORDER BY o.order_index, o.id
                 )
          FROM public.question_options o
          WHERE o.question_id = q.id
        ),
        '[]'::jsonb
      )
    ),
    snapshot_key = jsonb_build_object(
      'explanation', q.explanation,
      'correctOptionIds', COALESCE(
        (
          SELECT jsonb_agg(o.id)
          FROM public.question_options o
          WHERE o.question_id = q.id AND o.is_correct
        ),
        '[]'::jsonb
      )
    ),
    snapshot_version = q.version
FROM public.questions q,
     public.teacher_assignments ta
WHERE aq.question_id = q.id
  AND ta.id = aq.assignment_id
  AND ta.status <> 'draft';

-- ==========================================
-- The key column leaves the client-readable surface. A table-wide REVOKE cannot subtract from a
-- table-wide GRANT, so the table grant goes and the reader columns come back.
-- ==========================================
REVOKE SELECT ON public.assignment_questions FROM authenticated, anon;

GRANT SELECT (id, assignment_id, question_id, order_index, points, snapshot, snapshot_version)
  ON public.assignment_questions TO authenticated;

-- ==========================================
-- Assignment ownership. `teacher_assignments` writes were org-wide for every member, and the
-- child tables inherit that trust through `created_by`. A student could PATCH `created_by` to
-- themselves and then rewrite `assignment_questions.snapshot_key` with `Prefer: return=minimal`
-- (which does not need the revoked SELECT), so the next start served a forged key. The root
-- policy is narrowed here, not only the child policies.
-- ==========================================
DROP POLICY "Org members manage teacher assignments" ON public.teacher_assignments;

CREATE POLICY "Visible teacher assignments" ON public.teacher_assignments
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Authored teacher assignments insert" ON public.teacher_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (auth.jwt() -> 'app_metadata' ->> 'account_type') IN ('educator', 'manager')
    AND organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Authored teacher assignments update" ON public.teacher_assignments
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid() OR public.rls_caller_is_org_manager(organization_id)
  )
  WITH CHECK (
    created_by = auth.uid() OR public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Authored teacher assignments delete" ON public.teacher_assignments
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid() OR public.rls_caller_is_org_manager(organization_id)
  );

-- The assignment's frozen item set: readable by the org, writable only by its author or a manager.
DROP POLICY "Visible assignment questions" ON public.assignment_questions;

CREATE POLICY "Visible assignment questions" ON public.assignment_questions
  FOR SELECT TO authenticated
  USING (
    assignment_id IN (SELECT a.id FROM public.teacher_assignments a)
  );

CREATE POLICY "Authored assignment questions insert" ON public.assignment_questions
  FOR INSERT TO authenticated
  WITH CHECK (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  );

CREATE POLICY "Authored assignment questions update" ON public.assignment_questions
  FOR UPDATE TO authenticated
  USING (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  )
  WITH CHECK (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  );

CREATE POLICY "Authored assignment questions delete" ON public.assignment_questions
  FOR DELETE TO authenticated
  USING (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  );

-- Assignment targets: the same ownership split (a student could otherwise repoint the cohort).
DROP POLICY "Visible assignment targets" ON public.assignment_targets;

CREATE POLICY "Visible assignment targets" ON public.assignment_targets
  FOR SELECT TO authenticated
  USING (
    assignment_id IN (SELECT a.id FROM public.teacher_assignments a)
  );

CREATE POLICY "Authored assignment targets insert" ON public.assignment_targets
  FOR INSERT TO authenticated
  WITH CHECK (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  );

CREATE POLICY "Authored assignment targets update" ON public.assignment_targets
  FOR UPDATE TO authenticated
  USING (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  )
  WITH CHECK (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  );

CREATE POLICY "Authored assignment targets delete" ON public.assignment_targets
  FOR DELETE TO authenticated
  USING (
    assignment_id IN (
      SELECT a.id FROM public.teacher_assignments a
      WHERE a.created_by = auth.uid() OR public.rls_caller_is_org_manager(a.organization_id)
    )
  );
