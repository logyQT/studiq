-- ==========================================
-- Issue #662: Stripe fields on the purchase log.
--
-- `payments` was written by the mock webhook and keyed by the client-generated
-- checkout session id. Real Stripe writes one row per paid invoice, including
-- renewals and upgrade invoices that have no checkout session, so:
--
--   * `session_id` becomes nullable (mock rows keep it as their idempotency
--     key; the existing UNIQUE constraint stays);
--   * `stripe_invoice_id` / `stripe_checkout_session_id` become the Stripe
--     idempotency keys (partial unique indexes);
--   * `provider` separates simulated history from real charges;
--   * `hosted_invoice_url` / `invoice_pdf_url` feed the "Faktura" link in
--     "Historia płatności";
--   * `status` leaves room for refunds/partial refunds.
--
-- `amount` stays integer minor units and is the amount actually paid
-- (`invoice.amount_paid`), not the catalog price: an upgrade invoice is the
-- full new period minus the unused-time credit.
--
-- The table stays append-only and service-role-writable; existing RLS/grants
-- from 20261025163152_payments.sql are unchanged.
-- ==========================================

ALTER TABLE public.payments ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN provider text NOT NULL DEFAULT 'mock'
    CHECK (provider IN ('mock', 'stripe')),
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN stripe_invoice_id text,
  ADD COLUMN stripe_checkout_session_id text,
  ADD COLUMN hosted_invoice_url text,
  ADD COLUMN invoice_pdf_url text,
  ADD COLUMN status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'refunded', 'partially_refunded'));

CREATE UNIQUE INDEX payments_stripe_invoice_id_key
  ON public.payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX payments_stripe_checkout_session_id_key
  ON public.payments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Every row must still be attributable to something: a mock session, a Stripe
-- invoice (renewals/upgrades) or a Stripe checkout session (first purchase).
ALTER TABLE public.payments
  ADD CONSTRAINT payments_has_external_ref
  CHECK (
    session_id IS NOT NULL
    OR stripe_invoice_id IS NOT NULL
    OR stripe_checkout_session_id IS NOT NULL
  );

CREATE INDEX idx_payments_org_paid_at
  ON public.payments (organization_id, paid_at DESC)
  WHERE organization_id IS NOT NULL;
