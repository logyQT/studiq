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
  billedPlanKey: 'spark',
  billedPlanName: 'StudiQ Spark',
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
  return {
    getSubscription: vi.fn(),
    changePlan: vi.fn(),
    cancelSubscription: vi.fn(),
    reconcileCheckout: vi.fn(),
  };
}

describe('BillingController', () => {
  let billing: ReturnType<typeof createMockBilling>;
  let controller: BillingController;

  beforeEach(() => {
    vi.clearAllMocks();
    billing = createMockBilling();
    controller = new BillingController(asService<BillingService>(billing));
  });

  describe('getSubscription', () => {
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

  describe('changePlan', () => {
    it('returns 422 without a plan key', async () => {
      const response = await controller.changePlan(ctx, {});

      expect(response).toMatchObject({
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
      });
      expect(billing.changePlan).not.toHaveBeenCalled();
    });

    it('rejects an empty or oversized plan key', async () => {
      await expect(controller.changePlan(ctx, { planKey: '' })).resolves.toMatchObject({
        success: false,
        statusCode: 422,
      });
      await expect(controller.changePlan(ctx, { planKey: 'x'.repeat(65) })).resolves.toMatchObject({
        success: false,
        statusCode: 422,
      });
      expect(billing.changePlan).not.toHaveBeenCalled();
    });

    it('delegates only the target plan key', async () => {
      billing.changePlan.mockResolvedValueOnce(success({ status: 'scheduled' }));

      const response = await controller.changePlan(ctx, { planKey: 'ace' });

      expect(response).toEqual({ success: true, statusCode: 200, data: { status: 'scheduled' } });
      expect(billing.changePlan).toHaveBeenCalledWith(ctx, 'ace');
    });

    it('maps forbidden and not-found failures', async () => {
      billing.changePlan.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      await expect(controller.changePlan(ctx, { planKey: 'hub' })).resolves.toMatchObject({
        success: false,
        statusCode: 403,
      });

      billing.changePlan.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      await expect(controller.changePlan(ctx, { planKey: 'ace' })).resolves.toMatchObject({
        success: false,
        statusCode: 404,
      });
    });
  });

  describe('reconcileCheckout', () => {
    it('returns 422 without a session id', async () => {
      const response = await controller.reconcileCheckout(ctx, {});

      expect(response).toMatchObject({
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
      });
      expect(billing.reconcileCheckout).not.toHaveBeenCalled();
    });

    it('rejects an oversized session id', async () => {
      const response = await controller.reconcileCheckout(ctx, { sessionId: 'x'.repeat(256) });

      expect(response).toMatchObject({ success: false, statusCode: 422 });
      expect(billing.reconcileCheckout).not.toHaveBeenCalled();
    });

    it('delegates the session id', async () => {
      billing.reconcileCheckout.mockResolvedValueOnce(success({ activated: true }));

      const response = await controller.reconcileCheckout(ctx, { sessionId: 'cs_1' });

      expect(response).toEqual({ success: true, statusCode: 200, data: { activated: true } });
      expect(billing.reconcileCheckout).toHaveBeenCalledWith(ctx, 'cs_1');
    });

    it('maps a foreign session to 403', async () => {
      billing.reconcileCheckout.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      await expect(controller.reconcileCheckout(ctx, { sessionId: 'cs_1' })).resolves.toMatchObject(
        { success: false, statusCode: 403, error: 'FORBIDDEN' },
      );
    });
  });

  describe('cancelSubscription', () => {
    it('returns 422 without the cancel flag', async () => {
      const response = await controller.cancelSubscription(ctx, {});

      expect(response).toMatchObject({
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
      });
      expect(billing.cancelSubscription).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean cancel flag', async () => {
      const response = await controller.cancelSubscription(ctx, { cancel: 'true' });

      expect(response).toMatchObject({ success: false, statusCode: 422 });
      expect(billing.cancelSubscription).not.toHaveBeenCalled();
    });

    it('maps not-found failures', async () => {
      billing.cancelSubscription.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

      await expect(controller.cancelSubscription(ctx, { cancel: true })).resolves.toMatchObject({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('delegates cancel and reactivate', async () => {
      billing.cancelSubscription.mockResolvedValueOnce(success({ cancelAtPeriodEnd: true }));
      await controller.cancelSubscription(ctx, { cancel: true });
      expect(billing.cancelSubscription).toHaveBeenCalledWith(ctx, true);

      billing.cancelSubscription.mockResolvedValueOnce(success({ cancelAtPeriodEnd: false }));
      const response = await controller.cancelSubscription(ctx, { cancel: false });
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: { cancelAtPeriodEnd: false },
      });
      expect(billing.cancelSubscription).toHaveBeenCalledWith(ctx, false);
    });

    it('maps forbidden failures', async () => {
      billing.cancelSubscription.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      await expect(controller.cancelSubscription(ctx, { cancel: true })).resolves.toMatchObject({
        success: false,
        statusCode: 403,
      });
    });
  });
});
