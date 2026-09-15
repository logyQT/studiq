import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionPlanController } from '@/server/controllers/subscription-plan.controller';
import type { RequestContext } from '@/lib/request-context';

function createMockService() {
  return {
    listActive: vi.fn(),
    getMyPlan: vi.fn(),
    getByKey: vi.fn(),
    getPersonalPlan: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: SubscriptionPlanController;
const mockCtx: RequestContext = {
  traceId: 'test', userId: 'u-1', accountType: 'student' as any,
  orgRoleId: null, activeOrgId: null, url: '', method: 'GET', groupIds: [], permissionScopes: {},
};

describe('SubscriptionPlanController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new SubscriptionPlanController(mockService as any);
  });

  describe('listPublic', () => {
    it('returns active plans', async () => {
      mockService.listActive.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listPublic();
      expect(response.success).toBe(true);
    });
    it('returns plans filtered by account type', async () => {
      mockService.listActive.mockResolvedValueOnce({ success: true, data: [] });
      await controller.listPublic('student');
      expect(mockService.listActive).toHaveBeenCalledWith('student');
    });
    it('returns error on failure', async () => {
      mockService.listActive.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.listPublic();
      expect(response.success).toBe(false);
    });
  });

  describe('getMyPlan', () => {
    it('returns my plan', async () => {
      mockService.getMyPlan.mockResolvedValueOnce({ success: true, data: { key: 'base' } });
      const response = await controller.getMyPlan(mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.getMyPlan.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getMyPlan(mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('getByKey', () => {
    it('returns plan by key', async () => {
      mockService.getByKey.mockResolvedValueOnce({ success: true, data: { key: 'base' } });
      const response = await controller.getByKey('base');
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.getByKey.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getByKey('nonexistent');
      expect(response.success).toBe(false);
    });
  });

  describe('getMyPersonalPlan', () => {
    it('returns personal plan', async () => {
      mockService.getPersonalPlan.mockResolvedValueOnce({ success: true, data: { key: 'free' } });
      const response = await controller.getMyPersonalPlan(mockCtx);
      expect(response.success).toBe(true);
    });
  });
});
