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
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  };
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi.fn(),
    isOrgAdmin: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn(),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi.fn(),
    findActiveSubscription: vi.fn(),
    setPendingPlan: vi.fn(),
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
    expect(repository.isOrgAdmin).not.toHaveBeenCalled();
  });

  it('re-checks org admin before reconciling an organization session', async () => {
    await service.reconcileCheckout(managerCtx, 'cs_org');

    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
    expect(gateway.reconcileCheckout).toHaveBeenCalledWith({
      owner: { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      sessionId: 'cs_org',
    });
  });

  it('falls back to the personal owner when a manager has no active org', async () => {
    await service.reconcileCheckout({ ...managerCtx, activeOrgId: null }, 'cs_1');

    expect(repository.isOrgAdmin).not.toHaveBeenCalled();
    expect(gateway.reconcileCheckout).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-9', accountType: AccountType.MANAGER },
      sessionId: 'cs_1',
    });
  });

  it('refuses a non-admin organization caller', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));

    await expect(service.reconcileCheckout(managerCtx, 'cs_org')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(gateway.reconcileCheckout).not.toHaveBeenCalled();
  });

  it('propagates an org membership read failure', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.reconcileCheckout(managerCtx, 'cs_org')).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('propagates a gateway failure', async () => {
    vi.mocked(gateway.reconcileCheckout).mockResolvedValueOnce(failure('FORBIDDEN'));

    await expect(service.reconcileCheckout(studentCtx, 'cs_1')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
  });

  it('reports NOT_FOUND for the mock driver without an org admin lookup', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository);

    await expect(service.reconcileCheckout(managerCtx, 'cs_1')).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(repository.isOrgAdmin).not.toHaveBeenCalled();
  });
});
