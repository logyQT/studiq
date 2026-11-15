-- ==========================================
-- Withheld items and the review key (#1171, slice 3b — R5/R10)
--
-- `withholdFromReview` is a per-item decision: the teacher wants that item's key kept back from the
-- cohort review, so it must stay sealed past the close instead of becoming public the moment the
-- reservations end. The item is released explicitly (`released_at`), after which it is both visible
-- in the review and practiceable again — until then it stays absent from every student surface, and
-- the R14 notice says "held until released" rather than showing a date that has already passed.
--
-- The review itself renders `snapshot_key`, which is already service-role only; this migration adds
-- no new student-readable key path.
--
-- Deploy: migration first, app in the same release. `false` is the previous behaviour, so no
-- existing item becomes withheld retroactively.
-- ==========================================

ALTER TABLE public.assignment_questions
  ADD COLUMN IF NOT EXISTS withhold_from_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

-- Staff read the flags through their own client (the row policy on this table is staff-only, so a
-- student still reads no row and therefore no flag). The reader-safe content grant stays as it was.
GRANT SELECT (withhold_from_review, released_at) ON public.assignment_questions TO authenticated;

-- A withheld item stays sealed after the close until it is released. Everything else is unchanged
-- from the durable-close predicate.
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
        AND (
          -- the window is live …
          (a.closed_at IS NULL AND (a.deadline IS NULL OR a.deadline > now()))
          -- … or the item is held back from the review and not released yet (R10)
          OR (aq.withhold_from_review AND aq.released_at IS NULL)
        )
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

REVOKE ALL ON FUNCTION public.rls_caller_is_sealed_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_is_sealed_item(uuid) TO authenticated, service_role;
