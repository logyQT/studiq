import type { RequestContext } from '@studiq/authz';
import { StudentInsightsController } from '@studiq/server/controllers/student-insights.controller';
import { AppError } from '@studiq/server/lib/errors';
import { success } from '@studiq/server/lib/service-result';
import type { StudentInsightsService } from '@studiq/server/services/student-insights.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asService } from '#test/helpers/service-double';

const requireEntitlementMock = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('@studiq/server/lib/entitlements', () => ({
  requireEntitlement: (...args: unknown[]) => requireEntitlementMock(...args),
}));

function createMockService() {
  return { getInsights: vi.fn() };
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student',
  orgRoleId: null,
  activeOrgId: null,
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('StudentInsightsController', () => {
  let mockService: ReturnType<typeof createMockService>;
  let controller: StudentInsightsController;

  beforeEach(() => {
    vi.clearAllMocks();
    requireEntitlementMock.mockResolvedValue(undefined);
    mockService = createMockService();
    controller = new StudentInsightsController(asService<StudentInsightsService>(mockService));
  });

  describe('entitlement gate (ADR-0015 §7, phase 5d)', () => {
    // The insights read had no permission check; the paid `stats.insights`
    // gate is its first statement, so deleting it turns the rejection below
    // into the service's 200.
    it('refuses getInsights with FORBIDDEN before the schema parse', async () => {
      requireEntitlementMock.mockRejectedValue(new AppError('FORBIDDEN'));
      mockService.getInsights.mockResolvedValueOnce(success({}));
      await expect(controller.getInsights({ days: 'not-a-number' }, mockCtx)).rejects.toMatchObject(
        {
          code: 'FORBIDDEN',
          statusCode: 403,
        },
      );
      expect(requireEntitlementMock).toHaveBeenCalledWith(mockCtx, 'stats.insights');
      expect(mockService.getInsights).not.toHaveBeenCalled();
    });

    it('an entitled caller passes the gate and reaches the service', async () => {
      const insights = { studyTime: null, retention: [], mastery: [] };
      mockService.getInsights.mockResolvedValueOnce(success(insights));
      const response = await controller.getInsights({}, mockCtx);
      expect(response).toEqual({ success: true, statusCode: 200, data: insights });
      expect(requireEntitlementMock).toHaveBeenCalledWith(mockCtx, 'stats.insights');
    });
  });
});
