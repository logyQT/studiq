// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import type Stripe from 'stripe';
import { AccountType, type RequestContext } from '@studiq/authz';
import { CHECKOUT_BUCKET_MS } from '@studiq/server/lib/payment/checkout-timing';
import type { StripeConfig } from '@studiq/server/lib/payment/payment-gateway.factory';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import { StripePaymentGateway } from '@studiq/server/lib/payment/stripe-payment.gateway';
import type { StripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
import { success } from '@studiq/server/lib/service-result';
import type { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import { asJson } from '#test/helpers/json';
import { asService } from '#test/helpers/service-double';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const config: StripeConfig = {
  secretKey: 'sk_test_123',
  webhookSecret: 'whsec_123',
  portalConfigurationId: 'bpc_123',
  livemode: false,
};

const NOW = new Date('2027-01-15T12:00:00.000Z');

function createClient() {
  return asJson<StripeClient>({
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_1' }) },
    checkout: {
      sessions: {
        create: vi
          .fn()
          .mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
        retrieve: vi.fn(),
      },
    },
    prices: { retrieve: vi.fn() },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    subscriptionSchedules: {
      create: vi.fn(),
      update: vi.fn(),
      release: vi.fn(),
    },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  });
}

function listedPrice(overrides: Record<string, unknown> = {}) {
  return {
    planKey: 'spark',
    stripePriceId: 'price_spark',
    currency: 'PLN',
    unitAmount: 999,
    interval: 'month',
    active: true,
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi.fn().mockResolvedValue(
      success({
        key: 'spark',
        name: 'StudiQ Spark',
        priceMonthly: 999,
        currency: 'PLN',
        isActive: true,
        forAccountType: 'student',
        sortOrder: 1,
      }),
    ),
    isOrgAdmin: vi.fn(),
    findCustomer: vi.fn().mockResolvedValue(success(null)),
    insertCustomer: vi
      .fn()
      .mockImplementation((_owner, stripeCustomerId: string) =>
        Promise.resolve(success({ stripeCustomerId })),
      ),
    getCustomerDetails: vi
      .fn()
      .mockResolvedValue(success({ email: 'student@example.com', name: 'Test Student' })),
    findPriceById: vi.fn().mockResolvedValue(success(listedPrice())),
    findListedPrice: vi.fn(),
    findActiveSubscription: vi.fn().mockResolvedValue(success(null)),
    setPendingPlan: vi.fn().mockResolvedValue(success(undefined)),
    ...overrides,
  });
}

function personalInput(overrides: Record<string, unknown> = {}) {
  return {
    owner: { type: 'user' as const, userId: 'u-1', accountType: AccountType.STUDENT },
    planKey: 'spark',
    planName: 'StudiQ Spark',
    amount: 999,
    currency: 'PLN',
    billingCycle: 'monthly' as const,
    priceId: 'price_spark',
    locale: 'pl' as const,
    idempotencyKey: 'checkout-key',
    ...overrides,
  };
}

function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return asJson<Stripe.Subscription>({
    id: 'sub_1',
    customer: 'cus_1',
    schedule: null,
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_spark' },
          current_period_start: 1_800_000_000,
          current_period_end: 1_802_592_000,
        },
      ],
    },
    ...overrides,
  });
}

