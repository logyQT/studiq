import { AccountType, type RequestContext } from '@studiq/authz';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type {
  ActiveSubscription,
  StripeBillingRepository,
} from '@studiq/server/lib/payment/stripe-repository';
import { failure, success } from '@studiq/server/lib/service-result';
import { BillingService } from '@studiq/server/services/billing.service';
import { asJson } from '#test/helpers/json';
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

function activeSubscription(overrides: Partial<ActiveSubscription> = {}): ActiveSubscription {
  return {
    stripeSubscriptionId: 'sub_1',
    status: 'active',
    planKey: 'hub',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z',
    pendingPlanKey: 'starter',
    ...overrides,
  };
}

function createGateway(driver: 'mock' | 'stripe' = 'stripe'): PaymentGateway {
  return {
    driver,
    livemode: false,
    createCheckoutSession: vi.fn<PaymentGateway['createCheckoutSession']>(),
    createPortalSession: vi.fn<PaymentGateway['createPortalSession']>(),
    changePlan: vi.fn<PaymentGateway['changePlan']>(),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
    releaseScheduledPlan: vi
      .fn<PaymentGateway['releaseScheduledPlan']>()
      .mockResolvedValue(success({ released: true })),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  };
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi.fn(),
    isOrgAdmin: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn().mockResolvedValue(success({ stripeCustomerId: 'cus_1' })),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi.fn(),
    findActiveSubscription: vi.fn().mockResolvedValue(success(activeSubscription())),
    setPendingPlan: vi.fn().mockResolvedValue(success(undefined)),
    clearPendingPlanIfApplied: vi.fn().mockResolvedValue(success(undefined)),
    ...overrides,
  });
}

describe('BillingService.releaseScheduledChange ("keep current plan")', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository);
  });

  it('releases the schedule and clears the display marker', async () => {
    const result = await service.releaseScheduledChange(studentCtx);

    expect(result).toEqual(success({ released: true }));
    expect(gateway.releaseScheduledPlan).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      currentPlanKey: 'hub',
    });
    expect(repository.clearPendingPlanIfApplied).toHaveBeenCalledWith('sub_1', 'starter');
  });

  it('re-checks org admin and uses the organization owner', async () => {
    await service.releaseScheduledChange(managerCtx);

    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
    expect(gateway.releaseScheduledPlan).toHaveBeenCalledWith({
      owner: { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      currentPlanKey: 'hub',
    });
  });

  it('refuses a non-admin org caller without touching Stripe', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));

    await expect(service.releaseScheduledChange(managerCtx)).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(gateway.releaseScheduledPlan).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when there is no active subscription', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(success(null));

    await expect(service.releaseScheduledChange(studentCtx)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.releaseScheduledPlan).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no Stripe customer mapping exists', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(success(null));

    await expect(service.releaseScheduledChange(studentCtx)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.releaseScheduledPlan).not.toHaveBeenCalled();
  });

  it('does not clear the marker when there was no schedule (pending payment)', async () => {
    vi.mocked(gateway.releaseScheduledPlan).mockResolvedValueOnce(success({ released: false }));

    await expect(service.releaseScheduledChange(studentCtx)).resolves.toEqual(
      success({ released: false }),
    );
    expect(repository.clearPendingPlanIfApplied).not.toHaveBeenCalled();
  });

  it('keeps a successful release when the display marker write fails', async () => {
    vi.mocked(repository.clearPendingPlanIfApplied).mockResolvedValueOnce(
      failure('INTERNAL_SERVER'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(service.releaseScheduledChange(studentCtx)).resolves.toEqual(
      success({ released: true }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('billing.pending_plan_marker_failed'),
    );

    warn.mockRestore();
  });

  it('propagates a provider failure without clearing the marker', async () => {
    vi.mocked(gateway.releaseScheduledPlan).mockResolvedValueOnce(failure('SERVICE_UNAVAILABLE'));

    await expect(service.releaseScheduledChange(studentCtx)).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
    expect(repository.clearPendingPlanIfApplied).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND for the mock driver without any reads', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await expect(service.releaseScheduledChange(studentCtx)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
  });
});
