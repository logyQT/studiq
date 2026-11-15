-- ==========================================
-- TABLE: exposure_events
-- The exposure ledger (#1171, R8/decision g): one row per (student, item) whose key or
-- explanation the system showed. Written server-side only; phase 3 (#1172) reads it for
-- eligibility.
-- Depends on: 04_profiles.sql, 24_questions.sql, 03_organizations.sql
-- ==========================================

CREATE TABLE public.exposure_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id     uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  group_ids       uuid[] NOT NULL DEFAULT '{}',
  seen_correct    boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exposure_events_one_per_item UNIQUE (student_id, question_id)
);

CREATE INDEX idx_exposure_events_question ON public.exposure_events(question_id);
CREATE INDEX idx_exposure_events_org
  ON public.exposure_events(organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE public.exposure_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Exposure events readable by owner or org staff" ON public.exposure_events
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR (
      COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '') IN ('educator', 'manager')
      AND organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    )
  );
