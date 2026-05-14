import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quizController } from './quiz.controller';
import { quizService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  quizService: {
    generateQuiz: vi.fn(),
  },
}));

const mockService = vi.mocked(quizService);

describe('QuizController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('returns success when service generates successfully', async () => {
      const body = { questionTypes: ['mcq'], questionCount: 10 };
      const result = { id: 'attempt-1', questions: [] };
      mockService.generateQuiz.mockResolvedValueOnce(result);

      const response = await quizController.generate(body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await quizController.generate(
        { questionTypes: [], questionCount: 0 },
        userId,
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.generateQuiz.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await quizController.generate(
        { questionTypes: ['mcq'], questionCount: 10 },
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws unknown error', async () => {
      mockService.generateQuiz.mockRejectedValueOnce(new Error('db error'));

      const response = await quizController.generate(
        { questionTypes: ['mcq'], questionCount: 10 },
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
