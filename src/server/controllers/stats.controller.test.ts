import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statsController } from './stats.controller';
import { statsService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  statsService: {
    getTeacherStats: vi.fn(),
    getStudentStats: vi.fn(),
  },
}));

const mockService = vi.mocked(statsService);

describe('StatsController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTeacherStats', () => {
    it('returns teacher stats without subjectId', async () => {
      const stats = { totalQuestions: 10, totalFlashcards: 5 };
      mockService.getTeacherStats.mockResolvedValueOnce(stats);

      const response = await statsController.getTeacherStats(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns teacher stats with subjectId', async () => {
      const stats = {
        totalQuestions: 10,
        totalFlashcards: 5,
        subject: { totalQuestions: 5, byType: {}, byDifficulty: {}, problematicQuestions: [] },
      };
      mockService.getTeacherStats.mockResolvedValueOnce(stats);

      const response = await statsController.getTeacherStats(userId, 'sub-1');

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service throws', async () => {
      mockService.getTeacherStats.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await statsController.getTeacherStats(userId);

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
      mockService.getStudentStats.mockResolvedValueOnce(stats);

      const response = await statsController.getStudentStats(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service throws', async () => {
      mockService.getStudentStats.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await statsController.getStudentStats(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
