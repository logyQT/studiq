import { AccountType, type RequestContext } from '@studiq/authz';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type { StripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
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
  permissionScopes: { 'org.billing.manage': 'organization' },
};

function createGateway(driver: 'mock' | 'stripe' = 'stripe'): PaymentGateway {
  return {
    driver,
    livemode: false,
    createCheckoutSession: vi.fn<PaymentGateway['createCheckoutSession']>(),
    createPortalSession: vi.fn<PaymentGateway['createPortalSession']>(),
    changePlan: vi.fn<PaymentGateway['changePlan']>(),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
    reconcileCheckout: vi
      .fn<PaymentGateway['reconcileCheckout']>()
      .mockResolvedValue(success({ activated: true })),
    releaseScheduledPlan: vi.fn<PaymentGateway['releaseScheduledPlan']>(),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  };
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi.fn(),
    canManageBilling: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn(),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi.fn(),
    findActiveSubscription: vi.fn(),
    setPendingPlan: vi.fn(),
    clearPendingPlanIfApplied: vi.fn().mockResolvedValue(success(undefined)),
    ...overrides,
  });
}

describe('BillingService.reconcileCheckout', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository);
  });

  it('delegates a personal session for the authenticated user', async () => {
    const result = await service.reconcileCheckout(studentCtx, 'cs_1');

    expect(result).toEqual(success({ activated: true }));
    expect(gateway.reconcileCheckout).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      sessionId: 'cs_1',
    });
    expect(repository.canManageBilling).not.toHaveBeenCalled();
  });

  it('requires org.billing.manage before reconciling an organization session', async () => {
    await service.reconcileCheckout(managerCtx, 'cs_org');

    expect(gateway.reconcileCheckout).toHaveBeenCalledWith({
      owner: { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      sessionId: 'cs_org',
    });
  });

  it('falls back to the personal owner when a manager has no active org', async () => {
    await service.reconcileCheckout({ ...managerCtx, activeOrgId: null }, 'cs_1');

    expect(repository.canManageBilling).not.toHaveBeenCalled();
    expect(gateway.reconcileCheckout).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-9', accountType: AccountType.MANAGER },
      sessionId: 'cs_1',
    });
  });

  it('resolves a caller without org.billing.manage to the personal owner, never the org one', async () => {
    const memberCtx: RequestContext = { ...managerCtx, permissionScopes: {} };

    await service.reconcileCheckout(memberCtx, 'cs_1');

    expect(gateway.reconcileCheckout).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-9', accountType: AccountType.MANAGER },
      sessionId: 'cs_1',
    });
  });

  it('propagates a gateway failure', async () => {
    vi.mocked(gateway.reconcileCheckout).mockResolvedValueOnce(failure('FORBIDDEN'));

    await expect(service.reconcileCheckout(studentCtx, 'cs_1')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
  });

  it('reports NOT_FOUND for the mock driver', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await expect(service.reconcileCheckout(managerCtx, 'cs_1')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(repository.canManageBilling).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND on the mock driver for a caller without org.billing.manage (personal owner, no provider action)', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);
    const memberCtx: RequestContext = { ...managerCtx, permissionScopes: {} };

    await expect(service.reconcileCheckout(memberCtx, 'cs_1')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.reconcileCheckout).not.toHaveBeenCalled();
  });
});
