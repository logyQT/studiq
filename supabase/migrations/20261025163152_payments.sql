-- ==========================================
-- Issue #392 (STU-52): "Historia płatności" was a hard-coded placeholder.
--
-- The simulated checkout (`mock-stripe.service.handleWebhook`) only moved
-- `profiles.personal_plan_key` / `organizations.plan`; it persisted no record
-- of the purchase, and no table existed to hold one. This adds an append-only
-- purchase log that the webhook writes and `/api/v1/me/payments` reads.
--
-- Deliberate choices:
--   * No FK on `plan_key`: `supabase/seeds/00_plans.sql` DELETEs and re-inserts
--     `subscription_plans`, so a FK would abort the seed or cascade the history
--     away. `plan_name`/`amount`/`currency` are snapshotted at purchase time so
--     a later catalog edit cannot rewrite past charges.
--   * `session_id` is UNIQUE: the mock checkout id is the only per-purchase
--     identifier, so webhook replays collapse onto one row (the write uses
--     `onConflict: session_id, ignoreDuplicates: true`).
--   * Writes are service-role only: no INSERT/UPDATE/DELETE policy and the
--     privileges are revoked from `authenticated`, so a signed-in user cannot
--     forge history through PostgREST. Own-row SELECT is granted because the
--     read service runs on the caller's session client.
--   * `ON DELETE CASCADE` on `user_id` matches the admin soft-delete/purge path.
--   * `organization_id` is recorded for org-plan purchases but is never read by
--     `/api/v1/me/payments`; an org-wide history must add a manager/org check.
--
-- `supabase/seeds/99_dev_grants.sql` re-grants ALL on every table after the
-- migrations, so `public.payments` is added to its read-only list as well.
-- ==========================================

CREATE TABLE public.payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  plan_key        text NOT NULL,
  plan_name       text NOT NULL,
  amount          int NOT NULL CHECK (amount >= 0),
  currency        text NOT NULL DEFAULT 'PLN',
  session_id      text NOT NULL UNIQUE,
  paid_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_user_paid_at ON public.payments (user_id, paid_at DESC);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own payments read" ON public.payments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.payments FROM anon, authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
