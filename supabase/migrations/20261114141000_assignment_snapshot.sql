-- ==========================================
-- The frozen assessment snapshot (#1171, slice 1b).
--
-- `assignment_questions.snapshot` / `snapshot_key` freeze the item at publish. The reader-safe
-- content and the key are separate columns: `assignment_questions` is readable by students
-- through RLS, and a single column holding `is_correct`/`explanation` would be a new
-- client-readable key path (#1165). `snapshot_key` is therefore never granted to `authenticated`;
-- the server reads it with the service role (`readAssignmentSnapshotKeys`).
--
-- Deploy: migration first, app in the same release. A published assignment without a snapshot is
-- backfilled below; the app has no runtime fallback.
-- ==========================================

ALTER TYPE assignment_status ADD VALUE IF NOT EXISTS 'closed';

-- A durable close marker the clock cannot rewrite; enforced by a later slice (#1171 slice 3).
ALTER TABLE public.teacher_assignments
  ADD COLUMN closed_at timestamptz;

ALTER TABLE public.assignment_questions
  ADD COLUMN snapshot jsonb,
  ADD COLUMN snapshot_key jsonb,
  ADD COLUMN snapshot_version int;

-- ==========================================
-- Backfill: every assessment that is already out of draft keeps the version it is serving now.
-- `status <> 'draft'` (not `= 'published'`) so the new `closed` enum value is not referenced in
-- the transaction that adds it.
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

-- Writes keep the student out too: the previous `FOR ALL` let any org member rewrite a frozen
-- snapshot (and would let them forge the key once it exists). Teachers own their assignment;
-- managers keep the documented override.
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

-- ==========================================
-- A frozen assessment's option ids must outlive the live option rows. The author edit path
-- replaces an item's options (delete + insert), so `ON DELETE SET NULL` would silently null
-- every submitted answer that pointed at a published option — and a submit after the edit would
-- fail the foreign key outright. The attempt's own snapshot is the authority for an assignment
-- answer; the submit gate still refuses an option that is not part of the attempt.
-- ==========================================
ALTER TABLE public.student_answers
  DROP CONSTRAINT IF EXISTS student_answers_selected_option_id_fkey;
