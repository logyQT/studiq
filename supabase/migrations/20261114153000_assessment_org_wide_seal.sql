-- ==========================================
-- The per-assessment org-wide seal (#1171, slice 2b — R3).
--
-- Publishing a run seals its items for the classes it targets. When the items are also in a bank
-- other classes can practise, that is cross-class exposure: publishing requires an explicit
-- acknowledgement, or the teacher seals the item for the whole organisation instead. The choice is a
-- property of the assessment (so it survives a withdraw/republish), and it widens the derived seal
-- to every student of the owning organisation — including students who join after publish.
--
-- Deploy: migration first, app in the same release. `false` is the existing per-class behaviour, so
-- a pre-existing run keeps sealing exactly what it sealed before.
-- ==========================================

ALTER TABLE public.teacher_assignments
  ADD COLUMN IF NOT EXISTS seal_org_wide boolean NOT NULL DEFAULT false;

-- The seal predicate grows the org-wide arm: a published, open run with `seal_org_wide` holds its
-- items from every member of its organisation, not only its targets.
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
        AND (
          (
            a.seal_org_wide
            AND a.organization_id IN (
              SELECT c.organization_id FROM public.rls_caller_org_ids() c
            )
          )
          OR EXISTS (
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
        )
    );
$$;
