import { AccountType, type RequestContext } from '@studiq/authz';
import { changePlanIdempotencyKey } from '@studiq/server/lib/payment/checkout-timing';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type {
  ActiveSubscription,
  CatalogPlan,
  ListedPrice,
  StripeBillingRepository,
} from '@studiq/server/lib/payment/stripe-repository';
import { warn as logWarn } from '@studiq/server/lib/log';
import { failure, success } from '@studiq/server/lib/service-result';
import { BillingService } from '@studiq/server/services/billing.service';
import { asJson } from '#test/helpers/json';
import { firstCall, requiredValue } from '#test/mocks/recorded';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/log', () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

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

const CATALOG: Record<string, CatalogPlan> = {
  spark: {
    key: 'spark',
    name: 'StudiQ Spark',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    scope: 'personal',
    audience: 'student',
    sortOrder: 1,
  },
  ace: {
    key: 'ace',
    name: 'StudiQ Ace',
    priceMonthly: 2999,
    currency: 'PLN',
    isActive: true,
    scope: 'personal',
    audience: 'student',
    sortOrder: 2,
  },
  hub: {
    key: 'hub',
    name: 'StudiQ Hub',
    priceMonthly: 4999,
    currency: 'PLN',
    isActive: true,
    scope: 'organization',
    audience: null,
    sortOrder: 3,
  },
  team: {
    key: 'team',
    name: 'StudiQ Team',
    priceMonthly: 5999,
    currency: 'PLN',
    isActive: true,
    scope: 'organization',
    audience: null,
    sortOrder: 4,
  },
  solo: {
    key: 'solo',
    name: 'StudiQ Solo',
    priceMonthly: 1999,
    currency: 'PLN',
    isActive: true,
    scope: 'personal',
    audience: 'manager',
    sortOrder: 5,
  },
};

function listedPrice(plan: CatalogPlan): ListedPrice {
  return {
    planKey: plan.key,
    stripePriceId: `price_${plan.key}`,
    currency: plan.currency,
    unitAmount: plan.priceMonthly,
    interval: 'month',
    active: true,
  };
}

function activeSubscription(overrides: Partial<ActiveSubscription> = {}): ActiveSubscription {
  return {
    stripeSubscriptionId: 'sub_1',
    status: 'active',
    planKey: 'spark',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z',
    pendingPlanKey: null,
    ...overrides,
  };
}

function createGateway(driver: 'mock' | 'stripe' = 'stripe'): PaymentGateway {
  return {
    driver,
    livemode: false,
    createCheckoutSession: vi.fn<PaymentGateway['createCheckoutSession']>(),
    createPortalSession: vi.fn<PaymentGateway['createPortalSession']>(),
    changePlan: vi
      .fn<PaymentGateway['changePlan']>()
      .mockResolvedValue(success({ status: 'applied' })),
    cancelAtPeriodEnd: vi
      .fn<PaymentGateway['cancelAtPeriodEnd']>()
      .mockResolvedValue(success(undefined)),
    releaseScheduledPlan: vi.fn<PaymentGateway['releaseScheduledPlan']>(),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  };
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(success(CATALOG[key] ?? null))),
    canManageBilling: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn().mockResolvedValue(success({ stripeCustomerId: 'cus_1' })),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(success(CATALOG[key] ? listedPrice(CATALOG[key]) : null)),
      ),
    findActiveSubscription: vi.fn().mockResolvedValue(success(activeSubscription())),
    setPendingPlan: vi.fn().mockResolvedValue(success(undefined)),
    clearPendingPlanIfApplied: vi.fn().mockResolvedValue(success(undefined)),
    ...overrides,
  });
}

