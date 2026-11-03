import { AccountType, type RequestContext } from '@studiq/authz';
import { BillingController } from '@studiq/server/controllers/billing.controller';
import { success } from '@studiq/server/lib/service-result';
import type {
  BillingService,
  BillingSubscriptionView,
} from '@studiq/server/services/billing.service';
import { asService } from '#test/helpers/service-double';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

const view: BillingSubscriptionView = {
  provider: 'mock',
  planKey: 'spark',
  planName: 'StudiQ Spark',
  status: 'active',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pendingPlanKey: null,
  priceMonthly: 999,
  currency: 'PLN',
  canManagePortal: false,
  canChangePlan: false,
  canCancel: false,
  hostedInvoiceUrl: null,
};

function createMockBilling() {
  return { getSubscription: vi.fn() };
}

describe('BillingController.getSubscription', () => {
  let billing: ReturnType<typeof createMockBilling>;
  let controller: BillingController;

  beforeEach(() => {
    vi.clearAllMocks();
    billing = createMockBilling();
    controller = new BillingController(asService<BillingService>(billing));
  });

  it('returns the shared read model for the authenticated caller', async () => {
    billing.getSubscription.mockResolvedValueOnce(success(view));

    const response = await controller.getSubscription(ctx);

    expect(response).toEqual({ success: true, statusCode: 200, data: view });
    expect(billing.getSubscription).toHaveBeenCalledWith(ctx);
  });

  it('maps a service failure to its status code', async () => {
    billing.getSubscription.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

    await expect(controller.getSubscription(ctx)).resolves.toMatchObject({
      success: false,
      statusCode: 404,
      error: 'NOT_FOUND',
    });
  });
});
