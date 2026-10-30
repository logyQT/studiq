import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

/**
 * Opt-in verification of the real Stripe sandbox (#662).
 *
 * Not part of the default CI gate: it needs the network and a test-mode
 * secret. Run it after `scripts/stripe-bootstrap.ts`:
 *
 *   set -a; . ./.env; set +a
 *   RUN_STRIPE_TESTS=1 bunx vitest run __tests__/integration/stripe-sandbox.test.ts
 *
 * Read-only: it never creates or mutates Stripe objects, so it is safe to
 * re-run. The future subscription-lifecycle suite (test clocks, renewals,
 * dunning) will live next to it behind the same flag.
 */
const requested = process.env.RUN_STRIPE_TESTS === '1';
if (requested && !process.env.STRIPE_SECRET_KEY) {
  throw new Error(
    'RUN_STRIPE_TESTS=1 requires STRIPE_SECRET_KEY (see docs/plans/662-stripe-integration.md §10.3)',
  );
}
const enabled = requested && Boolean(process.env.STRIPE_SECRET_KEY);

const API_VERSION = '2026-10-28.endive';

type PaidPlan = {
  key: string;
  price_monthly: number;
  currency: string;
};

describe.skipIf(!enabled)('Stripe test-mode sandbox (#662)', () => {
  let stripe: Stripe;
  let service: ReturnType<typeof createServiceClient>;
  let plans: PaidPlan[];
  let products: Stripe.Product[];
  let monthlyPrices: Stripe.Price[];
  let portal: Stripe.BillingPortal.Configuration | undefined;

  beforeAll(async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY!;
    expect(secretKey.startsWith('sk_test_')).toBe(true);

    stripe = new Stripe(secretKey, { apiVersion: API_VERSION });
    service = createServiceClient();

    const { data, error } = await service
      .from('subscription_plans')
      .select('key, price_monthly, currency')
      .eq('is_active', true)
      .gt('price_monthly', 0)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`subscription_plans: ${error.message}`);
    plans = (data ?? []) as PaidPlan[];
    expect(plans.length).toBeGreaterThan(0);

    products = await stripe.products
      .list({ limit: 100, active: true })
      .autoPagingToArray({ limit: 10_000 });
    monthlyPrices = (
      await stripe.prices.list({ limit: 100, active: true }).autoPagingToArray({ limit: 10_000 })
    ).filter(
      (price) =>
        price.type === 'recurring' &&
        price.recurring?.interval === 'month' &&
        price.lookup_key?.startsWith('studiq_'),
    );

    const portalId = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
    if (!portalId) {
      throw new Error(
        'STRIPE_PORTAL_CONFIGURATION_ID is required to verify the portal; run scripts/stripe-bootstrap.ts',
      );
    }
    portal = await stripe.billingPortal.configurations.retrieve(portalId);
  });

  it('runs against a PL account that presents PLN in test mode', async () => {
    const account = await stripe.accounts.retrieve();
    expect(account.country).toBe('PL');
    expect(account.default_currency).toBe('pln');
  });

  it('has one Product per active paid plan, all in test mode', () => {
    const planProducts = products.filter((product) => product.metadata?.studiq_plan_key);
    const productKeys = planProducts.map((product) => product.metadata.studiq_plan_key as string);

    expect(planProducts).toHaveLength(plans.length);
    expect(new Set(productKeys).size).toBe(productKeys.length);

    const byPlan = new Map(
      planProducts.map((product) => [product.metadata.studiq_plan_key as string, product]),
    );

    expect([...byPlan.keys()].sort()).toEqual(plans.map((plan) => plan.key).sort());
    expect(products.every((product) => !product.livemode)).toBe(true);
  });

  it('has one monthly PLN Price per plan with a unique lookup key', () => {
    const byPlan = new Map(
      products
        .filter((product) => product.metadata?.studiq_plan_key)
        .map((product) => [product.metadata.studiq_plan_key, product]),
    );

    const lookupKeys = monthlyPrices.map((price) => price.lookup_key);
    expect(new Set(lookupKeys).size).toBe(lookupKeys.length);

    for (const plan of plans) {
      expect(plan.currency).toBe('PLN');
      const price = monthlyPrices.find(
        (candidate) => candidate.lookup_key === `studiq_${plan.key}_monthly`,
      );
      expect(price, `missing price for ${plan.key}`).toBeDefined();
      expect(price!.currency).toBe('pln');
      expect(price!.unit_amount).toBe(plan.price_monthly);
      expect(price!.recurring?.interval).toBe('month');
      expect(price!.recurring?.interval_count).toBe(1);
      expect(price!.product).toBe(byPlan.get(plan.key)?.id);
      expect(price!.livemode).toBe(false);
    }
  });

  it('mirrors the Stripe Prices in stripe_prices', async () => {
    const { data, error } = await service
      .from('stripe_prices')
      .select('plan_key, billing_cycle, stripe_price_id, currency, unit_amount, active, livemode')
      .eq('livemode', false)
      .eq('active', true);
    if (error) throw new Error(`stripe_prices: ${error.message}`);

    const rows = data ?? [];
    expect(rows.map((row) => row.plan_key).sort()).toEqual(plans.map((plan) => plan.key).sort());

    for (const row of rows) {
      const price = monthlyPrices.find((candidate) => candidate.id === row.stripe_price_id);
      expect(price, `stripe_prices points at an unknown price for ${row.plan_key}`).toBeDefined();
      expect(row.billing_cycle).toBe('monthly');
      expect(row.currency).toBe('PLN');
      expect(row.unit_amount).toBe(price!.unit_amount);
      expect(price!.lookup_key).toBe(`studiq_${row.plan_key}_monthly`);
    }
  });

  it('has a portal configuration for the supported actions only', () => {
    expect(portal).toBeDefined();
    expect(portal!.active).toBe(true);
    expect(portal!.livemode).toBe(false);
    expect(portal!.features.payment_method_update?.enabled).toBe(true);
    expect(portal!.features.invoice_history?.enabled).toBe(true);
    expect(portal!.features.subscription_cancel?.enabled).toBe(true);
    expect(portal!.features.subscription_cancel?.mode).toBe('at_period_end');
    expect(portal!.features.customer_update?.allowed_updates).toContain('tax_id');
    // Plan switching is an app endpoint (#662 X5), not a portal action.
    expect(portal!.features.subscription_update?.enabled).not.toBe(true);
  });
});