describe('BillingService.changePlan', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository);
  });

  it('applies an upgrade now with the anchor reset and idempotency key', async () => {
    const result = await service.changePlan(studentCtx, 'ace');

    expect(result).toEqual(success({ status: 'applied' }));
    expect(gateway.changePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        currentPlanKey: 'spark',
        targetPlanKey: 'ace',
        targetPriceId: 'price_ace',
        direction: 'upgrade',
      }),
    );
    const input = firstCall(vi.mocked(gateway.changePlan))[0];
    expect(input.idempotencyKey).toBe('change-plan:sub_1:ace:price_ace:2026-12-01T00:00:00.000Z');
    expect(repository.setPendingPlan).toHaveBeenCalledWith('sub_1', null);
  });

  it('schedules a downgrade and stores the pending plan marker', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ planKey: 'ace' })),
    );
    vi.mocked(gateway.changePlan).mockResolvedValueOnce(success({ status: 'scheduled' }));

    const result = await service.changePlan(studentCtx, 'spark');

    expect(result).toEqual(success({ status: 'scheduled' }));
    expect(gateway.changePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPlanKey: 'ace',
        targetPlanKey: 'spark',
        targetPriceId: 'price_spark',
        direction: 'downgrade',
      }),
    );
    expect(repository.setPendingPlan).toHaveBeenCalledWith('sub_1', 'spark');
  });

  it('rejects the current plan', async () => {
    await expect(service.changePlan(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('rejects a free or inactive target plan', async () => {
    await expect(service.changePlan(studentCtx, 'missing')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });

    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success({ ...requiredValue(CATALOG.ace, 'ace plan'), isActive: false }),
    );
    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('rejects an organization plan with no org to bill (D34)', async () => {
    // `hub` is an organization plan; without an org id the answer is FORBIDDEN.
    await expect(service.changePlan(studentCtx, 'hub')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('resolves a caller without org.billing.manage to the personal owner (org plans refused, personal targets bought for the user)', async () => {
    const memberCtx: RequestContext = { ...managerCtx, permissionScopes: {} };

    // An organization plan can never attach to the personal owner, so the
    // subscription is never read for this target.
    await expect(service.changePlan(memberCtx, 'team')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(gateway.changePlan).not.toHaveBeenCalled();

    // A personal plan of the caller's audience goes through on the user owner.
    await service.changePlan(memberCtx, 'solo');

    expect(repository.findActiveSubscription).toHaveBeenCalledWith(
      { type: 'user', userId: 'u-9', accountType: AccountType.MANAGER },
      false,
    );
    expect(gateway.changePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: 'user', userId: 'u-9', accountType: AccountType.MANAGER },
      }),
    );
  });

  it('returns NOT_FOUND when the owner has no active subscription', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(success(null));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when there is no customer mapping', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(success(null));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('fails closed when the target price does not match the catalog', async () => {
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(
      success({ ...listedPrice(requiredValue(CATALOG.ace, 'ace plan')), unitAmount: 1000 }),
    );

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('propagates a gateway failure without writing the marker', async () => {
    vi.mocked(gateway.changePlan).mockResolvedValueOnce(failure('SERVICE_UNAVAILABLE'));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(repository.setPendingPlan).not.toHaveBeenCalled();
  });

  it('keeps the provider change when the display marker cannot be written', async () => {
    vi.mocked(repository.setPendingPlan).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual(
      success({ status: 'applied' }),
    );
  });

  it('rejects a free target plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success({ ...requiredValue(CATALOG.ace, 'ace plan'), priceMonthly: 0 }),
    );

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('propagates a catalog read failure for the target plan', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('returns NOT_FOUND when the current plan disappeared from the catalog', async () => {
    vi.mocked(repository.getPlan)
      .mockResolvedValueOnce(success(requiredValue(CATALOG.ace, 'ace plan')))
      .mockResolvedValueOnce(success(null));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
  });

  it('fails closed when price and sort order disagree on the direction', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success({ ...requiredValue(CATALOG.ace, 'ace plan'), sortOrder: 0 }),
    );

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('fails closed when the target price is not mapped', async () => {
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(success(null));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });

  it('propagates a subscription read failure', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('propagates a customer lookup failure', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('changes an organization plan for a role holding org.billing.manage', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ planKey: 'hub', priceId: 'price_hub' })),
    );
    vi.mocked(gateway.changePlan).mockResolvedValueOnce(success({ status: 'applied' }));

    await service.changePlan(managerCtx, 'team');

    expect(gateway.changePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          type: 'org',
          orgId: 'org-1',
          userId: 'u-9',
          accountType: AccountType.MANAGER,
        },
        currentPlanKey: 'hub',
        targetPlanKey: 'team',
        direction: 'upgrade',
      }),
    );
  });

  it('stores the pending marker when an upgrade awaits payment', async () => {
    vi.mocked(gateway.changePlan).mockResolvedValueOnce(
      success({ status: 'pending_payment', hostedInvoiceUrl: 'https://invoice.stripe.com/i/1' }),
    );

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual(
      success({ status: 'pending_payment', hostedInvoiceUrl: 'https://invoice.stripe.com/i/1' }),
    );
    expect(repository.setPendingPlan).toHaveBeenCalledWith('sub_1', 'ace');
  });

  it('warns but keeps the provider change when the marker write fails', async () => {
    vi.mocked(repository.setPendingPlan).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await service.changePlan(studentCtx, 'ace');

    expect(logWarn).toHaveBeenCalledWith(
      'billing.pending_plan_marker_failed',
      expect.objectContaining({ subscriptionId: 'sub_1', planKey: 'ace' }),
    );
  });

  it('reports NOT_FOUND for the mock driver', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
  });

  it('answers NOT_FOUND on the mock driver for a caller without org.billing.manage (personal owner, no provider action)', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);
    const memberCtx: RequestContext = { ...managerCtx, permissionScopes: {} };

    await expect(service.changePlan(memberCtx, 'solo')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });
});

describe('changePlanIdempotencyKey', () => {
  it('is derived from the exact mutation identity, not the clock', () => {
    const key = changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01');
    expect(changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01')).toBe(key);
    expect(changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01')).not.toBe(
      changePlanIdempotencyKey('sub_1', 'hub', 'price_hub', '2026-12-01'),
    );
    expect(changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01')).not.toBe(
      changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2027-01-01'),
    );
  });
});