describe('StripePaymentGateway', () => {
  let client: StripeClient;
  let repository: StripeBillingRepository;
  let gateway: StripePaymentGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createClient();
    repository = createRepository();
    gateway = new StripePaymentGateway({
      client,
      config,
      repository,
      siteUrl: () => 'https://studiq.test',
      now: () => NOW,
    });
  });

  it('reports the stripe driver and the key mode', () => {
    expect(gateway.driver).toBe('stripe');
    expect(gateway.livemode).toBe(false);
  });

  it('reuses an existing customer mapping', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(
      success({ stripeCustomerId: 'cus_existing' }),
    );

    const result = await gateway.createCheckoutSession(personalInput());

    expect(result).toEqual(
      success({ url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' }),
    );
    expect(client.customers.create).not.toHaveBeenCalled();
    expect(repository.insertCustomer).not.toHaveBeenCalled();
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
      { idempotencyKey: 'checkout-key' },
    );
  });

  it('creates and stores a customer when none exists', async () => {
    const result = await gateway.createCheckoutSession(personalInput());

    expect(result.success).toBe(true);
    expect(client.customers.create).toHaveBeenCalledWith({
      email: 'student@example.com',
      name: 'Test Student',
      metadata: {
        studiq_owner_type: 'user',
        studiq_user_id: 'u-1',
        studiq_org_id: '',
      },
    });
    expect(repository.insertCustomer).toHaveBeenCalledWith(
      { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      'cus_1',
      false,
    );
  });

  it('creates the session with classic billing mode, server-side price and metadata', async () => {
    await gateway.createCheckoutSession(personalInput());

    const [params, options] = vi.mocked(client.checkout.sessions.create).mock.calls[0];

    expect(params).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      line_items: [{ price: 'price_spark', quantity: 1 }],
      client_reference_id: 'u-1',
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      tax_id_collection: { enabled: false },
      locale: 'pl',
      success_url: 'https://studiq.test/billing/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://studiq.test/checkout?plan_id=spark&canceled=1',
      expires_at:
        Math.floor(
          ((Math.floor(NOW.getTime() / CHECKOUT_BUCKET_MS) + 2) * CHECKOUT_BUCKET_MS) / 1000,
        ) + 60,
    });
    expect(params.subscription_data?.billing_mode).toEqual({ type: 'classic' });
    expect(params.metadata).toMatchObject({
      studiq_owner_type: 'user',
      studiq_user_id: 'u-1',
      studiq_org_id: '',
      studiq_plan_key: 'spark',
      studiq_billing_cycle: 'monthly',
    });
    expect(params.subscription_data?.metadata).toEqual(params.metadata);
    expect(options).toEqual({ idempotencyKey: 'checkout-key' });
  });

  it('forwards the caller snapshot expiry so idempotent retries match', async () => {
    await gateway.createCheckoutSession(personalInput({ expiresAt: 1_900_000_000 }));

    const [params] = vi.mocked(client.checkout.sessions.create).mock.calls[0];
    expect(params.expires_at).toBe(1_900_000_000);
  });

  it('marks an organization customer and records the purchaser', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success({
        key: 'hub',
        name: 'StudiQ Hub',
        priceMonthly: 1999,
        currency: 'PLN',
        isActive: true,
        forAccountType: 'manager',
        sortOrder: 2,
      }),
    );
    vi.mocked(repository.getCustomerDetails).mockResolvedValueOnce(
      success({ email: 'admin@example.com', name: 'Acme School' }),
    );
    vi.mocked(repository.findPriceById).mockResolvedValueOnce(
      success(listedPrice({ planKey: 'hub', stripePriceId: 'price_hub', unitAmount: 1999 })),
    );

    await gateway.createCheckoutSession(
      personalInput({
        owner: {
          type: 'org',
          orgId: 'org-1',
          userId: 'u-9',
          accountType: AccountType.MANAGER,
        },
        planKey: 'hub',
        planName: 'StudiQ Hub',
        amount: 1999,
        priceId: 'price_hub',
      }),
    );

    expect(client.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        name: 'Acme School',
        metadata: {
          studiq_owner_type: 'org',
          studiq_user_id: 'u-9',
          studiq_org_id: 'org-1',
        },
      }),
    );

    const [params] = vi.mocked(client.checkout.sessions.create).mock.calls[0];
    expect(params.client_reference_id).toBe('org-1');
    expect(params.metadata).toMatchObject({
      studiq_owner_type: 'org',
      studiq_user_id: 'u-9',
      studiq_org_id: 'org-1',
    });
  });

  it('fails closed when the command amount differs from the catalog', async () => {
    const result = await gateway.createCheckoutSession(personalInput({ amount: 1000 }));

    expect(result).toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });
    expect(client.customers.create).not.toHaveBeenCalled();
    expect(client.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('fails closed when the mapped price does not match the catalog amount', async () => {
    vi.mocked(repository.findPriceById).mockResolvedValueOnce(
      success(listedPrice({ unitAmount: 1000 })),
    );

    const result = await gateway.createCheckoutSession(personalInput());

    expect(result).toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });
    expect(client.customers.create).not.toHaveBeenCalled();
    expect(client.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('fails closed when the mapped price is missing or inactive', async () => {
    vi.mocked(repository.findPriceById).mockResolvedValueOnce(success(null));

    await expect(gateway.createCheckoutSession(personalInput())).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });

    vi.mocked(repository.findPriceById).mockResolvedValueOnce(
      success(listedPrice({ active: false })),
    );
    await expect(gateway.createCheckoutSession(personalInput())).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(client.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('requires a price id before doing any provider work', async () => {
    const result = await gateway.createCheckoutSession(personalInput({ priceId: undefined }));

    expect(result).toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });
    expect(repository.findPriceById).not.toHaveBeenCalled();
    expect(client.customers.create).not.toHaveBeenCalled();
  });

  it('maps Stripe rate limits onto RATE_LIMITED', async () => {
    vi.mocked(client.checkout.sessions.create).mockRejectedValueOnce({
      type: 'StripeRateLimitError',
    });

    await expect(gateway.createCheckoutSession(personalInput())).resolves.toEqual({
      success: false,
      error: 'RATE_LIMITED',
    });
  });

  it('returns SERVICE_UNAVAILABLE for provider outages', async () => {
    vi.mocked(client.checkout.sessions.create).mockRejectedValueOnce(
      new Error('connection refused'),
    );

    await expect(gateway.createCheckoutSession(personalInput())).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });

  it('creates a portal session for the resolved customer and account-type return URL', async () => {
    vi.mocked(client.billingPortal.sessions.create).mockResolvedValueOnce(
      asJson<Stripe.BillingPortal.Session>({
        id: 'bps_1',
        url: 'https://billing.stripe.com/p/session',
      }),
    );

    const result = await gateway.createPortalSession({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      customerId: 'cus_1',
      returnUrl: 'https://studiq.test/app/billing',
      locale: 'pl',
    });

    expect(result).toEqual(success({ url: 'https://billing.stripe.com/p/session' }));
    expect(client.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://studiq.test/app/billing',
      configuration: 'bpc_123',
      locale: 'pl',
    });
  });

  it('maps a missing customer mapping to NOT_FOUND without calling Stripe', async () => {
    const result = await gateway.createPortalSession({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      returnUrl: 'https://studiq.test/app/billing',
    });

    expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
    expect(client.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('maps portal provider failures through the shared Stripe error mapping', async () => {
    vi.mocked(client.billingPortal.sessions.create).mockRejectedValueOnce({
      type: 'StripeRateLimitError',
    });

    await expect(
      gateway.createPortalSession({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        customerId: 'cus_1',
        returnUrl: 'https://studiq.test/app/billing',
      }),
    ).resolves.toEqual({ success: false, error: 'RATE_LIMITED' });
  });

  it('maps a Stripe-side resource deletion to NOT_FOUND', async () => {
    vi.mocked(client.billingPortal.sessions.create).mockRejectedValueOnce({
      type: 'StripeInvalidRequestError',
      code: 'resource_missing',
    });

    await expect(
      gateway.createPortalSession({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        customerId: 'cus_deleted',
        returnUrl: 'https://studiq.test/app/billing',
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });
  });

  describe('changePlan', () => {
    const changePlanInput = {
      owner: { type: 'user' as const, userId: 'u-1', accountType: AccountType.STUDENT },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      currentPlanKey: 'spark',
      targetPlanKey: 'ace',
      targetPriceId: 'price_ace',
      direction: 'upgrade' as const,
      idempotencyKey: 'change-key',
    };

    it('resets the anchor and charges the proration immediately on upgrade', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(subscriptionFixture());

      const result = await gateway.changePlan(changePlanInput);

      expect(result).toEqual(success({ status: 'applied' }));
      expect(client.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        {
          items: [{ id: 'si_1', price: 'price_ace' }],
          billing_cycle_anchor: { type: 'now' },
          proration_behavior: 'always_invoice',
          payment_behavior: 'pending_if_incomplete',
          expand: ['latest_invoice'],
        },
        { idempotencyKey: 'change-key' },
      );
      expect(client.subscriptionSchedules.create).not.toHaveBeenCalled();
      expect(client.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
    });

    it('releases a pending schedule before changing plan', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ schedule: 'sched_old' }),
      );
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(subscriptionFixture());

      await gateway.changePlan(changePlanInput);

      expect(client.subscriptionSchedules.release).toHaveBeenCalledWith('sched_old');
    });

    it('releases an expanded schedule object before the mutation', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ schedule: { id: 'sched_expanded' } }),
      );
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(subscriptionFixture());

      await gateway.changePlan(changePlanInput);

      expect(client.subscriptionSchedules.release).toHaveBeenCalledWith('sched_expanded');
      expect(
        vi.mocked(client.subscriptionSchedules.release).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(client.subscriptions.update).mock.invocationCallOrder[0]);
    });

    it('treats an already-released schedule as benign', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ schedule: 'sched_old' }),
      );
      vi.mocked(client.subscriptionSchedules.release).mockRejectedValueOnce({
        type: 'StripeInvalidRequestError',
        message: 'This subscription schedule has already been released.',
      });
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(subscriptionFixture());

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual(
        success({ status: 'applied' }),
      );
      expect(client.subscriptions.update).toHaveBeenCalled();
    });

    it('applies nothing when Stripe already bills the target price', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());

      const result = await gateway.changePlan({
        ...changePlanInput,
        targetPriceId: 'price_spark',
      });

      expect(result).toEqual(success({ status: 'applied' }));
      expect(client.subscriptions.update).not.toHaveBeenCalled();
      expect(client.subscriptionSchedules.create).not.toHaveBeenCalled();
    });

    it('refuses a subscription that belongs to another customer', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ customer: 'cus_other' }),
      );

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual({
        success: false,
        error: 'FORBIDDEN',
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('refuses a stale mirror whose plan does not match the live price', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(repository.findPriceById).mockResolvedValueOnce(
        success(listedPrice({ planKey: 'ace', stripePriceId: 'price_spark' })),
      );

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual({
        success: false,
        error: 'CONFLICT',
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('fails closed for a multi-item subscription', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({
          items: {
            data: [
              {
                id: 'si_1',
                price: { id: 'price_spark' },
                current_period_start: 1,
                current_period_end: 2,
              },
              {
                id: 'si_2',
                price: { id: 'price_addon' },
                current_period_start: 1,
                current_period_end: 2,
              },
            ],
          },
        }),
      );

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual({
        success: false,
        error: 'SERVICE_UNAVAILABLE',
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('reports a pending payment instead of claiming the upgrade applied', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(
        subscriptionFixture({
          pending_update: { billing_cycle_anchor: 'now' },
          latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/3ds' },
        }),
      );

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual(
        success({
          status: 'pending_payment',
          hostedInvoiceUrl: 'https://invoice.stripe.com/i/3ds',
        }),
      );
    });

    it('maps a schedule creation failure', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptionSchedules.create).mockRejectedValueOnce({
        type: 'StripeRateLimitError',
      });

      await expect(
        gateway.changePlan({ ...changePlanInput, direction: 'downgrade' }),
      ).resolves.toEqual({ success: false, error: 'RATE_LIMITED' });
    });

    it('maps a schedule update failure', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptionSchedules.create).mockResolvedValueOnce(
        asJson<Stripe.SubscriptionSchedule>({ id: 'sched_1' }),
      );
      vi.mocked(client.subscriptionSchedules.update).mockRejectedValueOnce(new Error('outage'));

      await expect(
        gateway.changePlan({ ...changePlanInput, direction: 'downgrade' }),
      ).resolves.toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });
    });

    it('maps a non-benign release failure', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ schedule: 'sched_old' }),
      );
      vi.mocked(client.subscriptionSchedules.release).mockRejectedValueOnce(new Error('outage'));

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual({
        success: false,
        error: 'SERVICE_UNAVAILABLE',
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('schedules a downgrade at the current period end', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptionSchedules.create).mockResolvedValueOnce(
        asJson<Stripe.SubscriptionSchedule>({ id: 'sched_1' }),
      );
      vi.mocked(client.subscriptionSchedules.update).mockResolvedValueOnce(
        asJson<Stripe.SubscriptionSchedule>({ id: 'sched_1' }),
      );

      const result = await gateway.changePlan({ ...changePlanInput, direction: 'downgrade' });

      expect(result).toEqual(success({ status: 'scheduled' }));
      expect(client.subscriptionSchedules.create).toHaveBeenCalledWith(
        { from_subscription: 'sub_1' },
        { idempotencyKey: 'change-key:schedule' },
      );
      expect(client.subscriptionSchedules.update).toHaveBeenCalledWith(
        'sched_1',
        {
          phases: [
            {
              start_date: 1_800_000_000,
              end_date: 1_802_592_000,
              items: [{ price: 'price_spark', quantity: 1 }],
              metadata: undefined,
            },
            {
              start_date: 1_802_592_000,
              items: [{ price: 'price_ace', quantity: 1 }],
              metadata: undefined,
            },
          ],
        },
        { idempotencyKey: 'change-key:phases' },
      );
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('fails closed when the subscription has no item', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ items: { data: [] } }),
      );

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual({
        success: false,
        error: 'SERVICE_UNAVAILABLE',
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('fails closed when a downgrade has no period boundary', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({
          items: {
            data: [
              {
                id: 'si_1',
                price: { id: 'price_spark' },
                current_period_start: 1_800_000_000,
                current_period_end: null,
              },
            ],
          },
        }),
      );

      await expect(
        gateway.changePlan({ ...changePlanInput, direction: 'downgrade' }),
      ).resolves.toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });
      expect(client.subscriptionSchedules.create).not.toHaveBeenCalled();
    });

    it('maps provider failures through the shared Stripe mapping', async () => {
      vi.mocked(client.subscriptions.retrieve).mockRejectedValueOnce({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
      });

      await expect(gateway.changePlan(changePlanInput)).resolves.toEqual({
        success: false,
        error: 'NOT_FOUND',
      });
    });
  });

  describe('cancelAtPeriodEnd', () => {
    const cancelInput = {
      owner: { type: 'user' as const, userId: 'u-1', accountType: AccountType.STUDENT },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      cancel: true,
    };

    it("schedules cancellation and returns Stripe's authoritative value", async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(
        asJson<Stripe.Subscription>({ id: 'sub_1', cancel_at_period_end: true }),
      );

      await expect(gateway.cancelAtPeriodEnd(cancelInput)).resolves.toEqual(
        success({ cancelAtPeriodEnd: true }),
      );
      expect(client.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        cancel_at_period_end: true,
      });
    });

    it('reactivates before the period ends', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(
        asJson<Stripe.Subscription>({ id: 'sub_1', cancel_at_period_end: false }),
      );

      await expect(gateway.cancelAtPeriodEnd({ ...cancelInput, cancel: false })).resolves.toEqual(
        success({ cancelAtPeriodEnd: false }),
      );

      expect(client.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        cancel_at_period_end: false,
      });
    });

    it('releases a pending schedule before scheduling cancellation', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(
        subscriptionFixture({ schedule: 'sched_old' }),
      );
      vi.mocked(client.subscriptions.update).mockResolvedValueOnce(
        asJson<Stripe.Subscription>({ id: 'sub_1', cancel_at_period_end: true }),
      );

      await gateway.cancelAtPeriodEnd(cancelInput);

      expect(client.subscriptionSchedules.release).toHaveBeenCalledWith('sched_old');
    });

    it('maps a generic provider failure', async () => {
      vi.mocked(client.subscriptions.retrieve).mockResolvedValueOnce(subscriptionFixture());
      vi.mocked(client.subscriptions.update).mockRejectedValueOnce(new Error('outage'));

      await expect(gateway.cancelAtPeriodEnd(cancelInput)).resolves.toEqual({
        success: false,
        error: 'SERVICE_UNAVAILABLE',
      });
    });
  });

  it('refuses a mock webhook envelope on the Stripe driver', async () => {
    await expect(
      gateway.handleWebhook({
        kind: 'mock',
        ctx: asJson<RequestContext>({}),
        event: { type: '', session_id: '', plan_id: '' },
      }),
    ).resolves.toEqual({ success: false, error: 'BAD_REQUEST' });
  });

  it('delegates a stripe envelope to the webhook service', async () => {
    const handle = vi.fn().mockResolvedValue(success({ received: true }));
    const withWebhooks = new StripePaymentGateway({
      client,
      config,
      repository,
      webhooks: asService<StripeWebhookService>({ handle }),
    });

    await expect(
      withWebhooks.handleWebhook({
        kind: 'stripe',
        rawBody: '{"id":"evt_1"}',
        signature: 't=1,v1=abc',
      }),
    ).resolves.toEqual({ success: true, data: { received: true } });

    expect(handle).toHaveBeenCalledWith('{"id":"evt_1"}', 't=1,v1=abc');
  });
});
