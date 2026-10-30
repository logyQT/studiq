-- ==========================================
-- Issue #662 (ROADMAP 6): real Stripe integration.
--
-- Customer and subscription mapping. `billing_customers` ties one Stripe
-- Customer to exactly one owner (a user or an organization) per Stripe mode;
-- `billing_subscriptions` is the local mirror of the subscription lifecycle
-- (status, period, cancel state) used by webhooks, the billing pages and the
-- portal.
--
-- Deliberate choices:
--   * A mapping table, not `stripe_customer_id` columns on profiles/orgs:
--     one owner needs a test customer and (later) a live customer, the owner
--     is polymorphic, and `profiles` writes are revoked for `authenticated`
--     (20261022000001_profiles_write_lockdown.sql).
--   * `billing_subscriptions.billing_customer_id` references the local row, so
--     the client-readable table does not expose the Stripe customer id.
--   * No FK on `plan_key`/`price_id`: `seeds/00_plans.sql` deletes and
--     re-inserts the plan catalog, and Stripe Price ids rotate. Historical
--     rows must survive both.
--   * Partial unique indexes enforce "one live subscription per owner and
--     mode". Canceled/unpaid/incomplete rows stay as history and do not block
--     a new subscription.
--   * The subscription mirror is NOT the entitlement source. Features/limits
--     still come from `profiles.personal_plan_key` and `organizations.plan`
--     (applied through `apply_org_plan`); this table only reflects Stripe.
--   * Writes are service-role only. `authenticated` gets own-row SELECT (plus
--     org-manager SELECT) so the billing pages can read status without
--     exposing customer ids or accepting client writes.
--
-- Depends on: 03_organizations.sql, 04_profiles.sql, 56_org_roles.sql.
-- ==========================================

CREATE TABLE public.billing_customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  livemode           boolean NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_customers_one_owner
    CHECK ((user_id IS NULL) <> (organization_id IS NULL)),
  -- Referenced by the owner/mode composite FKs on billing_subscriptions, so a
  -- subscription cannot pair one owner's customer with another owner or mode.
  CONSTRAINT billing_customers_user_mode_key UNIQUE (id, user_id, livemode),
  CONSTRAINT billing_customers_organization_mode_key UNIQUE (id, organization_id, livemode)
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
  billing_customer_id    uuid NOT NULL,
  user_id                uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The admin who bought the plan. Nullable: the profile may be purged while
  -- the organization subscription keeps billing. `payments` attribution falls
  -- back to a current org admin in that case.
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
  -- Downgrade scheduled through a subscription schedule; the webhook promotes
  -- it to plan_key when the phase changes.
  pending_plan_key       text,
  -- Last processed Stripe event timestamp (seconds). Out-of-order events with
  -- an older timestamp must not overwrite newer state.
  last_event_created     bigint NOT NULL DEFAULT 0,
  livemode               boolean NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_one_owner
    CHECK ((user_id IS NULL) <> (organization_id IS NULL)),
  -- MATCH SIMPLE: the user FK is skipped for an org row (user_id NULL) and the
  -- org FK is skipped for a personal row, so exactly one applies.
  CONSTRAINT billing_subscriptions_customer_user_fkey
    FOREIGN KEY (billing_customer_id, user_id, livemode)
    REFERENCES public.billing_customers (id, user_id, livemode)
    ON DELETE CASCADE,
  CONSTRAINT billing_subscriptions_customer_organization_fkey
    FOREIGN KEY (billing_customer_id, organization_id, livemode)
    REFERENCES public.billing_customers (id, organization_id, livemode)
    ON DELETE CASCADE
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

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;

-- A user sees their own subscription; an org manager sees the org's rows.
-- `rls_caller_is_org_manager` is the SECURITY DEFINER capability helper
-- (`member.manage`, system admin included) used by the other control-plane
-- tables. Mutations still re-check `isOrgAdminRole` in the service layer.
CREATE POLICY "Own or org-manager subscription read" ON public.billing_subscriptions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND public.rls_caller_is_org_manager(organization_id)
    )
  );

-- Customer ids must never reach a client: no grants, no policies.
REVOKE ALL ON public.billing_customers FROM anon, authenticated;
GRANT ALL ON public.billing_customers TO service_role;

REVOKE ALL ON public.billing_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.billing_subscriptions TO authenticated;
GRANT ALL ON public.billing_subscriptions TO service_role;
