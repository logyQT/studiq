import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityController } from '@/server/controllers/activity.controller';

function createMockService() {
  return { getClassActivity: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: ActivityController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'educator' as any,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('ActivityController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new ActivityController(mockService as any);
  });

  describe('getActivity', () => {
    it('returns activity data', async () => {
      mockService.getClassActivity.mockResolvedValueOnce({
        success: true,
        data: { activities: [] },
      });

      const response = await controller.getActivity(mockCtx, {
        groupId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 422 on invalid range', async () => {
      const response = await controller.getActivity(mockCtx, { range: 'invalid' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.getClassActivity.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.getActivity(mockCtx, {
        groupId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.success).toBe(false);
    });
  });
});
