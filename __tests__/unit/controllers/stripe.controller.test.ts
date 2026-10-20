import type { RequestContext } from '@studiq/authz';
import { StripeController } from '@studiq/server/controllers/stripe.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return {
    createCheckoutSession: vi.fn(),
    handleWebhook: vi.fn(),
    createPortalSession: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
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
    mockService = createMockService();
    controller = new StripeController(mockService as any);
  });

  describe('createCheckoutSession', () => {
    it('returns 400 without a planId', async () => {
      const response = await controller.createCheckoutSession(mockCtx, {});
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect(mockService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('passes the caller account type to the service', async () => {
      mockService.createCheckoutSession.mockResolvedValueOnce({
        success: true,
        data: { url: 'u', sessionId: 's' },
      });
      const response = await controller.createCheckoutSession(mockCtx, { planId: 'spark' });
      expect(response.success).toBe(true);
      expect(mockService.createCheckoutSession).toHaveBeenCalledWith(
        'spark',
        'student',
        'u-1',
        undefined,
      );
    });

    it('returns 403 when the plan does not match the account type', async () => {
      mockService.createCheckoutSession.mockResolvedValueOnce({
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
      expect(mockService.handleWebhook).not.toHaveBeenCalled();
    });

    it("rejects an event for another user's account (#192)", async () => {
      const response = await controller.handleWebhook(mockCtx, {
        ...validEvent,
        user_id: 'someone-else',
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect(mockService.handleWebhook).not.toHaveBeenCalled();
    });

    it("applies the caller's own event and passes the account type", async () => {
      mockService.handleWebhook.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.handleWebhook(mockCtx, validEvent);
      expect(response.success).toBe(true);
      expect(mockService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: 'spark', user_id: 'u-1' }),
        'student',
      );
    });

    it('returns 403 when the plan is not meant for the account type', async () => {
      mockService.handleWebhook.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.handleWebhook(mockCtx, {
        ...validEvent,
        plan_id: 'campus',
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });
  });
});
