-- ==========================================
-- Issue #662: Stripe Price mapping and webhook idempotency.
--
-- `stripe_prices` maps a catalog plan + cycle + Stripe mode to the Price id
-- created by `scripts/stripe-bootstrap.ts`. Checkout resolves the Price from
-- here and validates its amount/currency/interval against the catalog, so a
-- client can never supply an amount and a Dashboard edit cannot silently
-- overcharge.
--
-- `stripe_webhook_events` is the idempotency ledger. The event row is inserted
-- before any side effect; a duplicate `evt_…` returns 200 without re-running
-- the handler. Status transitions: processing → processed | ignored | failed.
-- No payload is stored (it contains customer PII); only ids/type/status/error.
--
-- Both tables are service-role only: price ids are environment-specific and
-- event rows are not client data.
-- ==========================================

CREATE TABLE public.stripe_prices (
  plan_key        text NOT NULL,
  billing_cycle   text NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  stripe_price_id text NOT NULL UNIQUE,
  currency        text NOT NULL,
  unit_amount     int NOT NULL CHECK (unit_amount >= 0),
  interval        text NOT NULL,
  livemode        boolean NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_key, billing_cycle, livemode)
);

CREATE TABLE public.stripe_webhook_events (
  id            text PRIMARY KEY,
  type          text NOT NULL,
  api_version   text,
  livemode      boolean NOT NULL,
  event_created bigint NOT NULL,
  status        text NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  error         text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

CREATE INDEX stripe_webhook_events_received_idx
  ON public.stripe_webhook_events (received_at DESC);

CREATE INDEX stripe_webhook_events_status_idx
  ON public.stripe_webhook_events (status)
  WHERE status = 'failed';

ALTER TABLE public.stripe_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stripe_prices FROM anon, authenticated;
GRANT ALL ON public.stripe_prices TO service_role;

REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;
