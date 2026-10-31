import type { RequestContext } from '@studiq/authz';
import { StripeController } from '@studiq/server/controllers/stripe.controller';
import type { BillingService } from '@studiq/server/services/billing.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockGateway() {
  return {
    driver: 'mock' as const,
    livemode: false,
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    changePlan: vi.fn(),
    cancelAtPeriodEnd: vi.fn(),
    handleWebhook: vi.fn(),
  };
}

function createMockBilling() {
  return { startCheckout: vi.fn() };
}

let gateway: ReturnType<typeof createMockGateway>;
let billing: ReturnType<typeof createMockBilling>;
let controller: StripeController;
const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: 'student' as any,
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
    controller = new StripeController(gateway as any, billing as unknown as BillingService);
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
      await controller.handleWebhook(mockCtx, { ...validEvent, org_id: 'org-1' });
      expect(gateway.handleWebhook.mock.calls[0][0].event).toMatchObject({ org_id: 'org-1' });
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

  describe('createPortalSession', () => {
    it('passes the authenticated identity and active org to the gateway', async () => {
      gateway.createPortalSession.mockResolvedValueOnce({
        success: true,
        data: { url: '/app/billing' },
      });
      const response = await controller.createPortalSession(mockCtx);
      expect(response.success).toBe(true);
      expect(gateway.createPortalSession).toHaveBeenCalledWith({
        userId: 'u-1',
        accountType: 'student',
        activeOrgId: null,
      });
    });
  });
});
