-- Reports gain a lifecycle: the recipient (teacher / group owner / org admin)
-- resolves; either participant reopens by replying. Bodies and reporter identity
-- stay private to the two participants (plus the active-org admin, #276) — this
-- migration adds state, not visibility.
CREATE TYPE public.report_status AS ENUM ('open', 'resolved');

ALTER TABLE public.question_reports
  ADD COLUMN status      public.report_status NOT NULL DEFAULT 'open',
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT question_reports_resolution_consistent CHECK (
    (status = 'open'  AND resolved_at IS NULL) OR
    (status = 'resolved' AND resolved_at IS NOT NULL)
  );

CREATE INDEX idx_question_reports_teacher_status
  ON public.question_reports(teacher_id, status, updated_at DESC);
CREATE INDEX idx_question_reports_reporter_status
  ON public.question_reports(reported_by, status, updated_at DESC);
