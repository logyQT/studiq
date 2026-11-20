import { AccountType, type RequestContext } from '@studiq/authz';
import { StatsController } from '@studiq/server/controllers/stats.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { StatsService } from '@studiq/server/services/stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockStatsService() {
  // The mocked methods never touch the database, so the client factory only
  // has to satisfy the constructor's type.
  return Object.assign(new StatsService(() => Promise.reject(new Error('unused'))), {
    getTeacherStats: vi.fn(),
    getStudentStats: vi.fn(),
    getTeacherQuizStats: vi.fn(),
  });
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.EDUCATOR,
  orgRoleId: 'role-1',
  activeOrgId: 'org-1',
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: { 'stats.read': 'group' },
};

describe('StatsController', () => {
  let mockService: ReturnType<typeof createMockStatsService>;
  let controller: StatsController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockStatsService();
    controller = new StatsController(mockService);
  });

  describe('getTeacherStats', () => {
    it('returns teacher stats', async () => {
      const stats = { totalQuestions: 10, totalFlashcards: 5 };
      mockService.getTeacherStats.mockResolvedValueOnce(success(stats));

      const response = await controller.getTeacherStats({}, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
      expect(mockService.getTeacherStats).toHaveBeenCalledWith(mockCtx, {});
    });

    it('forwards a valid subjectId', async () => {
      const subjectId = '00000000-0000-4000-8020-000000000005';
      mockService.getTeacherStats.mockResolvedValueOnce(success({ totalQuestions: 1 }));

      await controller.getTeacherStats({ subjectId }, mockCtx);

      expect(mockService.getTeacherStats).toHaveBeenCalledWith(mockCtx, { subjectId });
    });

    it('rejects a non-UUID subjectId without calling the service', async () => {
      const response = await controller.getTeacherStats({ subjectId: 'not-a-uuid' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.getTeacherStats).not.toHaveBeenCalled();
    });

    it('returns error when service returns failure', async () => {
      mockService.getTeacherStats.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getTeacherStats({}, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getStudentStats', () => {
    it('returns student stats', async () => {
      const stats = {
        totalQuizzes: 5,
        avgScore: 80,
        totalQuestionsCreated: 10,
        flashcardsPracticed: 20,
        flashcardAccuracy: 75,
        attemptsOverTime: [],
      };
      mockService.getStudentStats.mockResolvedValueOnce(success(stats));

      const response = await controller.getStudentStats(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service returns failure', async () => {
      mockService.getStudentStats.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getStudentStats(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getTeacherQuizStats', () => {
    it('returns aggregated quiz stats', async () => {
      const stats = [
        { id: 'Quiz A', title: 'Quiz A', totalAttempts: 2, avgScore: 7, avgCompletionRate: 100 },
      ];
      mockService.getTeacherQuizStats.mockResolvedValueOnce(success(stats));

      const response = await controller.getTeacherQuizStats(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service returns failure', async () => {
      mockService.getTeacherQuizStats.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getTeacherQuizStats(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('permission gate (ADR-0015 §7, phase 2b-6)', () => {
    it('a caller inside an org without stats.read is 403 on every teacher read', async () => {
      const ctx = { ...mockCtx, permissionScopes: {} };
      for (const call of [
        () => controller.getTeacherStats({}, ctx),
        () => controller.getTeacherQuizStats(ctx),
        () => controller.getTeacherGroupPerformance({}, ctx),
        () => controller.getTeacherActivityFeed({}, ctx),
      ]) {
        expect(await call()).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
      }
      expect(mockService.getTeacherStats).not.toHaveBeenCalled();
      expect(mockService.getTeacherQuizStats).not.toHaveBeenCalled();
    });

    it.each(['own', 'group', 'organization'] as const)(
      'a caller holding stats.read at %s scope is allowed',
      async (scope) => {
        mockService.getTeacherQuizStats.mockResolvedValueOnce(success([]));
        const response = await controller.getTeacherQuizStats({
          ...mockCtx,
          permissionScopes: { 'stats.read': scope },
        });
        expect(response).toEqual({ success: true, statusCode: 200, data: [] });
      },
    );

    it('a student-persona holder of the key is allowed (D13)', async () => {
      mockService.getTeacherStats.mockResolvedValueOnce(success({ totalQuestions: 0 }));
      const response = await controller.getTeacherStats(
        {},
        {
          ...mockCtx,
          accountType: AccountType.STUDENT,
          permissionScopes: { 'stats.read': 'own' },
        },
      );
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: { totalQuestions: 0 },
      });
    });

    it('the student reads stay ungated', async () => {
      mockService.getStudentStats.mockResolvedValueOnce(success({ totalQuizzes: 0 }));
      const response = await controller.getStudentStats({ ...mockCtx, permissionScopes: {} });
      expect(response).toEqual({ success: true, statusCode: 200, data: { totalQuizzes: 0 } });
    });
  });
});
