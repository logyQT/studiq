import { AccountType, type RequestContext } from '@studiq/authz';
import type { ChangePlanPreview, PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type {
  ActiveSubscription,
  CatalogPlan,
  ListedPrice,
  StripeBillingRepository,
} from '@studiq/server/lib/payment/stripe-repository';
import { failure, success } from '@studiq/server/lib/service-result';
import { BillingService } from '@studiq/server/services/billing.service';
import { asJson } from '#test/helpers/json';
import { firstCall } from '#test/mocks/recorded';
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
  campus: {
    key: 'campus',
    name: 'StudiQ Campus',
    priceMonthly: 6999,
    currency: 'PLN',
    isActive: true,
    scope: 'organization',
    audience: null,
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
    cancelAtPeriodEnd: false,
    pendingPlanKey: null,
    ...overrides,
  };
}

function preview(overrides: Partial<ChangePlanPreview> = {}): ChangePlanPreview {
  return {
    direction: 'upgrade',
    currentPlanKey: 'spark',
    targetPlanKey: 'ace',
    amountDue: 3999,
    currency: 'PLN',
    effectiveAt: '2026-11-26T00:00:00.000Z',
    resumesAtPeriodEnd: false,
    replacesPendingPlanKey: null,
    blockedBySchedule: false,
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
    previewChange: vi.fn<PaymentGateway['previewChange']>().mockResolvedValue(success(preview())),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
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

describe('BillingService.previewChange', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository);
  });

  it('previews an upgrade with the same resolution a change uses', async () => {
    const result = await service.previewChange(studentCtx, 'ace');

    expect(result).toEqual(success(preview()));
    expect(gateway.previewChange).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      currentPlanKey: 'spark',
      targetPlanKey: 'ace',
      targetPriceId: 'price_ace',
      direction: 'upgrade',
      resume: false,
      pendingPlanKey: null,
    });
  });

  it('resolves a downgrade from the catalog price direction', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ planKey: 'ace' })),
    );

    await service.previewChange(studentCtx, 'spark');

    const input = firstCall(vi.mocked(gateway.previewChange))[0];
    expect(input.direction).toBe('downgrade');
    expect(input.currentPlanKey).toBe('ace');
    expect(input.targetPlanKey).toBe('spark');
  });

  it('reports a scheduled cancellation so the dialog can say the change resumes it', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ cancelAtPeriodEnd: true })),
    );
    vi.mocked(gateway.previewChange).mockResolvedValueOnce(
      success(preview({ resumesAtPeriodEnd: true })),
    );

    const result = await service.previewChange(studentCtx, 'ace');

    expect(result).toEqual(success(preview({ resumesAtPeriodEnd: true })));
    expect(gateway.previewChange).toHaveBeenCalledWith(expect.objectContaining({ resume: true }));
  });

  it('passes the pending scheduled plan so the preview can report its replacement', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ pendingPlanKey: 'spark' })),
    );

    await service.previewChange(studentCtx, 'ace');

    expect(gateway.previewChange).toHaveBeenCalledWith(
      expect.objectContaining({ pendingPlanKey: 'spark' }),
    );
  });

  it('writes nothing while previewing', async () => {
    await service.previewChange(studentCtx, 'ace');

    expect(gateway.changePlan).not.toHaveBeenCalled();
    expect(repository.setPendingPlan).not.toHaveBeenCalled();
    expect(repository.clearPendingPlanIfApplied).not.toHaveBeenCalled();
  });

  it('propagates a provider preview failure instead of an estimate', async () => {
    vi.mocked(gateway.previewChange).mockResolvedValueOnce(failure('SERVICE_UNAVAILABLE'));

    await expect(service.previewChange(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(repository.setPendingPlan).not.toHaveBeenCalled();
  });

  it('rejects the current plan without asking the provider', async () => {
    await expect(service.previewChange(studentCtx, 'spark')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(gateway.previewChange).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for the mock driver without reading a subscription', async () => {
    const mockService = new BillingService(createGateway('mock'), repository);

    await expect(mockService.previewChange(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
  });

  it('requires a mapped target price, like the confirmed change', async () => {
    vi.mocked(repository.findListedPrice).mockResolvedValueOnce(success(null));

    await expect(service.previewChange(studentCtx, 'ace')).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(gateway.previewChange).not.toHaveBeenCalled();
  });

  it('uses an organization owner when the caller holds org.billing.manage', async () => {
    const managerCtx: RequestContext = {
      ...studentCtx,
      userId: 'u-9',
      accountType: AccountType.MANAGER,
      activeOrgId: 'org-1',
      permissionScopes: { 'org.billing.manage': 'organization' },
    };
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(
      success(activeSubscription({ planKey: 'hub' })),
    );

    await service.previewChange(managerCtx, 'campus');

    expect(repository.findActiveSubscription).toHaveBeenCalledWith(
      { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      false,
    );
  });
});

describe('BillingService.changePlan resume', () => {
  it('passes the scheduled-cancellation flag to a confirmed change', async () => {
    const gateway = createGateway();
    const repository = createRepository({
      findActiveSubscription: vi
        .fn()
        .mockResolvedValue(success(activeSubscription({ cancelAtPeriodEnd: true }))),
    });
    const service = new BillingService(gateway, repository);

    await service.changePlan(studentCtx, 'ace');

    expect(gateway.changePlan).toHaveBeenCalledWith(expect.objectContaining({ resume: true }));
  });
});
