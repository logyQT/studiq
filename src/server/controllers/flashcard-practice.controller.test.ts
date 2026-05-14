import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardPracticeController } from './flashcard-practice.controller';
import { flashcardPracticeService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  flashcardPracticeService: {
    log: vi.fn(),
    getHistory: vi.fn(),
  },
}));

const mockService = vi.mocked(flashcardPracticeService);

describe('FlashcardPracticeController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('log', () => {
    it('returns success when service logs successfully', async () => {
      const body = {
        flashcardId: '550e8400-e29b-41d4-a716-446655440000',
        wasCorrect: true,
      };
      const result = { id: 'p-1', flashcard_id: body.flashcardId, was_correct: true };
      mockService.log.mockResolvedValueOnce(result);

      const response = await flashcardPracticeController.log(body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardPracticeController.log(
        { flashcardId: 'not-a-uuid', wasCorrect: true },
        userId,
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.log.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.log(
        { flashcardId: '550e8400-e29b-41d4-a716-446655440000', wasCorrect: true },
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getHistory', () => {
    it('returns practice history for user', async () => {
      const history = [{ id: 'p-1', flashcard_id: 'fc-1', was_correct: true }];
      mockService.getHistory.mockResolvedValueOnce(history);

      const response = await flashcardPracticeController.getHistory(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: history });
    });

    it('returns error when service throws', async () => {
      mockService.getHistory.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.getHistory(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
