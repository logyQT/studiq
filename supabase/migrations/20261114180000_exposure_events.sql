-- ==========================================
-- The exposure ledger (#1171, slice 3c — R8/decision g)
--
-- A student who has seen an item's key or explanation can no longer be graded on that item without
-- saying so, so the system has to know when it showed one. The first surface that renders a key is
-- the post-close review, and every render there records one event. Phase 3 (#1172) turns these
-- events into eligibility; phase 2 only starts recording, so nothing reads them yet.
--
-- One event per (student, item): a second read of the same review must not duplicate it, which is
-- the unique constraint rather than an application check. `group_ids` records the classes the
-- student shared with the run when the key was shown (the reservation's audience), and
-- `seen_correct` is the fact the event stands for.
--
-- Writes are server-only. The insert happens with the service role after the server proved the
-- student is targeted and the review is open; a client-supplied insert would let one student burn
-- another student's items. No INSERT/UPDATE/DELETE policy is defined, and the grants are revoked
-- here; the dev seed that re-applied them after a `db reset` has been retired.
--
-- Deploy: migration first, app in the same release. The table starts empty; no backfill is possible
-- or wanted (events are not retroactive — acceptance criterion 9).
-- ==========================================

CREATE TABLE IF NOT EXISTS public.exposure_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id     uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  -- The organisation that owns the assessment, for staff reads; NULL for legacy personal runs.
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- The targeted classes the student belonged to when the key was shown.
  group_ids       uuid[] NOT NULL DEFAULT '{}',
  seen_correct    boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exposure_events_one_per_item UNIQUE (student_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_exposure_events_question ON public.exposure_events(question_id);
CREATE INDEX IF NOT EXISTS idx_exposure_events_org
  ON public.exposure_events(organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE public.exposure_events ENABLE ROW LEVEL SECURITY;

-- A student reads their own ledger; staff read their organisation's. Never another student's.
DROP POLICY IF EXISTS "Exposure events readable by owner or org staff" ON public.exposure_events;

CREATE POLICY "Exposure events readable by owner or org staff" ON public.exposure_events
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR (
      COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '') IN ('educator', 'manager')
      AND organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.exposure_events FROM authenticated, anon;
