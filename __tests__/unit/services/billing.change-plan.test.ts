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
};

const CATALOG: Record<string, CatalogPlan> = {
  spark: {
    key: 'spark',
    name: 'StudiQ Spark',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'student',
    sortOrder: 1,
  },
  ace: {
    key: 'ace',
    name: 'StudiQ Ace',
    priceMonthly: 2999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'student',
    sortOrder: 2,
  },
  hub: {
    key: 'hub',
    name: 'StudiQ Hub',
    priceMonthly: 4999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'manager',
    sortOrder: 3,
  },
  team: {
    key: 'team',
    name: 'StudiQ Team',
    priceMonthly: 5999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'manager',
    sortOrder: 4,
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
    isOrgAdmin: vi.fn().mockResolvedValue(success(true)),
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
    const input = vi.mocked(gateway.changePlan).mock.calls[0][0];
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
      success({ ...CATALOG.ace, isActive: false }),
    );
    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('rejects a plan from another account family', async () => {
    await expect(service.changePlan(studentCtx, 'hub')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });

    await expect(service.changePlan(managerCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('re-checks org admin before reading the subscription', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));

    await expect(service.changePlan(managerCtx, 'team')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(gateway.changePlan).not.toHaveBeenCalled();
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
      success({ ...listedPrice(CATALOG.ace), unitAmount: 1000 }),
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
      success({ ...CATALOG.ace, priceMonthly: 0 }),
    );

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('rejects a plan from another account type within the personal family', async () => {
    const educatorCtx = { ...studentCtx, accountType: AccountType.EDUCATOR };

    // `ace` is a student plan; an educator cannot buy it.
    await expect(service.changePlan(educatorCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
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
      .mockResolvedValueOnce(success(CATALOG.ace))
      .mockResolvedValueOnce(success(null));

    await expect(service.changePlan(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
  });

  it('fails closed when price and sort order disagree on the direction', async () => {
    vi.mocked(repository.getPlan).mockResolvedValueOnce(success({ ...CATALOG.ace, sortOrder: 0 }));

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

  it('propagates an org membership read failure', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.changePlan(managerCtx, 'team')).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
    expect(gateway.changePlan).not.toHaveBeenCalled();
  });

  it('changes an organization plan for an admin', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ planKey: 'hub', priceId: 'price_hub' })),
    );
    vi.mocked(gateway.changePlan).mockResolvedValueOnce(success({ status: 'applied' }));

    await service.changePlan(managerCtx, 'team');

    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
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
});

describe('changePlanIdempotencyKey', () => {
  it('is derived from the exact mutation identity, not the clock', () => {
    expect(changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01')).toBe(
      changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01'),
    );
    expect(changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01')).not.toBe(
      changePlanIdempotencyKey('sub_1', 'hub', 'price_hub', '2026-12-01'),
    );
    expect(changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2026-12-01')).not.toBe(
      changePlanIdempotencyKey('sub_1', 'ace', 'price_ace', '2027-01-01'),
    );
  });
});
