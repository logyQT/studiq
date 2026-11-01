import { STRIPE_API_VERSION } from '@studiq/server/lib/payment/stripe-client';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import type { CatalogPlan, ListedPrice } from '@studiq/server/lib/payment/stripe-repository';
import type {
  PaymentRowInput,
  StripeWebhookRepository,
  SubscriptionMirror,
} from '@studiq/server/lib/payment/stripe-webhook.repository';
import { success } from '@studiq/server/lib/service-result';
import { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WEBHOOK_SECRET = 'whsec_test';
const CLAIM_TOKEN = '2026-11-01T09:00:00.000Z';
const NOW = new Date('2026-11-01T10:00:00.000Z');

const CATALOG: Record<string, CatalogPlan> = {
  spark: {
    key: 'spark',
    name: 'StudiQ Spark',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'student',
  },
  ace: {
    key: 'ace',
    name: 'StudiQ Ace',
    priceMonthly: 1999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'student',
  },
  hub: {
    key: 'hub',
    name: 'StudiQ Hub',
    priceMonthly: 9999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'manager',
  },
};

const PRICES: Record<string, ListedPrice> = {
  price_spark: {
    planKey: 'spark',
    stripePriceId: 'price_spark',
    currency: 'PLN',
    unitAmount: 999,
    interval: 'month',
    active: true,
  },
  price_ace: {
    planKey: 'ace',
    stripePriceId: 'price_ace',
    currency: 'PLN',
    unitAmount: 1999,
    interval: 'month',
    active: true,
  },
  price_hub: {
    planKey: 'hub',
    stripePriceId: 'price_hub',
    currency: 'PLN',
    unitAmount: 9999,
    interval: 'month',
    active: true,
  },
};

const USER_METADATA = {
  studiq_owner_type: 'user',
  studiq_user_id: 'u-1',
  studiq_org_id: '',
  studiq_plan_key: 'spark',
  studiq_billing_cycle: 'monthly',
  studiq_livemode: 'false',
};

const ORG_METADATA = {
  studiq_owner_type: 'org',
  studiq_user_id: 'u-admin',
  studiq_org_id: 'org-1',
  studiq_plan_key: 'hub',
  studiq_billing_cycle: 'monthly',
  studiq_livemode: 'false',
};

let eventCounter = 0;

function makeEvent(
  type: string,
  object: unknown,
  overrides: Partial<Stripe.Event> = {},
): Stripe.Event {
  eventCounter += 1;
  return {
    id: `evt_${eventCounter}`,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: 1_700_000_000,
    livemode: false,
    type,
    data: { object },
    ...overrides,
  } as unknown as Stripe.Event;
}

function makeSubscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    metadata: USER_METADATA,
    items: {
      data: [
        {
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
          price: { id: 'price_spark' },
        },
      ],
    },
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    livemode: false,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cs_1',
    object: 'checkout.session',
    customer: 'cus_1',
    subscription: 'sub_1',
    payment_status: 'paid',
    metadata: USER_METADATA,
    client_reference_id: 'u-1',
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'in_1',
    object: 'invoice',
    customer: 'cus_1',
    amount_paid: 999,
    currency: 'pln',
    parent: { subscription_details: { subscription: 'sub_1', metadata: USER_METADATA } },
    status_transitions: { paid_at: 1_700_000_100 },
    hosted_invoice_url: 'https://invoice.stripe.test/in_1',
    invoice_pdf: 'https://invoice.stripe.test/in_1.pdf',
    billing_reason: 'subscription_create',
    ...overrides,
  };
}

function makeMirror(overrides: Partial<SubscriptionMirror> = {}): SubscriptionMirror {
  return {
    id: 'bs_1',
    stripeSubscriptionId: 'sub_1',
    billingCustomerId: 'bc_1',
    userId: 'u-1',
    organizationId: null,
    purchaserUserId: 'u-1',
    checkoutSessionId: 'cs_1',
    planKey: 'spark',
    priceId: 'price_spark',
    status: 'active',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    lastEventCreated: 1_600_000_000,
    livemode: false,
    ...overrides,
  };
}

