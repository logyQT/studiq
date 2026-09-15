-- ==========================================================
-- Migration: 20260915000007
-- Description: extend question_reports to also cover groups.
-- A teacher who can't manage a group (locked in the UI — created by
-- someone else) can report an issue on it, same "1:1 thread" model
-- already used for question issues. The recipient is the group's
-- owner (created_by) when it has one, otherwise the org's admin.
-- ==========================================================

ALTER TABLE public.question_reports
  ALTER COLUMN question_id DROP NOT NULL,
  ADD COLUMN group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  ADD CONSTRAINT question_reports_one_target CHECK (
    (question_id IS NOT NULL AND group_id IS NULL) OR
    (question_id IS NULL AND group_id IS NOT NULL)
  );

CREATE INDEX idx_question_reports_group ON public.question_reports(group_id);
