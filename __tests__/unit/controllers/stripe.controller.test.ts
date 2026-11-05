import { AccountType, type RequestContext } from '@studiq/authz';
import { StripeController } from '@studiq/server/controllers/stripe.controller';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type { BillingService } from '@studiq/server/services/billing.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asService } from '#test/helpers/service-double';

function createMockGateway() {
  return {
    driver: 'mock' as const,
    livemode: false,
    createCheckoutSession: vi.fn<PaymentGateway['createCheckoutSession']>(),
    createPortalSession: vi.fn<PaymentGateway['createPortalSession']>(),
    changePlan: vi.fn<PaymentGateway['changePlan']>(),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
    releaseScheduledPlan: vi.fn<PaymentGateway['releaseScheduledPlan']>(),
    reconcileCheckout: vi.fn<PaymentGateway['reconcileCheckout']>(),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  } satisfies PaymentGateway;
}

function createMockBilling() {
  return { startCheckout: vi.fn(), createPortalSession: vi.fn() };
}

let gateway: ReturnType<typeof createMockGateway>;
let billing: ReturnType<typeof createMockBilling>;
let controller: StripeController;
const mockCtx: RequestContext = {
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

const validEvent = {
  type: 'checkout.session.completed',
  session_id: 's-1',
  plan_id: 'spark',
  user_id: 'u-1',
};

describe('StripeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createMockGateway();
    billing = createMockBilling();
    controller = new StripeController(gateway, asService<BillingService>(billing));
  });

  describe('createCheckoutSession', () => {
    it('returns 422 without a planKey', async () => {
      const response = await controller.createCheckoutSession(mockCtx, {});
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('returns 422 for a null or malformed body instead of throwing', async () => {
      await expect(controller.createCheckoutSession(mockCtx, null)).resolves.toMatchObject({
        success: false,
        statusCode: 422,
      });
      await expect(
        controller.createCheckoutSession(mockCtx, { planKey: '', orgId: 'not-a-uuid' }),
      ).resolves.toMatchObject({ success: false, statusCode: 422 });
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('delegates plan, org and locale to BillingService', async () => {
      billing.startCheckout.mockResolvedValueOnce({
        success: true,
        data: { url: 'u', sessionId: 's' },
      });

      const response = await controller.createCheckoutSession(mockCtx, {
        planKey: 'spark',
        locale: 'en',
      });

      expect(response.success).toBe(true);
      expect(billing.startCheckout).toHaveBeenCalledWith(mockCtx, 'spark', undefined, 'en');
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('passes the target organization through', async () => {
      const orgId = '00000000-0000-4000-8000-000000000001';
      billing.startCheckout.mockResolvedValueOnce({
        success: true,
        data: { url: 'u', sessionId: 's' },
      });

      await controller.createCheckoutSession(mockCtx, { planKey: 'hub', orgId });

      expect(billing.startCheckout).toHaveBeenCalledWith(mockCtx, 'hub', orgId, 'pl');
    });

    it('returns 403 when the plan does not match the account type', async () => {
      billing.startCheckout.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.createCheckoutSession(mockCtx, { planKey: 'campus' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('handleWebhook', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await controller.handleWebhook(mockCtx, { type: 'x' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect(gateway.handleWebhook).not.toHaveBeenCalled();
    });

    it("rejects an event for another user's account (#192)", async () => {
      const response = await controller.handleWebhook(mockCtx, {
        ...validEvent,
        user_id: 'someone-else',
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect(gateway.handleWebhook).not.toHaveBeenCalled();
    });

    it("applies the caller's own event through the mock envelope", async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: true, data: { received: true } });
      const response = await controller.handleWebhook(mockCtx, validEvent);
      expect(response.success).toBe(true);
      expect(gateway.handleWebhook).toHaveBeenCalledWith({
        kind: 'mock',
        ctx: mockCtx,
        event: {
          type: 'checkout.session.completed',
          session_id: 's-1',
          plan_id: 'spark',
        },
      });
    });

    it('never forwards the body user_id to the gateway (#227)', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: true, data: { received: true } });
      await controller.handleWebhook(mockCtx, validEvent);
      expect(gateway.handleWebhook.mock.calls[0][0].event).not.toHaveProperty('user_id');
    });

    it('passes org_id through when present', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: true, data: { received: true } });
      await controller.handleWebhook(mockCtx, {
        ...validEvent,
        org_id: '00000000-0000-4000-8000-000000000001',
      });
      expect(gateway.handleWebhook.mock.calls[0][0].event).toMatchObject({
        org_id: '00000000-0000-4000-8000-000000000001',
      });
    });

    it('rejects a malformed org_id with 400 instead of a database error', async () => {
      const response = await controller.handleWebhook(mockCtx, { ...validEvent, org_id: 'org-1' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect(gateway.handleWebhook).not.toHaveBeenCalled();
    });

    it('returns 403 when the plan is not meant for the account type', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.handleWebhook(mockCtx, {
        ...validEvent,
        plan_id: 'campus',
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('handleStripeWebhook', () => {
    it('forwards the raw body and signature as a stripe envelope, without a session', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: true, data: { received: true } });

      const response = await controller.handleStripeWebhook('raw-body', 'sig-header');

      expect(response).toEqual({ success: true, statusCode: 200, data: { received: true } });
      expect(gateway.handleWebhook).toHaveBeenCalledWith({
        kind: 'stripe',
        rawBody: 'raw-body',
        signature: 'sig-header',
      });
    });

    it('maps an invalid signature to 400', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: false, error: 'BAD_REQUEST' });

      const response = await controller.handleStripeWebhook('raw-body', null);

      expect(response).toEqual({
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      });
    });

    it('maps a transient failure to a retryable status', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.handleStripeWebhook('raw-body', 'sig');

      expect(response).toMatchObject({ success: false, statusCode: 500 });
    });
  });

  describe('createPortalSession', () => {
    it('resolves the owner server-side and passes the default locale', async () => {
      billing.createPortalSession.mockResolvedValueOnce({
        success: true,
        data: { url: 'https://billing.stripe.com/session' },
      });

      const response = await controller.createPortalSession(mockCtx, {});

      expect(response.success).toBe(true);
      expect(billing.createPortalSession).toHaveBeenCalledWith(mockCtx, 'pl');
      expect(gateway.createPortalSession).not.toHaveBeenCalled();
    });

    it('forwards a validated locale', async () => {
      billing.createPortalSession.mockResolvedValueOnce({
        success: true,
        data: { url: 'https://billing.stripe.com/session' },
      });

      await controller.createPortalSession(mockCtx, { locale: 'en' });

      expect(billing.createPortalSession).toHaveBeenCalledWith(mockCtx, 'en');
    });

    it('rejects an unknown locale with 422 instead of forwarding it', async () => {
      const response = await controller.createPortalSession(mockCtx, { locale: 'de' });

      expect(response).toMatchObject({ success: false, statusCode: 422 });
      expect(billing.createPortalSession).not.toHaveBeenCalled();
    });

    it('maps a missing billing account to 404 and a foreign owner to 403', async () => {
      billing.createPortalSession.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      await expect(controller.createPortalSession(mockCtx, {})).resolves.toMatchObject({
        success: false,
        statusCode: 404,
      });

      billing.createPortalSession.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      await expect(controller.createPortalSession(mockCtx, {})).resolves.toMatchObject({
        success: false,
        statusCode: 403,
      });
    });
  });
});
