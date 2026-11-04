#!/usr/bin/env bun
/**
 * Production payment preflight (#662 workstream E).
 *
 * Read-only. Verifies, without printing key material:
 * - the key prefix/mode, webhook secret presence and site URL match the posture
 *   (through the factory);
 * - the Billing Portal configuration exists in the key's mode and is active;
 * - every active paid catalog plan has an active monthly mapping whose amount
 *   and currency match, in the key's mode;
 * - production (or any live key) has no active test-mode mapping.
 *
 * Exit 1 on any issue, so a deploy step can gate on it. It does not create
 * Checkout Sessions or write anything. `--allow-mock` is required to treat the
 * mock driver as a smoke-test pass; a real deploy must see `provider=stripe`.
 */
// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import Stripe from 'stripe';
import { isProductionEnv } from '@studiq/server/lib/app-env';
import { STRIPE_API_VERSION } from '@studiq/server/lib/payment/stripe-client';
import { createPaymentGatewayFromEnv } from '@studiq/server/lib/payment/payment-gateway.factory';
import {
  type PreflightPlan,
  type PreflightPriceRow,
  validatePortalConfiguration,
  validatePriceMap,
} from '@studiq/server/lib/payment/stripe-preflight';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

/** Never echo a key-shaped fragment from an SDK/network error. */
function scrub(message: string): string {
  return message.replace(/\b(?:sk|rk|whsec|bpc)_[A-Za-z0-9_*-]+/g, '[redacted]');
}

function fail(message: string): never {
  throw new PreflightError(message);
}

async function main(): Promise<void> {
  const allowMock = process.argv.includes('--allow-mock');

  // Validates APP_ENV, the driver, the key, the webhook secret, the portal id
  // and the production site URL. No secret is printed.
  const gateway = createPaymentGatewayFromEnv();

  if (gateway.driver === 'mock') {
    if (!allowMock) {
      fail(
        'the mock driver is not a deploy-ready payment posture; pass --allow-mock only for a local smoke test',
      );
    }
    console.log('[stripe-preflight] provider=mock (--allow-mock); no Stripe checks');
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const portalConfigurationId = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  if (!secretKey || !portalConfigurationId) {
    fail('STRIPE_SECRET_KEY and STRIPE_PORTAL_CONFIGURATION_ID are required');
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  // 1. Portal configuration.
  let portal: Stripe.BillingPortal.Configuration;
  try {
    portal = await stripe.billingPortal.configurations.retrieve(portalConfigurationId);
  } catch (error) {
    fail(
      `could not read the Billing Portal configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const portalIssues = validatePortalConfiguration(portal, gateway.livemode);
  if (portalIssues.length > 0) fail(portalIssues.join('\n'));

  // 2. Catalog ↔ price map.
  const supabase = createServiceClient();
  const [planResult, priceResult] = await Promise.all([
    supabase
      .from('subscription_plans')
      .select('key, price_monthly, currency, is_active')
      .eq('is_active', true),
    supabase
      .from('stripe_prices')
      .select(
        'plan_key, billing_cycle, stripe_price_id, currency, unit_amount, interval, livemode, active',
      ),
  ]);

  if (planResult.error) fail(`could not read subscription_plans: ${planResult.error.message}`);
  if (priceResult.error) fail(`could not read stripe_prices: ${priceResult.error.message}`);

  const plans: PreflightPlan[] = (planResult.data ?? []).map((plan) => ({
    key: plan.key,
    priceMonthly: plan.price_monthly ?? 0,
    currency: plan.currency ?? '',
    isActive: plan.is_active ?? true,
  }));
  const rows: PreflightPriceRow[] = (priceResult.data ?? []).map((row) => ({
    planKey: row.plan_key,
    billingCycle: row.billing_cycle,
    stripePriceId: row.stripe_price_id,
    currency: row.currency,
    unitAmount: row.unit_amount,
    interval: row.interval,
    livemode: row.livemode,
    active: row.active,
  }));

  const issues = validatePriceMap({
    plans,
    rows,
    livemode: gateway.livemode,
    // A live key outside production (the explicit smoke-test hatch) is still
    // treated strictly for "no active test rows".
    production: isProductionEnv() || gateway.livemode,
  });
  if (issues.length > 0) fail(issues.join('\n'));

  const paid = plans.filter((plan) => plan.priceMonthly > 0).length;
  console.log(
    `[stripe-preflight] ok: provider=stripe livemode=${gateway.livemode} portal=active plans=${paid} mappings=${rows.filter((row) => row.active).length}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[stripe-preflight] ${scrub(message)}`);
  process.exitCode = 1;
});
