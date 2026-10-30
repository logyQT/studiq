-- ==========================================
-- TABLES: notifications
-- In-app notifications, one row per recipient. The text is not stored: `type` + `payload`
-- are rendered by the client in the reader's language. Written by the service layer only
-- (service role); an authenticated user can read their own rows and nothing else.
-- Depends on: 04_profiles.sql, 03_organizations.sql
-- ==========================================

CREATE TABLE public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (
    type IN ('assignment_published', 'assignment_graded', 'report_message', 'invitation_accepted')
  ),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread
  ON public.notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own notifications read" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
