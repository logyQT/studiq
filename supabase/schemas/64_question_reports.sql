-- ==========================================
-- TABLES: question_reports, question_report_messages
-- A user flags a problem with a piece of content they can't fix
-- themselves. Started as questions only (student → question's
-- teacher author); extended to also cover groups a teacher can't
-- manage (teacher → group's owner, or the org admin when the group
-- has none). Exactly one of question_id/group_id is set. Each report
-- is a private 1:1 thread between the reporter and the recipient —
-- never visible to anyone else.
-- Depends on: 04_profiles.sql, 24_questions.sql, 03_organizations.sql, 60_groups.sql
-- ==========================================

CREATE TABLE public.question_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id             uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  group_id                uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  organization_id         uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  reported_by             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  teacher_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reporter_last_read_at   timestamptz NOT NULL DEFAULT now(),
  teacher_last_read_at    timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_reports_one_target CHECK (
    (question_id IS NOT NULL AND group_id IS NULL) OR
    (question_id IS NULL AND group_id IS NOT NULL)
  )
);

CREATE INDEX idx_question_reports_reporter ON public.question_reports(reported_by, updated_at DESC);
CREATE INDEX idx_question_reports_teacher ON public.question_reports(teacher_id, updated_at DESC);
CREATE INDEX idx_question_reports_question ON public.question_reports(question_id);
CREATE INDEX idx_question_reports_group ON public.question_reports(group_id);

CREATE TABLE public.question_report_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    uuid NOT NULL REFERENCES public.question_reports(id) ON DELETE CASCADE,
  sender_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_question_report_messages_report ON public.question_report_messages(report_id, created_at);

CREATE OR REPLACE FUNCTION public.touch_question_report_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.question_reports
  SET
    updated_at = now(),
    reporter_last_read_at = CASE
      WHEN NEW.sender_id = reported_by THEN now() ELSE reporter_last_read_at
    END,
    teacher_last_read_at = CASE
      WHEN NEW.sender_id = teacher_id THEN now() ELSE teacher_last_read_at
    END
  WHERE id = NEW.report_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_question_report_messages_touch
  AFTER INSERT ON public.question_report_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_question_report_on_message();
