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
    cancelAtPeriodEnd: vi
      .fn<PaymentGateway['cancelAtPeriodEnd']>()
      .mockImplementation((input) => Promise.resolve(success({ cancelAtPeriodEnd: input.cancel }))),
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
    ...overrides,
  });
}

describe('BillingService.cancelSubscription', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository);
  });

  it('schedules cancellation at period end', async () => {
    const result = await service.cancelSubscription(studentCtx, true);

    expect(result).toEqual(success({ cancelAtPeriodEnd: true }));
    expect(gateway.cancelAtPeriodEnd).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      cancel: true,
    });
  });

  it('reactivates before the period ends', async () => {
    await expect(service.cancelSubscription(studentCtx, false)).resolves.toEqual(
      success({ cancelAtPeriodEnd: false }),
    );
    expect(gateway.cancelAtPeriodEnd).toHaveBeenCalledWith(
      expect.objectContaining({ cancel: false }),
    );
  });

  it('re-checks org admin and uses the organization owner', async () => {
    await service.cancelSubscription(managerCtx, true);

    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
    expect(gateway.cancelAtPeriodEnd).toHaveBeenCalledWith({
      owner: { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      cancel: true,
    });
  });

  it('refuses a non-admin org caller without touching Stripe', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));

    await expect(service.cancelSubscription(managerCtx, true)).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.findActiveSubscription).not.toHaveBeenCalled();
    expect(gateway.cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when there is no active subscription', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(success(null));

    await expect(service.cancelSubscription(studentCtx, true)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('propagates a subscription read failure', async () => {
    vi.mocked(repository.findActiveSubscription).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.cancelSubscription(studentCtx, true)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('propagates a customer lookup failure', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.cancelSubscription(studentCtx, true)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
    expect(gateway.cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when there is no customer mapping', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(success(null));

    await expect(service.cancelSubscription(studentCtx, true)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('propagates a gateway failure', async () => {
    vi.mocked(gateway.cancelAtPeriodEnd).mockResolvedValueOnce(failure('SERVICE_UNAVAILABLE'));

    await expect(service.cancelSubscription(studentCtx, true)).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });

  it('clears a scheduled-downgrade marker when the gateway released the schedule', async () => {
    vi.mocked(gateway.cancelAtPeriodEnd).mockResolvedValueOnce(
      success({ cancelAtPeriodEnd: true, releasedSchedule: true }),
    );

    await service.cancelSubscription(studentCtx, true);

    expect(repository.setPendingPlan).toHaveBeenCalledWith('sub_1', null);
  });

  it('keeps the pending-payment marker when no schedule was released', async () => {
    await service.cancelSubscription(studentCtx, true);

    expect(repository.setPendingPlan).not.toHaveBeenCalled();
  });

  it('never writes a plan or entitlement from the API route', async () => {
    await service.cancelSubscription(studentCtx, true);

    // The mirror and entitlement are updated only by the webhook.
    expect(repository.setPendingPlan).not.toHaveBeenCalled();
    expect(repository.findListedPrice).not.toHaveBeenCalled();
    expect(repository.getPlan).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND for the mock driver', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await expect(service.cancelSubscription(studentCtx, true)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
  });
});
