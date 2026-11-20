import { AccountType, type RequestContext } from '@studiq/authz';
import { ActivityController } from '@studiq/server/controllers/activity.controller';
import type { ActivityService } from '@studiq/server/services/activity.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success } from '@studiq/server/lib/service-result';
import { asService } from '#test/helpers/service-double';

function createMockService() {
  return { getClassActivity: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: ActivityController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.EDUCATOR,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: { 'stats.read': 'group' },
};

describe('ActivityController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new ActivityController(asService<ActivityService>(mockService));
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

  describe('permission gate (ADR-0015 §7, phase 2b-6)', () => {
    it.each(['own', 'group', 'organization'] as const)(
      'a caller holding stats.read at %s scope is allowed',
      async (scope) => {
        mockService.getClassActivity.mockResolvedValueOnce(success([]));
        const response = await controller.getActivity(
          { ...mockCtx, permissionScopes: { 'stats.read': scope } },
          {},
        );
        expect(response).toEqual({ success: true, statusCode: 200, data: [] });
      },
    );

    it('a caller without stats.read is 403 and the service is never called', async () => {
      const response = await controller.getActivity({ ...mockCtx, permissionScopes: {} }, {});
      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
      expect(mockService.getClassActivity).not.toHaveBeenCalled();
    });

    it('a student-persona holder of the key is allowed (D13)', async () => {
      mockService.getClassActivity.mockResolvedValueOnce(success([]));
      const response = await controller.getActivity(
        { ...mockCtx, accountType: AccountType.STUDENT, permissionScopes: { 'stats.read': 'own' } },
        {},
      );
      expect(response).toEqual({ success: true, statusCode: 200, data: [] });
    });
  });
});
