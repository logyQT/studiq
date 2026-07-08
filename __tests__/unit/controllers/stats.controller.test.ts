import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success, failure } from '@/lib/service-result';
import { StatsController } from '@/server/controllers/stats.controller';
import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';

function createMockStatsService() {
  return {
    getTeacherStats: vi.fn(),
    getStudentStats: vi.fn(),
  };
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student',
  orgRoleId: null,
  activeOrgId: null,
  url: '/test',
  method: 'GET',
};

describe('StatsController', () => {
  let mockService: ReturnType<typeof createMockStatsService>;
  let controller: StatsController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockStatsService();
    controller = new StatsController(mockService as any);
  });

  describe('getTeacherStats', () => {
    it('returns teacher stats', async () => {
      const stats = { totalQuestions: 10, totalFlashcards: 5 };
      mockService.getTeacherStats.mockResolvedValueOnce(success(stats));

      const response = await controller.getTeacherStats(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service returns failure', async () => {
      mockService.getTeacherStats.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getTeacherStats(mockCtx);

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
});
