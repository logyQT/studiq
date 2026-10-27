-- ==========================================
-- In-app notifications (#664, ROADMAP 8D).
--
-- One row per notification per recipient. The text is not stored: the row keeps a `type` and a
-- small `payload`, and the client renders it in the reader's language, so a user who switches
-- language sees old notifications in the new one.
--
-- Deliberate choices (same shape as `payments`):
--   * Writes are service role only. There is no INSERT / UPDATE / DELETE policy and the
--     privileges are revoked from `authenticated`, so a signed-in user cannot forge a
--     notification for someone else, or rewrite one of their own. Producers (publishing an
--     assignment, grading, a report reply, an accepted invitation) and "mark as read" run through
--     the service layer, which filters by the caller's id.
--   * Own-row SELECT only.
--   * `ON DELETE CASCADE` on user and organization, so purging an account or an organization
--     takes its notifications with it.
--   * The `type` list is a CHECK, so a new kind of notification is a migration, not a typo.
--
-- `supabase/seeds/99_dev_grants.sql` re-grants ALL on every table after the migrations, so
-- `public.notifications` is added to its read-only list as well.
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

REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
