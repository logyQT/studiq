-- ==========================================
-- TABLES: billing_customers, billing_subscriptions,
--         stripe_prices, stripe_webhook_events
-- Stripe mapping and idempotency substrate for #662.
--
-- The entitlement source of truth stays `profiles.personal_plan_key` and
-- `organizations.plan` (+ apply_org_plan); these tables only mirror the
-- provider lifecycle and map customers/prices.
--
-- RLS/grants live in
-- 20261030130000_billing_customers_and_subscriptions.sql and
-- 20261030130100_stripe_prices_and_webhook_events.sql.
-- Depends on: 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.billing_customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  livemode           boolean NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_customers_one_owner
    CHECK ((user_id IS NULL) <> (organization_id IS NULL))
);

CREATE UNIQUE INDEX billing_customers_user_livemode_key
  ON public.billing_customers (user_id, livemode)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX billing_customers_organization_livemode_key
  ON public.billing_customers (organization_id, livemode)
  WHERE organization_id IS NOT NULL;

CREATE TABLE public.billing_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_subscription_id text NOT NULL UNIQUE,
  billing_customer_id    uuid NOT NULL
                           REFERENCES public.billing_customers(id) ON DELETE CASCADE,
  user_id                uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchaser_user_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  checkout_session_id    text,
  plan_key               text NOT NULL,
  price_id               text NOT NULL,
  billing_cycle          text NOT NULL DEFAULT 'monthly'
                           CHECK (billing_cycle IN ('monthly', 'yearly')),
  status                 text NOT NULL CHECK (status IN (
                           'active', 'trialing', 'past_due', 'unpaid', 'canceled',
                           'incomplete', 'incomplete_expired', 'paused')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  cancel_at              timestamptz,
  canceled_at            timestamptz,
  pending_plan_key       text,
  last_event_created     bigint NOT NULL DEFAULT 0,
  livemode               boolean NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_one_owner
    CHECK ((user_id IS NULL) <> (organization_id IS NULL))
);

CREATE UNIQUE INDEX billing_subscriptions_one_active_organization
  ON public.billing_subscriptions (organization_id, livemode)
  WHERE organization_id IS NOT NULL
    AND status IN ('active', 'trialing', 'past_due');

CREATE UNIQUE INDEX billing_subscriptions_one_active_user
  ON public.billing_subscriptions (user_id, livemode)
  WHERE user_id IS NOT NULL
    AND status IN ('active', 'trialing', 'past_due');

CREATE UNIQUE INDEX billing_subscriptions_checkout_session_key
  ON public.billing_subscriptions (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE INDEX billing_subscriptions_owner_idx
  ON public.billing_subscriptions (organization_id, user_id);

CREATE INDEX billing_subscriptions_customer_idx
  ON public.billing_subscriptions (billing_customer_id);

CREATE TRIGGER set_billing_subscriptions_updated_at
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
