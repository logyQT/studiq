import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardPracticeController } from './flashcard-practice.controller';
import { flashcardPracticeService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  flashcardPracticeService: {
    log: vi.fn(),
    getHistory: vi.fn(),
    getHistoryForFlashcard: vi.fn(),
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
      const body = { wasCorrect: true };
      const result = { id: 'p-1', flashcard_id: 'fc-1', was_correct: true };
      mockService.log.mockResolvedValueOnce(result);

      const response = await flashcardPracticeController.log('fc-1', body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns success with optional fields', async () => {
      const body = { wasCorrect: true, responseTimeMs: 1500, confidenceLevel: 4 };
      const result = { id: 'p-1', flashcard_id: 'fc-1', was_correct: true, response_time_ms: 1500, confidence_level: 4 };
      mockService.log.mockResolvedValueOnce(result);

      const response = await flashcardPracticeController.log('fc-1', body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardPracticeController.log('fc-1', { responseTimeMs: 1000 }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.log.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.log('fc-1', { wasCorrect: true }, userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.log.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardPracticeController.log('fc-1', { wasCorrect: true }, userId);

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

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getHistory.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardPracticeController.getHistory(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getHistoryForFlashcard', () => {
    it('returns practice history for user on specific flashcard', async () => {
      const history = [{ id: 'p-1', flashcard_id: 'fc-1', was_correct: true }];
      mockService.getHistoryForFlashcard.mockResolvedValueOnce(history);

      const response = await flashcardPracticeController.getHistoryForFlashcard('fc-1', userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: history });
    });

    it('returns error when service throws', async () => {
      mockService.getHistoryForFlashcard.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.getHistoryForFlashcard('fc-1', userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getStatsForFlashcard', () => {
    it('returns 501 not implemented', async () => {
      const response = await flashcardPracticeController.getStatsForFlashcard('fc-1');

      expect(response).toEqual({ success: false, statusCode: 501, error: 'NOT_IMPLEMENTED' });
    });
  });

  describe('getStatsAll', () => {
    it('returns 501 not implemented', async () => {
      const response = await flashcardPracticeController.getStatsAll();

      expect(response).toEqual({ success: false, statusCode: 501, error: 'NOT_IMPLEMENTED' });
    });
  });
});
