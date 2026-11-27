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
import { asJson } from '#test/helpers/json';
import { firstCall } from '#test/mocks/recorded';
import { BillingService, billingService } from '@studiq/server/services/billing.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const anyNumber: unknown = expect.any(Number);
const anyUserCheckoutKey: unknown = expect.stringMatching(/^checkout:user:u-1::plus:en:\d+$/);
const anyOrgCheckoutKey: unknown = expect.stringMatching(/^checkout:org:org-1:u-9:hub:pl:\d+$/);

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
  permissionScopes: { 'org.billing.manage': 'organization' },
};

function plan(overrides: Partial<CatalogPlan> = {}): CatalogPlan {
  return {
    key: 'plus',
    name: 'StudiQ Plus',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    scope: 'personal',
    sortOrder: 1,
    ...overrides,
  };
}

function listedPrice(overrides: Partial<ListedPrice> = {}): ListedPrice {
  return {
    planKey: 'plus',
    stripePriceId: 'price_plus',
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
      .fn<PaymentGateway['createCheckoutSession']>()
      .mockResolvedValue(success({ url: 'https://checkout.test/cs_1', sessionId: 'cs_1' })),
    createPortalSession: vi.fn<PaymentGateway['createPortalSession']>(),
    changePlan: vi.fn<PaymentGateway['changePlan']>(),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
    releaseScheduledPlan: vi.fn<PaymentGateway['releaseScheduledPlan']>(),
    reconcileCheckout: vi.fn<PaymentGateway['reconcileCheckout']>(),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  } satisfies PaymentGateway;
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi.fn().mockResolvedValue(success(plan())),
    canManageBilling: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn(),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi.fn().mockResolvedValue(success(listedPrice())),
    findActiveSubscription: vi.fn().mockResolvedValue(success(null)),
    setPendingPlan: vi.fn().mockResolvedValue(success(undefined)),
    clearPendingPlanIfApplied: vi.fn().mockResolvedValue(success(undefined)),
    ...overrides,
  });
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

  it('resolves the payment gateway lazily so module import needs no Stripe config', () => {
    const provider = vi.fn(() => gateway);
    const lazy = new BillingService(provider, repository);

    expect(provider).not.toHaveBeenCalled();
    expect(lazy).toBeInstanceOf(BillingService);
  });

  it('stops new checkouts when the kill switch is on, without touching the gateway', async () => {
    vi.stubEnv('CHECKOUT_KILL_SWITCH', '1');

    try {
      await expect(service.startCheckout(studentCtx, 'plus')).resolves.toEqual({
        success: false,
        error: 'SERVICE_UNAVAILABLE',
      });
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
      expect(repository.getPlan).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the portal available while the checkout kill switch is on', async () => {
    vi.stubEnv('CHECKOUT_KILL_SWITCH', '1');

    try {
      vi.mocked(repository.findCustomer).mockResolvedValueOnce(
        success({ stripeCustomerId: 'cus_1' }),
      );
      vi.mocked(gateway.createPortalSession).mockResolvedValueOnce(
        success({ url: 'https://billing.stripe.com/p/session' }),
      );

      await expect(service.createPortalSession(studentCtx)).resolves.toEqual(
        success({ url: 'https://billing.stripe.com/p/session' }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects a free plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(success(plan({ priceMonthly: 0 })));

    await expect(service.startCheckout(studentCtx, 'free')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an inactive plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(success(plan({ isActive: false })));

    await expect(service.startCheckout(studentCtx, 'plus')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
  });

  it('answers FORBIDDEN when an organization plan arrives without an org id (D34)', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(plan({ key: 'hub', scope: 'organization' })),
    );

    await expect(service.startCheckout(managerCtx, 'hub')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an org buyer without org.billing.manage in the target org, without calling Stripe', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(plan({ key: 'hub', name: 'StudiQ Hub', scope: 'organization' })),
    );
    vi.mocked(repository.canManageBilling).mockResolvedValueOnce(success(false));

    await expect(service.startCheckout(managerCtx, 'hub', 'org-1')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.canManageBilling).toHaveBeenCalledWith('org-1', 'u-9');
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('lets a Billing-preset holder buy for an explicit target org (any persona)', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(
        plan({
          key: 'hub',
          name: 'StudiQ Hub',
          priceMonthly: 1999,
          scope: 'organization',
        }),
      ),
    );
    vi.mocked(repository.canManageBilling).mockResolvedValueOnce(success(true));
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(
      success(listedPrice({ planKey: 'hub', stripePriceId: 'price_hub', unitAmount: 1999 })),
    );

    // A student persona holding org.billing.manage in the target org is the
    // org buyer; the persona plays no part in `resolveCheckoutOwner`.
    const billingStudentCtx: RequestContext = { ...studentCtx, activeOrgId: 'org-2' };

    await expect(service.startCheckout(billingStudentCtx, 'hub', 'org-2')).resolves.toMatchObject({
      success: true,
    });
    expect(repository.canManageBilling).toHaveBeenCalledWith('org-2', 'u-1');
    expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: 'org', orgId: 'org-2', userId: 'u-1', accountType: AccountType.STUDENT },
      }),
    );
  });

  it('returns CONFLICT when the owner already has a live subscription', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success({
        stripeSubscriptionId: 'sub_1',
        status: 'active',
        planKey: 'plus',
        currentPeriodEnd: null,
      }),
    );

    await expect(service.startCheckout(studentCtx, 'plus')).resolves.toEqual({
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

    await expect(service.startCheckout(studentCtx, 'plus')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('fails closed when the plan has no mapped price', async () => {
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(success(null));

    await expect(service.startCheckout(studentCtx, 'plus')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });

  it('starts a personal checkout with the resolved price and owner', async () => {
    const result = await service.startCheckout(studentCtx, 'plus', undefined, 'en');

    expect(result.success).toBe(true);
    expect(repository.findActiveSubscription).toHaveBeenCalledWith(
      { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      false,
    );
    expect(repository.findListedPrice).toHaveBeenCalledWith('plus', 'monthly', false);
    expect(gateway.createCheckoutSession).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      planKey: 'plus',
      planName: 'StudiQ Plus',
      amount: 999,
      currency: 'PLN',
      billingCycle: 'monthly',
      priceId: 'price_plus',
      locale: 'en',
      expiresAt: anyNumber,
      idempotencyKey: anyUserCheckoutKey,
    });

    const input = firstCall(vi.mocked(gateway.createCheckoutSession))[0];
    const bucket = Number(input.idempotencyKey.split(':').pop());
    expect(input.expiresAt).toBe(((bucket + 2) * CHECKOUT_BUCKET_MS) / 1000 + 60);
  });

  it('starts an organization checkout for an admin', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(
        plan({
          key: 'hub',
          name: 'StudiQ Hub',
          priceMonthly: 1999,
          scope: 'organization',
        }),
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
        expiresAt: anyNumber,
        idempotencyKey: anyOrgCheckoutKey,
      }),
    );
  });

  it('skips Stripe-only checks for the mock driver', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await service.startCheckout(studentCtx, 'plus');

    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(repository.findListedPrice).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ planKey: 'plus', priceId: undefined }),
    );
  });

  it('propagates gateway failures', async () => {
    vi.mocked(gateway.createCheckoutSession).mockResolvedValueOnce({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });

    await expect(service.startCheckout(studentCtx, 'plus')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });
});

describe('checkoutIdempotencyKey', () => {
  const owner = { type: 'user' as const, userId: 'u-1', accountType: AccountType.STUDENT };

  it('collapses retries inside the same 30-minute bucket', () => {
    const start = 1_800_000_000_000;
    expect(checkoutIdempotencyKey(owner, 'plus', 'pl', start)).toBe(
      checkoutIdempotencyKey(owner, 'plus', 'pl', start + 29 * 60 * 1000),
    );
  });

  it('uses a new key after the bucket rolls over', () => {
    const start = 1_800_000_000_000;
    expect(checkoutIdempotencyKey(owner, 'plus', 'pl', start)).not.toBe(
      checkoutIdempotencyKey(owner, 'plus', 'pl', start + 30 * 60 * 1000),
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

// The singleton is the only place the export is wrapped by `wrapService`, so touching a
// member through it is what keeps that Proxy path exercised.
describe('billingService singleton', () => {
  it('exposes startCheckout with the configured gateway', () => {
    expect(typeof billingService.startCheckout).toBe('function');
  });
});
