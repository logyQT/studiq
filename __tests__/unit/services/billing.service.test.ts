import { AccountType, type RequestContext } from '@studiq/authz';
import {
  CHECKOUT_BUCKET_MS,
  checkoutExpiresAt,
  checkoutIdempotencyKey,
} from '@studiq/server/lib/payment/checkout-timing';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type {
  CatalogPlan,
  ListedPrice,
  StripeBillingRepository,
} from '@studiq/server/lib/payment/stripe-repository';
import { success } from '@studiq/server/lib/service-result';
import { BillingService, billingService } from '@studiq/server/services/billing.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const studentCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

const managerCtx: RequestContext = {
  ...studentCtx,
  userId: 'u-9',
  accountType: AccountType.MANAGER,
  activeOrgId: 'org-1',
};

function plan(overrides: Partial<CatalogPlan> = {}): CatalogPlan {
  return {
    key: 'spark',
    name: 'StudiQ Spark',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'student',
    ...overrides,
  };
}

function listedPrice(overrides: Partial<ListedPrice> = {}): ListedPrice {
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

function createGateway(driver: 'mock' | 'stripe' = 'stripe') {
  return {
    driver,
    livemode: false,
    createCheckoutSession: vi
      .fn()
      .mockResolvedValue(success({ url: 'https://checkout.test/cs_1', sessionId: 'cs_1' })),
    createPortalSession: vi.fn(),
    changePlan: vi.fn(),
    cancelAtPeriodEnd: vi.fn(),
    handleWebhook: vi.fn(),
  } as unknown as PaymentGateway;
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return {
    getPlan: vi.fn().mockResolvedValue(success(plan())),
    isOrgAdmin: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn(),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi.fn().mockResolvedValue(success(listedPrice())),
    findActiveSubscription: vi.fn().mockResolvedValue(success(null)),
    ...overrides,
  } as unknown as StripeBillingRepository;
}

describe('BillingService.startCheckout', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository);
  });

  it('rejects a free plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(success(plan({ priceMonthly: 0 })));

    await expect(service.startCheckout(studentCtx, 'base')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an inactive plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(success(plan({ isActive: false })));

    await expect(service.startCheckout(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
  });

  it('rejects a plan from another account family', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(plan({ key: 'hub', forAccountType: 'manager' })),
    );

    await expect(service.startCheckout(studentCtx, 'hub')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('requires an org id for an organization plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(plan({ key: 'hub', forAccountType: 'manager' })),
    );

    await expect(service.startCheckout(managerCtx, 'hub')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects a non-admin org buyer without calling Stripe', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(plan({ key: 'hub', name: 'StudiQ Hub', forAccountType: 'manager' })),
    );
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));

    await expect(service.startCheckout(managerCtx, 'hub', 'org-1')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the owner already has a live subscription', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success({ stripeSubscriptionId: 'sub_1', status: 'active' }),
    );

    await expect(service.startCheckout(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'CONFLICT',
    });
    expect(repository.findListedPrice).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('fails closed when the mapped price amount differs from the catalog', async () => {
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(
      success(listedPrice({ unitAmount: 1000 })),
    );

    await expect(service.startCheckout(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('fails closed when the plan has no mapped price', async () => {
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(success(null));

    await expect(service.startCheckout(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });

  it('starts a personal checkout with the resolved price and owner', async () => {
    const result = await service.startCheckout(studentCtx, 'spark', undefined, 'en');

    expect(result.success).toBe(true);
    expect(repository.findActiveSubscription).toHaveBeenCalledWith(
      { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      false,
    );
    expect(repository.findListedPrice).toHaveBeenCalledWith('spark', 'monthly', false);
    expect(gateway.createCheckoutSession).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      planKey: 'spark',
      planName: 'StudiQ Spark',
      amount: 999,
      currency: 'PLN',
      billingCycle: 'monthly',
      priceId: 'price_spark',
      locale: 'en',
      expiresAt: expect.any(Number),
      idempotencyKey: expect.stringMatching(/^checkout:user:u-1::spark:en:\d+$/),
    });

    const input = vi.mocked(gateway.createCheckoutSession).mock.calls[0][0];
    const bucket = Number(input.idempotencyKey.split(':').pop());
    expect(input.expiresAt).toBe(((bucket + 2) * CHECKOUT_BUCKET_MS) / 1000 + 60);
  });

  it('starts an organization checkout for an admin', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(
        plan({ key: 'hub', name: 'StudiQ Hub', priceMonthly: 1999, forAccountType: 'manager' }),
      ),
    );
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(
      success(listedPrice({ planKey: 'hub', stripePriceId: 'price_hub', unitAmount: 1999 })),
    );

    await service.startCheckout(managerCtx, 'hub', 'org-1');

    expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          type: 'org',
          orgId: 'org-1',
          userId: 'u-9',
          accountType: AccountType.MANAGER,
        },
        planKey: 'hub',
        priceId: 'price_hub',
        expiresAt: expect.any(Number),
        idempotencyKey: expect.stringMatching(/^checkout:org:org-1:u-9:hub:pl:\d+$/),
      }),
    );
  });

  it('skips Stripe-only checks for the mock driver', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await service.startCheckout(studentCtx, 'spark');

    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(repository.findListedPrice).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ planKey: 'spark', priceId: undefined }),
    );
  });

  it('propagates gateway failures', async () => {
    vi.mocked(gateway.createCheckoutSession).mockResolvedValueOnce({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });

    await expect(service.startCheckout(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });
});

