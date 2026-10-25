-- ==========================================
-- TABLES: payments
-- Append-only purchase log written by the payment webhook
-- (service role) and read by `/api/v1/me/payments` for the
-- caller's own rows. Plan name/amount/currency are snapshots,
-- so a catalog edit cannot rewrite past charges; `session_id`
-- is the idempotency key. No FK on `plan_key` on purpose —
-- `seeds/00_plans.sql` deletes and re-inserts the plan catalog.
-- Depends on: 04_profiles.sql, 03_organizations.sql
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
