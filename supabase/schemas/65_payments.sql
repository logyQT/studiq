-- ==========================================
-- TABLES: payments
-- Append-only purchase log written by the payment webhook
-- (service role) and read by `/api/v1/me/payments` for the
-- caller's own rows. Plan name/amount/currency are snapshots,
-- so a catalog edit cannot rewrite past charges.
--
-- Mock rows: `provider='mock'`, `session_id` is the client-generated
-- checkout id and the idempotency key.
-- Stripe rows: one per paid invoice, keyed by `stripe_invoice_id`
-- (renewals/upgrades) or `stripe_checkout_session_id` (first purchase).
-- `amount` is the amount actually paid in minor units.
--
-- No FK on `plan_key` on purpose — `seeds/00_plans.sql` deletes and
-- re-inserts the plan catalog. RLS/grants live in
-- 20261025163152_payments.sql and 20261030130200_payments_stripe_columns.sql.
-- Depends on: 04_profiles.sql, 03_organizations.sql
-- ==========================================

CREATE TABLE public.payments (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id            uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  plan_key                   text NOT NULL,
  plan_name                  text NOT NULL,
  amount                     int NOT NULL CHECK (amount >= 0),
  currency                   text NOT NULL DEFAULT 'PLN',
  session_id                 text UNIQUE,
  provider                   text NOT NULL DEFAULT 'mock'
                               CHECK (provider IN ('mock', 'stripe')),
  stripe_customer_id         text,
  stripe_subscription_id     text,
  stripe_invoice_id          text,
  stripe_checkout_session_id text,
  hosted_invoice_url         text,
  invoice_pdf_url            text,
  status                     text NOT NULL DEFAULT 'paid'
                               CHECK (status IN ('paid', 'refunded', 'partially_refunded')),
  paid_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_has_external_ref
    CHECK (
      session_id IS NOT NULL
      OR stripe_invoice_id IS NOT NULL
      OR stripe_checkout_session_id IS NOT NULL
    )
);

CREATE INDEX idx_payments_user_paid_at ON public.payments (user_id, paid_at DESC);
CREATE INDEX idx_payments_org_paid_at
  ON public.payments (organization_id, paid_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX payments_stripe_invoice_id_key
  ON public.payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX payments_stripe_checkout_session_id_key
  ON public.payments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