describe('checkoutIdempotencyKey', () => {
  const owner = { type: 'user' as const, userId: 'u-1', accountType: AccountType.STUDENT };

  it('collapses retries inside the same 30-minute bucket', () => {
    const start = 1_800_000_000_000;
    expect(checkoutIdempotencyKey(owner, 'spark', 'pl', start)).toBe(
      checkoutIdempotencyKey(owner, 'spark', 'pl', start + 29 * 60 * 1000),
    );
  });

  it('uses a new key after the bucket rolls over', () => {
    const start = 1_800_000_000_000;
    expect(checkoutIdempotencyKey(owner, 'spark', 'pl', start)).not.toBe(
      checkoutIdempotencyKey(owner, 'spark', 'pl', start + 30 * 60 * 1000),
    );
  });

  it('distinguishes the purchaser and locale for an organization', () => {
    const start = 1_800_000_000_000;
    const first = {
      type: 'org' as const,
      orgId: 'org-1',
      userId: 'admin-1',
      accountType: AccountType.MANAGER,
    };
    const second = { ...first, userId: 'admin-2' };

    expect(checkoutIdempotencyKey(first, 'hub', 'pl', start)).not.toBe(
      checkoutIdempotencyKey(second, 'hub', 'pl', start),
    );
    expect(checkoutIdempotencyKey(first, 'hub', 'pl', start)).not.toBe(
      checkoutIdempotencyKey(first, 'hub', 'en', start),
    );
  });
});

describe('checkoutExpiresAt', () => {
  it('is stable for every retry inside one bucket and clears the 30-minute minimum', () => {
    const start = 1_800_000_000_000;
    const bucketEnd = start + CHECKOUT_BUCKET_MS - 1;

    expect(checkoutExpiresAt(start)).toBe(checkoutExpiresAt(bucketEnd));
    expect(checkoutExpiresAt(bucketEnd)).toBeGreaterThanOrEqual(
      Math.floor(bucketEnd / 1000) + 30 * 60,
    );
    expect(checkoutExpiresAt(bucketEnd)).toBeLessThanOrEqual(
      Math.floor(bucketEnd / 1000) + 24 * 60 * 60,
    );
  });
});

describe('billingService singleton', () => {
  it('exposes startCheckout with the configured gateway', () => {
    expect(typeof billingService.startCheckout).toBe('function');
  });
});
