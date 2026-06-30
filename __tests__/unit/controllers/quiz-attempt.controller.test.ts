import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { quizAttemptController } from '@/server/controllers/quiz-attempt.controller';
import { quizAttemptService } from '@/server/services';

vi.mock('@/server/services', () => ({
  quizAttemptService: {
    list: vi.fn(),
    getById: vi.fn(),
    submit: vi.fn(),
  },
}));

const mockService = vi.mocked(quizAttemptService);

describe('QuizAttemptController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('returns attempts when service succeeds', async () => {
      const attempts = [{ id: 'a-1', score: 5 }];
      mockService.list.mockResolvedValueOnce(attempts);

      const response = await quizAttemptController.list(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: attempts });
    });

    it('returns error when service throws', async () => {
      mockService.list.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await quizAttemptController.list(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.list.mockRejectedValueOnce(new Error('unexpected'));

      const response = await quizAttemptController.list(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getDetails', () => {
    it('returns attempt details when found', async () => {
      const attempt = { id: 'a-1', questions: [], answers: {} };
      mockService.getById.mockResolvedValueOnce(attempt);

      const response = await quizAttemptController.getDetails('a-1', userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: attempt });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await quizAttemptController.getDetails('nonexistent', userId);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await quizAttemptController.getDetails('a-1', userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('submit', () => {
    it('returns success when service submits successfully', async () => {
      const body = {
        answers: [
          {
            questionId: '550e8400-e29b-41d4-a716-446655440001',
            selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002',
          },
        ],
      };
      const result = { score: 1, totalQuestions: 1 };
      mockService.submit.mockResolvedValueOnce(result);

      const response = await quizAttemptController.submit(
        body,
        '550e8400-e29b-41d4-a716-446655440000',
        userId,
      );

      expect(response).toEqual({ success: true, statusCode: 200, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await quizAttemptController.submit(
        { answers: [{ questionId: 'not-a-uuid' }] },
        '550e8400-e29b-41d4-a716-446655440000',
        userId,
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.submit.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await quizAttemptController.submit(
        {
          answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001' }],
        },
        '550e8400-e29b-41d4-a716-446655440000',
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.submit.mockRejectedValueOnce(new Error('unexpected'));

      const response = await quizAttemptController.submit(
        {
          answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001' }],
        },
        '550e8400-e29b-41d4-a716-446655440000',
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
