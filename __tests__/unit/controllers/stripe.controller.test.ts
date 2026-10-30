import type { RequestContext } from '@studiq/authz';
import { StripeController } from '@studiq/server/controllers/stripe.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockGateway() {
  return {
    driver: 'mock' as const,
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    changePlan: vi.fn(),
    cancelAtPeriodEnd: vi.fn(),
    handleWebhook: vi.fn(),
  };
}

let gateway: ReturnType<typeof createMockGateway>;
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
    controller = new StripeController(gateway as any);
  });

  describe('createCheckoutSession', () => {
    it('returns 400 without a planId', async () => {
      const response = await controller.createCheckoutSession(mockCtx, {});
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('passes the authenticated actor and plan to the gateway', async () => {
      gateway.createCheckoutSession.mockResolvedValueOnce({
        success: true,
        data: { url: 'u', sessionId: 's' },
      });
      const response = await controller.createCheckoutSession(mockCtx, { planId: 'spark' });
      expect(response.success).toBe(true);
      expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          accountType: 'student',
          planKey: 'spark',
          idempotencyKey: expect.any(String),
        }),
      );
    });

    it('passes the target organization through', async () => {
      gateway.createCheckoutSession.mockResolvedValueOnce({
        success: true,
        data: { url: 'u', sessionId: 's' },
      });
      await controller.createCheckoutSession(mockCtx, { planId: 'hub', orgId: 'org-1' });
      expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ planKey: 'hub', orgId: 'org-1' }),
      );
    });

    it('returns 403 when the plan does not match the account type', async () => {
      gateway.createCheckoutSession.mockResolvedValueOnce({
        success: false,
        error: 'FORBIDDEN',
      });
      const response = await controller.createCheckoutSession(mockCtx, { planId: 'campus' });
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
