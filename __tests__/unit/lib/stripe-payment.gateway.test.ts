import { AccountType } from '@studiq/authz';
import { CHECKOUT_BUCKET_MS } from '@studiq/server/lib/payment/checkout-timing';
import type { StripeConfig } from '@studiq/server/lib/payment/payment-gateway.factory';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import { StripePaymentGateway } from '@studiq/server/lib/payment/stripe-payment.gateway';
import type { StripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
import { success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const config: StripeConfig = {
  secretKey: 'sk_test_123',
  webhookSecret: 'whsec_123',
  portalConfigurationId: 'bpc_123',
  livemode: false,
};

const NOW = new Date('2027-01-15T12:00:00.000Z');

function createClient() {
  return {
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
    subscriptions: { retrieve: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  } as unknown as StripeClient;
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
  return {
    getPlan: vi.fn().mockResolvedValue(
      success({
        key: 'spark',
        name: 'StudiQ Spark',
        priceMonthly: 999,
        currency: 'PLN',
        isActive: true,
        forAccountType: 'student',
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
    ...overrides,
  } as unknown as StripeBillingRepository;
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

  it('keeps portal, plan changes and webhooks unwired for phase 2A', async () => {
    await expect(
      gateway.createPortalSession({ userId: 'u-1', accountType: AccountType.STUDENT }),
    ).resolves.toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });

    await expect(
      gateway.changePlan({
        userId: 'u-1',
        accountType: AccountType.STUDENT,
        targetPlanKey: 'ace',
        idempotencyKey: 'change',
      }),
    ).resolves.toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });

    await expect(
      gateway.cancelAtPeriodEnd({
        userId: 'u-1',
        accountType: AccountType.STUDENT,
        cancel: true,
      }),
    ).resolves.toEqual({ success: false, error: 'SERVICE_UNAVAILABLE' });

    await expect(
      gateway.handleWebhook({
        kind: 'mock',
        ctx: {} as never,
        event: {} as never,
      }),
    ).resolves.toEqual({ success: false, error: 'BAD_REQUEST' });
  });

  it('delegates a stripe envelope to the webhook service', async () => {
    const handle = vi.fn().mockResolvedValue(success({ received: true }));
    const withWebhooks = new StripePaymentGateway({
      client,
      config,
      repository,
      webhooks: { handle } as never,
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