function createClient() {
  return {
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    prices: { retrieve: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  } as unknown as StripeClient;
}

type FakeRepository = StripeWebhookRepository & {
  invoices: Set<string>;
  payments: PaymentRowInput[];
};

function createRepository(): FakeRepository {
  const invoices = new Set<string>();
  const payments: PaymentRowInput[] = [];

  return {
    claimEvent: vi.fn().mockResolvedValue(success({ outcome: 'claimed', receivedAt: CLAIM_TOKEN })),
    finishEvent: vi.fn().mockResolvedValue(success(undefined)),
    getSubscriptionByStripeId: vi.fn().mockResolvedValue(success(null)),
    findCustomerByStripeId: vi.fn().mockResolvedValue(success(null)),
    ensureCustomer: vi.fn().mockImplementation((input) =>
      Promise.resolve(
        success({
          id: 'bc_1',
          stripeCustomerId: input.stripeCustomerId,
          userId: input.userId,
          organizationId: input.organizationId,
          livemode: input.livemode,
        }),
      ),
    ),
    upsertSubscription: vi.fn().mockResolvedValue(success('applied')),
    attachCheckoutSession: vi.fn().mockResolvedValue(success(undefined)),
    updateSubscriptionStatus: vi.fn().mockResolvedValue(success(undefined)),
    findActiveSubscription: vi.fn().mockResolvedValue(success(null)),
    isClaimOwner: vi.fn().mockResolvedValue(success(true)),
    getPlan: vi
      .fn()
      .mockImplementation((planKey: string) => Promise.resolve(success(CATALOG[planKey] ?? null))),
    findPrice: vi
      .fn()
      .mockImplementation((priceId: string) => Promise.resolve(success(PRICES[priceId] ?? null))),
    insertPayment: vi.fn().mockImplementation((row: PaymentRowInput) => {
      if (invoices.has(row.stripeInvoiceId)) return Promise.resolve(success('duplicate'));
      invoices.add(row.stripeInvoiceId);
      payments.push(row);
      return Promise.resolve(success('inserted'));
    }),
    findOldestOrgAdmin: vi.fn().mockResolvedValue(success(null)),
    invoices,
    payments,
  } as unknown as FakeRepository;
}

interface Harness {
  service: StripeWebhookService;
  client: StripeClient;
  repository: FakeRepository;
  entitlements: {
    applyPlan: ReturnType<typeof vi.fn>;
    downgradeToFree: ReturnType<typeof vi.fn>;
  };
}

function createHarness(options: { livemode?: boolean } = {}): Harness {
  const client = createClient();
  const repository = createRepository();
  const entitlements = {
    applyPlan: vi.fn().mockResolvedValue(success(undefined)),
    downgradeToFree: vi.fn().mockResolvedValue(success(undefined)),
  };

  const service = new StripeWebhookService({
    client,
    webhookSecret: WEBHOOK_SECRET,
    livemode: options.livemode ?? false,
    repository,
    entitlements,
    now: () => NOW,
  });

  return { service, client, repository, entitlements };
}

function sign(harness: Harness, event: Stripe.Event) {
  vi.mocked(harness.client.webhooks.constructEvent).mockReturnValue(event);
  return harness.service.handle('{"raw":"body"}', 't=1,v1=signature');
}

describe('StripeWebhookService', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    eventCounter = 0;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verification and idempotency', () => {
    it('rejects a missing signature without touching the database', async () => {
      const harness = createHarness();

      await expect(harness.service.handle('{}', null)).resolves.toEqual({
        success: false,
        error: 'BAD_REQUEST',
      });
      expect(harness.client.webhooks.constructEvent).not.toHaveBeenCalled();
      expect(harness.repository.claimEvent).not.toHaveBeenCalled();
    });

    it('rejects an invalid signature with 400 and no writes', async () => {
      const harness = createHarness();
      vi.mocked(harness.client.webhooks.constructEvent).mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      await expect(harness.service.handle('{}', 't=1,v1=bad')).resolves.toEqual({
        success: false,
        error: 'BAD_REQUEST',
      });
      expect(harness.repository.claimEvent).not.toHaveBeenCalled();
      expect(harness.repository.finishEvent).not.toHaveBeenCalled();
    });

    it('rejects an event from the other livemode', async () => {
      const harness = createHarness({ livemode: false });
      const event = makeEvent('invoice.paid', makeInvoice(), { livemode: true });
      vi.mocked(harness.client.webhooks.constructEvent).mockReturnValue(event);

      await expect(harness.service.handle('{}', 'sig')).resolves.toEqual({
        success: false,
        error: 'BAD_REQUEST',
      });
      expect(harness.repository.claimEvent).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('billing.webhook_livemode_mismatch'),
      );
    });

    it('returns duplicate without re-running the handler', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.claimEvent).mockResolvedValueOnce(
        success({ outcome: 'duplicate', receivedAt: null }),
      );
      const event = makeEvent('customer.subscription.updated', makeSubscription());

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, duplicate: true } });
      expect(harness.client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(harness.entitlements.downgradeToFree).not.toHaveBeenCalled();
    });

    it('marks a failed handler failed and returns a retryable error', async () => {
      const harness = createHarness();
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      vi.mocked(harness.repository.upsertSubscription).mockResolvedValueOnce({
        success: false,
        error: 'INTERNAL_SERVER',
      });
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_500,
      });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: false, error: 'INTERNAL_SERVER' });
      expect(harness.repository.finishEvent).toHaveBeenCalledWith(
        event.id,
        CLAIM_TOKEN,
        'failed',
        expect.any(String),
      );
    });

    it('records an API-version mismatch but still processes the event', async () => {
      const harness = createHarness();
      const event = makeEvent(
        'checkout.session.expired',
        { id: 'cs_1' },
        {
          api_version: '2020-01-01.old',
        },
      );

      await sign(harness, event);

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('billing.webhook_api_version_mismatch'),
      );
      expect(harness.repository.finishEvent).toHaveBeenCalledWith(event.id, CLAIM_TOKEN, 'ignored');
    });
  });

  describe('checkout.session.completed', () => {
    it('activates a personal plan exactly once and writes no payments row', async () => {
      const harness = createHarness();
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent('checkout.session.completed', makeSession());

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true } });
      expect(harness.entitlements.applyPlan).toHaveBeenCalledTimes(1);
      expect(harness.entitlements.applyPlan).toHaveBeenCalledWith(
        { type: 'user', userId: 'u-1' },
        'spark',
      );
      expect(harness.repository.insertPayment).not.toHaveBeenCalled();
      expect(harness.repository.upsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeSubscriptionId: 'sub_1',
          checkoutSessionId: 'cs_1',
          userId: 'u-1',
          organizationId: null,
          planKey: 'spark',
        }),
      );
      expect(harness.repository.finishEvent).toHaveBeenCalledWith(
        event.id,
        CLAIM_TOKEN,
        'processed',
      );
    });

    it('applies an organization purchase through the org owner only', async () => {
      const harness = createHarness();
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({
          metadata: ORG_METADATA,
          items: {
            data: [{ current_period_start: 1, current_period_end: 2, price: { id: 'price_hub' } }],
          },
        }),
      );
      const event = makeEvent(
        'checkout.session.completed',
        makeSession({ metadata: ORG_METADATA, client_reference_id: 'org-1' }),
      );

      await sign(harness, event);

      expect(harness.entitlements.applyPlan).toHaveBeenCalledTimes(1);
      expect(harness.entitlements.applyPlan).toHaveBeenCalledWith(
        { type: 'org', orgId: 'org-1' },
        'hub',
      );
      expect(harness.repository.upsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          organizationId: 'org-1',
          purchaserUserId: 'u-admin',
          planKey: 'hub',
        }),
      );
    });

    it('does not activate a session that is not paid yet', async () => {
      const harness = createHarness();
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({ status: 'incomplete' }),
      );
      const event = makeEvent(
        'checkout.session.completed',
        makeSession({ payment_status: 'unpaid' }),
      );

      await sign(harness, event);

      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(harness.entitlements.downgradeToFree).not.toHaveBeenCalled();
      expect(harness.repository.upsertSubscription).toHaveBeenCalled();
    });

    it('ignores a session whose owner metadata is missing', async () => {
      const harness = createHarness();
      const event = makeEvent('checkout.session.completed', makeSession({ metadata: {} }));

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('billing.owner_unresolved'),
      );
    });
  });

  describe('customer.subscription.*', () => {
    it('applies an upgrade from the current subscription snapshot', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({
          metadata: { ...USER_METADATA, studiq_plan_key: 'ace' },
          items: {
            data: [{ current_period_start: 1, current_period_end: 2, price: { id: 'price_ace' } }],
          },
        }),
      );
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_600,
      });

      await sign(harness, event);

      expect(harness.entitlements.applyPlan).toHaveBeenCalledWith(
        { type: 'user', userId: 'u-1' },
        'ace',
      );
      expect(harness.repository.upsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ planKey: 'ace', priceId: 'price_ace' }),
      );
    });

    it('downgrades to free when the subscription becomes unpaid', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({ status: 'unpaid' }),
      );
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_600,
      });

      await sign(harness, event);

      expect(harness.entitlements.downgradeToFree).toHaveBeenCalledWith(
        { type: 'user', userId: 'u-1' },
        'spark',
      );
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
    });

    it('downgrades on customer.subscription.deleted', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror({ status: 'canceled' })),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({ status: 'canceled', canceled_at: 1_700_000_600 }),
      );
      const event = makeEvent('customer.subscription.deleted', makeSubscription(), {
        created: 1_700_000_700,
      });

      await sign(harness, event);

      expect(harness.entitlements.downgradeToFree).toHaveBeenCalledWith(
        { type: 'user', userId: 'u-1' },
        'spark',
      );
    });

    it('skips entitlement when a newer event already owns the subscription', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      vi.mocked(harness.repository.upsertSubscription).mockResolvedValueOnce(success('stale'));
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_600,
      });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      // The checkout session id is still recorded on the winner's row.
      expect(harness.repository.attachCheckoutSession).toHaveBeenCalledWith('sub_1', 'cs_1');
    });

    it('skips entitlement when a newer snapshot lands before the write', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId)
        .mockResolvedValueOnce(success(makeMirror()))
        .mockResolvedValueOnce(success(makeMirror({ lastEventCreated: 1_700_000_900 })));
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_600,
      });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.repository.upsertSubscription).toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
    });

    it('does not write when the claim lease was lost to a retry', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.isClaimOwner).mockResolvedValueOnce(success(false));
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_600,
      });

      const result = await sign(harness, event);

      // A reclaimed event may already have applied a newer snapshot; this
      // attempt must not overwrite it even though the handler ran.
      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.repository.upsertSubscription).not.toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('billing.webhook_claim_lost'),
      );
    });

    it('does not downgrade when another subscription is still active', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror({ status: 'canceled' })),
      );
      vi.mocked(harness.repository.findActiveSubscription).mockResolvedValueOnce(
        success({ stripeSubscriptionId: 'sub_main', planKey: 'spark' }),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({ status: 'canceled', canceled_at: 1_700_000_600 }),
      );
      const event = makeEvent('customer.subscription.deleted', makeSubscription(), {
        created: 1_700_000_700,
      });

      const result = await sign(harness, event);

      // The cancelled subscription was the refused duplicate: the owner still
      // pays through `sub_main`, so the plan must stay.
      expect(result).toEqual({ success: true, data: { received: true } });
      expect(harness.entitlements.downgradeToFree).not.toHaveBeenCalled();
      expect(harness.repository.upsertSubscription).toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('billing.downgrade_skipped_active_subscription'),
      );
    });

    it('never regresses the plan for an older event', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror({ lastEventCreated: 1_700_000_900 })),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({ status: 'unpaid' }),
      );
      const event = makeEvent('customer.subscription.updated', makeSubscription(), {
        created: 1_700_000_100,
      });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.entitlements.downgradeToFree).not.toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(harness.repository.upsertSubscription).not.toHaveBeenCalled();
    });

    it('ignores a second active subscription for the same owner', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.findActiveSubscription).mockResolvedValueOnce(
        success({ stripeSubscriptionId: 'sub_other', planKey: 'spark' }),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent('customer.subscription.created', makeSubscription(), {
        created: 1_700_000_600,
      });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.repository.upsertSubscription).not.toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('billing.duplicate_subscription'),
      );
    });
  });

  describe('plan resolution', () => {
    it('falls back to metadata when the price is not mapped, and logs it', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.findPrice).mockResolvedValueOnce(success(null));
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({
          items: {
            data: [
              { current_period_start: 1, current_period_end: 2, price: { id: 'price_unknown' } },
            ],
          },
        }),
      );
      const event = makeEvent('customer.subscription.created', makeSubscription(), {
        created: 1_700_000_600,
      });

      await sign(harness, event);

      expect(harness.entitlements.applyPlan).toHaveBeenCalledWith(
        { type: 'user', userId: 'u-1' },
        'spark',
      );
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('billing.price_unmapped'));
    });

    it('ignores an unmapped price with no usable metadata', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.findPrice).mockResolvedValueOnce(success(null));
      vi.mocked(harness.repository.findCustomerByStripeId).mockResolvedValueOnce(
        success({
          id: 'bc_1',
          stripeCustomerId: 'cus_1',
          userId: 'u-1',
          organizationId: null,
          livemode: false,
        }),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({
          metadata: {},
          items: {
            data: [
              { current_period_start: 1, current_period_end: 2, price: { id: 'price_unknown' } },
            ],
          },
        }),
      );
      const event = makeEvent('customer.subscription.created', makeSubscription({ metadata: {} }), {
        created: 1_700_000_600,
      });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.repository.upsertSubscription).not.toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
    });
  });

  describe('invoices', () => {
    it('writes exactly one payments row when invoice.paid is replayed', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());

      const first = makeEvent('invoice.paid', makeInvoice(), { created: 1_700_000_700 });
      const second = makeEvent('invoice.paid', makeInvoice(), { created: 1_700_000_701 });

      await sign(harness, first);
      await sign(harness, second);

      expect(harness.repository.payments).toHaveLength(1);
      expect(harness.repository.invoices.size).toBe(1);
      expect(harness.repository.payments[0]).toEqual({
        userId: 'u-1',
        organizationId: null,
        planKey: 'spark',
        planName: 'StudiQ Spark',
        amount: 999,
        currency: 'PLN',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripeInvoiceId: 'in_1',
        stripeCheckoutSessionId: 'cs_1',
        hostedInvoiceUrl: 'https://invoice.stripe.test/in_1',
        invoicePdfUrl: 'https://invoice.stripe.test/in_1.pdf',
        paidAt: '2023-11-14T22:15:00.000Z',
      });
    });

    it('does not reuse the checkout session id on a renewal invoice', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent(
        'invoice.paid',
        makeInvoice({ id: 'in_renewal', billing_reason: 'subscription_cycle' }),
        { created: 1_700_000_800 },
      );

      await sign(harness, event);

      // `payments.stripe_checkout_session_id` is UNIQUE; a renewal must not
      // carry the id of the session that created the subscription.
      expect(harness.repository.payments[0]).toMatchObject({
        stripeInvoiceId: 'in_renewal',
        stripeCheckoutSessionId: null,
      });
    });

    it('still records the payment when the mirror write is stale', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      vi.mocked(harness.repository.upsertSubscription).mockResolvedValueOnce(success('stale'));
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(makeSubscription());
      const event = makeEvent('invoice.paid', makeInvoice({ id: 'in_stale' }), {
        created: 1_700_000_800,
      });

      await sign(harness, event);

      // The newer subscription event owns the mirror/entitlement, but the money
      // was still collected, so the history row must exist.
      expect(harness.repository.payments).toHaveLength(1);
      expect(harness.repository.payments[0].stripeInvoiceId).toBe('in_stale');
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
    });

    it('attributes an organization invoice to the recorded purchaser', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(
          makeMirror({
            userId: null,
            organizationId: 'org-1',
            purchaserUserId: 'u-buyer',
            planKey: 'hub',
            priceId: 'price_hub',
          }),
        ),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({
          id: 'sub_1',
          metadata: ORG_METADATA,
          items: {
            data: [{ current_period_start: 1, current_period_end: 2, price: { id: 'price_hub' } }],
          },
        }),
      );
      const invoice = makeInvoice({
        id: 'in_org',
        amount_paid: 9999,
        parent: { subscription_details: { subscription: 'sub_1', metadata: ORG_METADATA } },
      });
      const event = makeEvent('invoice.paid', invoice, { created: 1_700_000_700 });

      await sign(harness, event);

      expect(harness.repository.payments[0]).toMatchObject({
        userId: 'u-buyer',
        organizationId: 'org-1',
        planKey: 'hub',
        amount: 9999,
      });
    });

    it('falls back to the oldest current org admin when the purchaser is gone', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(
          makeMirror({
            userId: null,
            organizationId: 'org-1',
            purchaserUserId: null,
            planKey: 'hub',
            priceId: 'price_hub',
          }),
        ),
      );
      vi.mocked(harness.repository.findOldestOrgAdmin).mockResolvedValueOnce(
        success('u-admin-current'),
      );
      vi.mocked(harness.client.subscriptions.retrieve).mockResolvedValue(
        makeSubscription({
          metadata: ORG_METADATA,
          items: {
            data: [{ current_period_start: 1, current_period_end: 2, price: { id: 'price_hub' } }],
          },
        }),
      );
      const event = makeEvent('invoice.paid', makeInvoice({ id: 'in_org_2' }), {
        created: 1_700_000_700,
      });

      await sign(harness, event);

      expect(harness.repository.payments[0]).toMatchObject({ userId: 'u-admin-current' });
    });

    it('keeps the plan unchanged on invoice.payment_failed', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror()),
      );
      const event = makeEvent(
        'invoice.payment_failed',
        makeInvoice({ billing_reason: 'subscription_cycle' }),
        { created: 1_700_000_700 },
      );

      await sign(harness, event);

      expect(harness.repository.updateSubscriptionStatus).toHaveBeenCalledWith(
        'sub_1',
        'past_due',
        1_700_000_700,
      );
      expect(harness.repository.insertPayment).not.toHaveBeenCalled();
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(harness.entitlements.downgradeToFree).not.toHaveBeenCalled();
    });

    it('marks a first invoice failure incomplete without changing the plan', async () => {
      const harness = createHarness();
      vi.mocked(harness.repository.getSubscriptionByStripeId).mockResolvedValue(
        success(makeMirror({ status: 'incomplete' })),
      );
      const event = makeEvent(
        'invoice.payment_action_required',
        makeInvoice({ billing_reason: 'subscription_create' }),
        { created: 1_700_000_700 },
      );

      await sign(harness, event);

      expect(harness.repository.updateSubscriptionStatus).toHaveBeenCalledWith(
        'sub_1',
        'incomplete',
        1_700_000_700,
      );
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
      expect(harness.entitlements.downgradeToFree).not.toHaveBeenCalled();
    });
  });

  describe('unhandled events', () => {
    it('acknowledges checkout.session.expired without writes', async () => {
      const harness = createHarness();
      const event = makeEvent('checkout.session.expired', { id: 'cs_1' });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.repository.finishEvent).toHaveBeenCalledWith(event.id, CLAIM_TOKEN, 'ignored');
      expect(harness.entitlements.applyPlan).not.toHaveBeenCalled();
    });

    it('acknowledges an unknown event type', async () => {
      const harness = createHarness();
      const event = makeEvent('charge.refunded', { id: 'ch_1' });

      const result = await sign(harness, event);

      expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
      expect(harness.repository.upsertSubscription).not.toHaveBeenCalled();
    });
  });
});
