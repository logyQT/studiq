import { AccountType } from '@studiq/authz';
import { StripePaymentGateway } from '@studiq/server/lib/payment/stripe-payment.gateway';
import { SupabaseStripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
import { createStripeClient } from '@studiq/server/lib/payment/stripe-client';
import { SupabaseStripeWebhookRepository } from '@studiq/server/lib/payment/stripe-webhook.repository';
import { EntitlementService } from '@studiq/server/services/entitlement.service';
import { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import { dbRows } from '@studiq/server/lib/supabase/rows';
// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import Stripe from 'stripe';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { asJson } from '#test/helpers/json';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import { createServiceClient } from '#test/integration/helpers';
import { requiredAt } from '#test/integration/test-utils';

/**
 * Opt-in verification of the real Stripe sandbox (#662).
 *
 * Not part of the default CI gate: it needs the network and a test-mode
 * secret. Run it after `scripts/stripe-bootstrap.ts`:
 *
 *   set -a; . ./.env; set +a
 *   RUN_STRIPE_TESTS=1 bunx vitest run __tests__/integration/stripe-sandbox.test.ts
 *
 * The catalog/price/portal checks are read-only. The checkout check creates a
 * hosted Checkout Session (never pays it), then expires the session and deletes
 * the test customer/mapping again. The future subscription-lifecycle suite
 * (test clocks, renewals, dunning) will live next to it behind the same flag.
 */
const requested = process.env.RUN_STRIPE_TESTS === '1';
if (requested && !process.env.STRIPE_SECRET_KEY) {
  throw new Error(
    'RUN_STRIPE_TESTS=1 requires STRIPE_SECRET_KEY (see docs/plans/662-stripe-integration.md §10.3)',
  );
}
const enabled = requested && Boolean(process.env.STRIPE_SECRET_KEY);

const API_VERSION = '2026-10-28.endive';
const SANDBOX_PASSWORD = 'StripeSandbox662!';

type PaidPlan = {
  key: string;
  price_monthly: number;
  currency: string;
};

/** The catalog read filters `price_monthly > 0`, so a paid plan always carries one. */
function isPaidPlan(plan: {
  key: string;
  price_monthly: number | null;
  currency: string;
}): plan is PaidPlan {
  return plan.price_monthly !== null;
}

describe.skipIf(!enabled)('Stripe test-mode sandbox (#662)', () => {
  let stripe: Stripe;
  let service: ReturnType<typeof createServiceClient>;
  let plans: PaidPlan[];
  let products: Stripe.Product[];
  let monthlyPrices: Stripe.Price[];
  let portal: Stripe.BillingPortal.Configuration | undefined;
  // Dedicated per-run owner: the checkout check deletes billing rows, so it
  // must never touch the shared dev-seed student.
  let checkoutUser: TestUserFixture;

  beforeAll(async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY!;
    expect(/^(sk|rk)_test_/.test(secretKey)).toBe(true);

    stripe = new Stripe(secretKey, { apiVersion: API_VERSION });
    service = createServiceClient();
    checkoutUser = await createTestUser({ role: 'student', password: SANDBOX_PASSWORD });

    const { data, error } = await service
      .from('subscription_plans')
      .select('key, price_monthly, currency')
      .eq('is_active', true)
      .gt('price_monthly', 0)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`subscription_plans: ${error.message}`);
    plans = dbRows(data).filter(isPaidPlan);
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
  }, 30_000);

  afterAll(async () => {
    await service.from('payments').delete().eq('user_id', checkoutUser.id);
    await service.from('billing_subscriptions').delete().eq('user_id', checkoutUser.id);
    await service.from('billing_customers').delete().eq('user_id', checkoutUser.id);
    await service.auth.admin.deleteUser(checkoutUser.id).catch(() => {});
  });

  it('runs against a PL account that presents PLN in test mode', async () => {
    const account = await stripe.accounts.retrieve(null);
    expect(account.country).toBe('PL');
    expect(account.default_currency).toBe('pln');
  });

  it('has one Product per active paid plan, all in test mode', () => {
    const planProducts = products.filter((product) => product.metadata.studiq_plan_key);
    const productKeys = planProducts.map((product) => product.metadata.studiq_plan_key);

    expect(planProducts).toHaveLength(plans.length);
    expect(new Set(productKeys).size).toBe(productKeys.length);

    const byPlan = new Map(
      planProducts.map((product) => [product.metadata.studiq_plan_key, product]),
    );

    expect([...byPlan.keys()].toSorted()).toEqual(plans.map((plan) => plan.key).toSorted());
    expect(products.every((product) => !product.livemode)).toBe(true);

    // Managed Payments needs the product classification. The bootstrap refuses
    // a write run without it, so every product must carry the configured code.
    const expectedTaxCode = process.env.STRIPE_PRODUCT_TAX_CODE?.trim();
    if (expectedTaxCode) {
      expect([...byPlan.values()].every((product) => product.tax_code === expectedTaxCode)).toBe(
        true,
      );
    }
  });

  it('has one monthly PLN Price per plan with a unique lookup key', () => {
    const byPlan = new Map(
      products
        .filter((product) => product.metadata.studiq_plan_key)
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
      // Operator decision: displayed PLN prices are tax-inclusive. Managed
      // Payments uses the Price's tax_behavior.
      expect(price!.tax_behavior).toBe('inclusive');
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

    const rows = dbRows(data);
    expect(rows.map((row) => row.plan_key).toSorted()).toEqual(
      plans.map((plan) => plan.key).toSorted(),
    );

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
    expect(portal!.features.payment_method_update.enabled).toBe(true);
    expect(portal!.features.invoice_history.enabled).toBe(true);
    expect(portal!.features.subscription_cancel.enabled).toBe(true);
    expect(portal!.features.subscription_cancel.mode).toBe('at_period_end');
    // Managed Payments is the merchant of record and owns tax IDs; the portal
    // no longer collects them.
    expect(portal!.features.customer_update.allowed_updates).not.toContain('tax_id');
    // Plan switching is an app endpoint (#662 X5), not a portal action.
    expect(portal!.features.subscription_update.enabled).not.toBe(true);
  });

  it('creates a real test-mode Checkout Session for a mapped Price', async () => {
    const studentId = checkoutUser.id;
    const plan = requiredAt(plans, 0, 'paid plan');

    // A crashed earlier run or a manual sandbox purchase must not turn this
    // check into a CONFLICT or reuse a deleted customer.
    await service.from('billing_subscriptions').delete().eq('user_id', studentId);
    await service.from('billing_customers').delete().eq('user_id', studentId);

    const { data: priceRow, error: priceError } = await service
      .from('stripe_prices')
      .select('stripe_price_id, unit_amount, currency')
      .eq('plan_key', plan.key)
      .eq('billing_cycle', 'monthly')
      .eq('livemode', false)
      .eq('active', true)
      .single();
    if (priceError) {
      throw new Error(`stripe_prices for ${plan.key}: ${priceError.message}`);
    }

    const gateway = new StripePaymentGateway({
      client: createStripeClient(process.env.STRIPE_SECRET_KEY!),
      config: {
        secretKey: process.env.STRIPE_SECRET_KEY!,
        // Checkout never verifies a webhook, but the config shape is boot-validated.
        webhookSecret: 'whsec_sandbox_checkout_only',
        portalConfigurationId: process.env.STRIPE_PORTAL_CONFIGURATION_ID!,
        livemode: false,
      },
      repository: new SupabaseStripeBillingRepository(() => service),
      siteUrl: () => 'https://studiq.test',
    });

    let sessionId: string | undefined;
    let customerId: string | undefined;

    try {
      const result = await gateway.createCheckoutSession({
        owner: { type: 'user', userId: studentId, accountType: AccountType.STUDENT },
        planKey: plan.key,
        planName: plan.key,
        amount: plan.price_monthly,
        currency: plan.currency,
        billingCycle: 'monthly',
        priceId: priceRow.stripe_price_id,
        locale: 'pl',
        idempotencyKey: `sandbox-checkout-${Date.now()}`,
      });

      expect(result.success, JSON.stringify(result)).toBe(true);
      if (!result.success) throw new Error('checkout session was not created');

      sessionId = result.data.sessionId;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      expect(session.mode).toBe('subscription');
      expect(session.amount_total).toBe(plan.price_monthly);
      expect(session.currency).toBe('pln');
      expect(session.client_reference_id).toBe(studentId);
      expect(session.metadata?.studiq_plan_key).toBe(plan.key);
      expect(session.metadata?.studiq_owner_type).toBe('user');
      // Managed Payments is the merchant of record and owns tax; the session
      // must not also enable automatic tax.
      expect(session.managed_payments?.enabled).toBe(true);
      expect(session.automatic_tax.enabled).not.toBe(true);

      customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      expect(customerId).toMatch(/^cus_/);
    } finally {
      if (sessionId) {
        await stripe.checkout.sessions.expire(sessionId).catch(() => {});
      }
      if (customerId) {
        await stripe.customers.del(customerId).catch(() => {});
      }
      await service.from('billing_subscriptions').delete().eq('user_id', studentId);
      await service.from('billing_customers').delete().eq('user_id', studentId);
    }
  });
});

/**
 * Opt-in subscription lifecycle through real test clocks (#662 §10.3).
 *
 * Every case creates one clock, one customer and one subscription, advances at
 * most two service periods, replays the resulting Stripe events through the
 * **real** signed webhook path, and deletes the clock again. Limits from §8.5:
 * max 3 customers / 3 subscriptions per clock.
 *
 * This suite is network- and sandbox-dependent; it is skipped without
 * `RUN_STRIPE_TESTS=1` and must never run on fork PRs.
 */
const LIFECYCLE_WEBHOOK_SECRET = 'whsec_stripe_lifecycle_test';
const LIFECYCLE_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function eventSubscriptionId(event: Stripe.Event): string | null {
  if (event.type.startsWith('customer.subscription.')) {
    return asJson<Stripe.Subscription>(event.data.object).id;
  }
  if (event.type.startsWith('invoice.')) {
    const invoice = asJson<Stripe.Invoice>(event.data.object);
    const parent = invoice.parent?.subscription_details?.subscription;
    if (typeof parent === 'string') return parent;
    if (parent) return parent.id;

    // The sandbox account may still emit the pre-2025 payload shape.
    const legacy = asJson<{ subscription?: string | { id: string } | null }>(invoice).subscription;
    if (typeof legacy === 'string') return legacy;
    if (legacy) return legacy.id;

    for (const line of dbRows(invoice.lines.data)) {
      const subscription = line.parent?.subscription_item_details?.subscription;
      if (typeof subscription === 'string') return subscription;
      const lineLegacy = asJson<{ subscription?: string | null }>(line).subscription;
      if (typeof lineLegacy === 'string') return lineLegacy;
    }
  }
  return null;
}

describe.skipIf(!enabled)('Stripe subscription lifecycle with test clocks (#662 §10.3)', () => {
  // A dedicated owner per suite: lifecycle cleanup resets payments,
  // subscriptions, customers and the plan, so it must never touch the shared
  // dev-seed student.
  let userId: string;
  let lifecycleUser: TestUserFixture;
  // Unique per run: makes clock names, customer emails and idempotency keys
  // replay-safe even if a previous clock was leaked.
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  type LifecyclePlan = { key: string; priceId: string; amount: number };

  // Constructed in `beforeAll`, not in the suite body: `describe.skipIf` still
  // runs the body to collect tests, and `new Stripe(undefined)` would fail the
  // default integration run without Stripe env.
  let stripe: Stripe;
  let service: ReturnType<typeof createServiceClient>;
  let webhookService: StripeWebhookService;
  let gateway: StripePaymentGateway;
  let plans: LifecyclePlan[];
  let firstPlan: LifecyclePlan;
  let lastPlan: LifecyclePlan;

  beforeAll(async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY!;
    expect(/^(sk|rk)_test_/.test(secretKey)).toBe(true);

    service = createServiceClient();
    stripe = new Stripe(secretKey, { apiVersion: API_VERSION });
    lifecycleUser = await createTestUser({ role: 'student', password: SANDBOX_PASSWORD });
    userId = lifecycleUser.id;
    webhookService = new StripeWebhookService({
      client: createStripeClient(secretKey),
      webhookSecret: LIFECYCLE_WEBHOOK_SECRET,
      livemode: false,
      repository: new SupabaseStripeWebhookRepository(() => service),
      entitlements: new EntitlementService(() => service),
    });
    gateway = new StripePaymentGateway({
      client: createStripeClient(secretKey),
      config: {
        secretKey,
        webhookSecret: LIFECYCLE_WEBHOOK_SECRET,
        portalConfigurationId: process.env.STRIPE_PORTAL_CONFIGURATION_ID ?? 'bpc_lifecycle_test',
        livemode: false,
      },
      repository: new SupabaseStripeBillingRepository(() => service),
      siteUrl: () => 'https://studiq.test',
    });

    const { data, error } = await service
      .from('subscription_plans')
      .select('key, price_monthly')
      .eq('is_active', true)
      .gt('price_monthly', 0)
      .eq('for_account_type', 'student')
      .order('price_monthly', { ascending: true });
    if (error) throw new Error(`subscription_plans: ${error.message}`);

    plans = [];
    for (const plan of dbRows(data)) {
      const { data: price, error: priceError } = await service
        .from('stripe_prices')
        .select('stripe_price_id')
        .eq('plan_key', plan.key)
        .eq('billing_cycle', 'monthly')
        .eq('livemode', false)
        .eq('active', true)
        .maybeSingle();
      if (priceError) throw new Error(`stripe_prices for ${plan.key}: ${priceError.message}`);
      if (price) {
        plans.push({
          key: plan.key,
          priceId: price.stripe_price_id,
          amount: plan.price_monthly ?? 0,
        });
      }
    }

    if (plans.length < 2) {
      throw new Error(
        'lifecycle tests need at least two mapped student plans; run scripts/stripe-bootstrap.ts',
      );
    }
    firstPlan = requiredAt(plans, 0, 'first mapped plan');
    lastPlan = requiredAt(plans, plans.length - 1, 'last mapped plan');
  }, 30_000);

  afterAll(async () => {
    await resetBilling();
    await service.auth.admin.deleteUser(lifecycleUser.id).catch(() => {});
  });

  function metadata(planKey: string) {
    return {
      studiq_owner_type: 'user',
      studiq_user_id: userId,
      studiq_org_id: '',
      studiq_plan_key: planKey,
      studiq_billing_cycle: 'monthly',
      studiq_livemode: 'false',
    };
  }

  async function resetBilling() {
    await service.from('payments').delete().eq('user_id', userId);
    await service.from('billing_subscriptions').delete().eq('user_id', userId);
    await service.from('billing_customers').delete().eq('user_id', userId);
    await service.from('profiles').update({ personal_plan_key: 'base' }).eq('id', userId);
  }

  async function profilePlan(): Promise<string | null> {
    const { data, error } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', userId)
      .single();
    if (error) throw new Error(error.message);
    return data.personal_plan_key;
  }

  async function mirrorRow(stripeSubscriptionId: string) {
    const { data, error } = await service
      .from('billing_subscriptions')
      .select('plan_key, status, pending_plan_key, current_period_end')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function paymentRows() {
    const { data, error } = await service
      .from('payments')
      .select('stripe_invoice_id, amount, provider')
      .eq('user_id', userId)
      .order('paid_at', { ascending: true });
    if (error) throw new Error(error.message);
    return dbRows(data);
  }

  async function createFixture(plan: LifecyclePlan) {
    const frozenTime = Math.floor(Date.now() / 1000);
    const since = frozenTime - 60;
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: frozenTime,
      name: `studiq-lifecycle-${plan.key}-${tag}`,
    });

    try {
      const customer = await stripe.customers.create({
        email: `stripe-lifecycle-${tag}@example.test`,
        test_clock: clock.id,
        payment_method: 'pm_card_visa',
        invoice_settings: { default_payment_method: 'pm_card_visa' },
        metadata: { studiq_owner_type: 'user', studiq_user_id: userId },
      });

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: plan.priceId, quantity: 1 }],
        metadata: metadata(plan.key),
        // The upgrade anchor reset (D5) is only legal in classic mode.
        billing_mode: { type: 'classic' },
      });

      return { clock, customer, subscription, since };
    } catch (error) {
      // Never leak a clock/customer when the fixture cannot be completed.
      await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
      throw error;
    }
  }

  async function advanceClock(clockId: string, frozenTime: number) {
    await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: frozenTime });

    for (let attempt = 0; attempt < 90; attempt += 1) {
      const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
      if (clock.status === 'ready') return;
      await sleep(1_000);
    }
    throw new Error(`test clock ${clockId} did not become ready`);
  }

  /**
   * Query one Stripe `type` at a time: `events.list` is account-wide and
   * newest-first, so paging a single 1 000-event window on a busy sandbox can
   * drop the oldest events that create the mirror.
   */
  async function eventsFor(
    subscriptionId: string,
    since: number,
    types: readonly string[] = [...LIFECYCLE_EVENTS],
  ) {
    const lists = await Promise.all(
      types.map((type) =>
        stripe.events
          .list({ created: { gte: since }, type, limit: 100 })
          .autoPagingToArray({ limit: 500 }),
      ),
    );

    return lists
      .flat()
      .filter((event) => eventSubscriptionId(event) === subscriptionId)
      .toSorted((left, right) => left.created - right.created);
  }

  async function waitForPaidInvoices(subscriptionId: string, since: number, count: number) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const paid = new Set(
        (await eventsFor(subscriptionId, since, ['invoice.paid'])).map(
          (event) => asJson<Stripe.Invoice>(event.data.object).id,
        ),
      );
      if (paid.size >= count) return;
      await sleep(1_000);
    }
    throw new Error(`expected ${count} paid invoices for ${subscriptionId}`);
  }

  async function waitForEventType(subscriptionId: string, since: number, type: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const found = (await eventsFor(subscriptionId, since, [type])).length > 0;
      if (found) return;
      await sleep(1_000);
    }
    throw new Error(`expected ${type} for ${subscriptionId}`);
  }

  async function replay(subscriptionId: string, since: number) {
    const events = await eventsFor(subscriptionId, since);
    expect(events.length, `no lifecycle events for ${subscriptionId}`).toBeGreaterThan(0);

    for (const event of events) {
      const payload = JSON.stringify(event);
      const header = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: LIFECYCLE_WEBHOOK_SECRET,
      });
      const result = await webhookService.handle(payload, header);
      expect(result.success, `${event.type} ${event.id}`).toBe(true);
    }
  }

  async function cleanup(clockId: string) {
    await resetBilling();
    try {
      await stripe.testHelpers.testClocks.del(clockId);
    } catch (error) {
      // A leaked clock still counts against the sandbox budget; surface it.
      console.warn(`could not delete test clock ${clockId}`, error);
    }
  }

  it('renewal writes a second payments row and replay stays idempotent', async () => {
    await resetBilling();
    const fixture = await createFixture(firstPlan);

    try {
      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 1);
      await replay(fixture.subscription.id, fixture.since);

      expect(await profilePlan()).toBe(firstPlan.key);
      const firstPayment = await paymentRows();
      expect(firstPayment).toHaveLength(1);
      expect(firstPayment[0]).toMatchObject({
        amount: firstPlan.amount,
        provider: 'stripe',
      });

      await advanceClock(fixture.clock.id, fixture.since + 32 * 86_400 + 60);
      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 2);
      await replay(fixture.subscription.id, fixture.since);

      const payments = await paymentRows();
      expect(payments).toHaveLength(2);
      expect(new Set(payments.map((payment) => payment.stripe_invoice_id)).size).toBe(2);

      // Replaying every event again must not add a third row.
      await replay(fixture.subscription.id, fixture.since);
      expect(await paymentRows()).toHaveLength(2);

      // Force the handlers to re-run (a failed claim is retried) so the
      // `stripe_invoice_id` unique guard — not just the event table — is
      // exercised.
      const paidEvents = await eventsFor(fixture.subscription.id, fixture.since, ['invoice.paid']);
      const { error: resetError } = await service
        .from('stripe_webhook_events')
        .update({ status: 'failed' })
        .in(
          'id',
          paidEvents.map((event) => event.id),
        );
      if (resetError) throw new Error(resetError.message);
      await replay(fixture.subscription.id, fixture.since);
      expect(await paymentRows()).toHaveLength(2);
    } finally {
      await cleanup(fixture.clock.id);
    }
  }, 240_000);

  it('a failing renewal card marks the mirror past_due without changing the plan', async () => {
    await resetBilling();
    const fixture = await createFixture(firstPlan);

    try {
      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 1);
      await replay(fixture.subscription.id, fixture.since);
      expect(await profilePlan()).toBe(firstPlan.key);

      // Raw card-data APIs are disabled on the account; this Stripe test token
      // maps to 4000 0000 0000 0341 (attaches, fails the renewal charge).
      const failingCard = await stripe.paymentMethods.create({
        type: 'card',
        card: { token: 'tok_chargeCustomerFail' },
      });
      await stripe.paymentMethods.attach(failingCard.id, { customer: fixture.customer.id });
      await stripe.customers.update(fixture.customer.id, {
        invoice_settings: { default_payment_method: failingCard.id },
      });

      await advanceClock(fixture.clock.id, fixture.since + 32 * 86_400 + 60);
      await waitForEventType(fixture.subscription.id, fixture.since, 'invoice.payment_failed');
      await replay(fixture.subscription.id, fixture.since);

      expect(await profilePlan()).toBe(firstPlan.key);
      expect((await mirrorRow(fixture.subscription.id)).status).toBe('past_due');
      // The failed renewal never writes a payments row.
      expect(await paymentRows()).toHaveLength(1);
    } finally {
      await cleanup(fixture.clock.id);
    }
  }, 240_000);

  it('cancel at period end deletes the subscription and downgrades to free', async () => {
    await resetBilling();
    const fixture = await createFixture(firstPlan);

    try {
      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 1);
      await replay(fixture.subscription.id, fixture.since);
      expect(await profilePlan()).toBe(firstPlan.key);

      await stripe.subscriptions.update(fixture.subscription.id, {
        cancel_at_period_end: true,
      });
      await advanceClock(fixture.clock.id, fixture.since + 32 * 86_400 + 60);
      await waitForEventType(
        fixture.subscription.id,
        fixture.since,
        'customer.subscription.deleted',
      );
      await replay(fixture.subscription.id, fixture.since);

      expect(await profilePlan()).toBe('base');
      expect((await mirrorRow(fixture.subscription.id)).status).toBe('canceled');
    } finally {
      await cleanup(fixture.clock.id);
    }
  }, 240_000);

  it('upgrade resets the billing anchor and applies the target plan', async () => {
    await resetBilling();
    const from = firstPlan;
    const to = lastPlan;
    const fixture = await createFixture(from);

    try {
      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 1);
      await replay(fixture.subscription.id, fixture.since);
      expect(await profilePlan()).toBe(from.key);

      const before = await stripe.subscriptions.retrieve(fixture.subscription.id);
      const beforeStart = before.items.data[0]?.current_period_start;
      const beforeInvoice =
        typeof before.latest_invoice === 'string'
          ? before.latest_invoice
          : before.latest_invoice?.id;
      if (typeof beforeStart !== 'number') throw new Error('missing initial period start');

      // Move partway through the cycle so a successful anchor reset is visible.
      await advanceClock(fixture.clock.id, fixture.since + 5 * 86_400);

      const result = await gateway.changePlan({
        owner: { type: 'user', userId, accountType: AccountType.STUDENT },
        customerId: fixture.customer.id,
        subscriptionId: fixture.subscription.id,
        currentPlanKey: from.key,
        targetPlanKey: to.key,
        targetPriceId: to.priceId,
        direction: 'upgrade',
        idempotencyKey: `lifecycle-upgrade-${tag}-${Date.now()}`,
      });
      expect(result.success, JSON.stringify(result)).toBe(true);
      if (!result.success) throw new Error('upgrade was not applied');
      expect(result.data.status).toBe('applied');

      const after = await stripe.subscriptions.retrieve(fixture.subscription.id);
      const afterStart = after.items.data[0]?.current_period_start;
      const afterInvoice =
        typeof after.latest_invoice === 'string' ? after.latest_invoice : after.latest_invoice?.id;

      expect(after.items.data[0]?.price.id).toBe(to.priceId);
      if (typeof afterStart !== 'number') throw new Error('missing reset period start');
      expect(afterStart).toBeGreaterThan(beforeStart);
      // A new invoice (unused-time credit + full new period) must exist; the
      // previous one is not proof. The exact credit is checked manually in the
      // sandbox run (§10.4).
      expect(afterInvoice).toBeTruthy();
      expect(afterInvoice).not.toBe(beforeInvoice);

      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 2);
      await replay(fixture.subscription.id, fixture.since);

      expect(await profilePlan()).toBe(to.key);
      expect((await mirrorRow(fixture.subscription.id)).plan_key).toBe(to.key);
    } finally {
      await cleanup(fixture.clock.id);
    }
  }, 240_000);

  it('downgrade applies at the period boundary, not immediately', async () => {
    await resetBilling();
    const from = lastPlan;
    const to = firstPlan;
    const fixture = await createFixture(from);

    try {
      await waitForPaidInvoices(fixture.subscription.id, fixture.since, 1);
      await replay(fixture.subscription.id, fixture.since);
      expect(await profilePlan()).toBe(from.key);

      const result = await gateway.changePlan({
        owner: { type: 'user', userId, accountType: AccountType.STUDENT },
        customerId: fixture.customer.id,
        subscriptionId: fixture.subscription.id,
        currentPlanKey: from.key,
        targetPlanKey: to.key,
        targetPriceId: to.priceId,
        direction: 'downgrade',
        idempotencyKey: `lifecycle-downgrade-${tag}-${Date.now()}`,
      });
      expect(result.success, JSON.stringify(result)).toBe(true);
      if (!result.success) throw new Error('downgrade was not scheduled');
      expect(result.data.status).toBe('scheduled');

      // The plan must not move before the phase boundary — neither locally nor
      // on the live subscription.
      expect(await profilePlan()).toBe(from.key);
      const scheduled = await stripe.subscriptions.retrieve(fixture.subscription.id);
      expect(scheduled.schedule).toBeTruthy();
      expect(scheduled.items.data[0]?.price.id).toBe(from.priceId);
      expect(scheduled.pending_update ?? null).toBeNull();
      const periodEnd = scheduled.items.data[0]?.current_period_end;
      if (typeof periodEnd !== 'number') throw new Error('missing downgrade period end');

      await advanceClock(fixture.clock.id, periodEnd + 60);

      // The phase boundary changes the live price; an invoice for the new
      // period may lag it by a few seconds, so assert the plan transition (the
      // contract) and then replay whatever events Stripe has produced.
      let livePriceId = scheduled.items.data[0]?.price.id;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const live = await stripe.subscriptions.retrieve(fixture.subscription.id);
        livePriceId = live.items.data[0]?.price.id;
        if (livePriceId === to.priceId) break;
        await sleep(1_000);
      }
      expect(livePriceId).toBe(to.priceId);

      await replay(fixture.subscription.id, fixture.since);

      expect(await profilePlan()).toBe(to.key);
      expect((await mirrorRow(fixture.subscription.id)).plan_key).toBe(to.key);
    } finally {
      await cleanup(fixture.clock.id);
    }
  }, 240_000);
});
