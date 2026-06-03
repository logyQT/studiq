import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardPracticeController } from './flashcard-practice.controller';
import { flashcardPracticeService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  flashcardPracticeService: {
    log: vi.fn(),
    getDueCards: vi.fn(),
    getDueCount: vi.fn(),
    getStatsForFlashcard: vi.fn(),
    getStatsAll: vi.fn(),
  },
}));

const mockService = vi.mocked(flashcardPracticeService);

const mockCtx = {
  userId: 'test-user-id',
  universityId: null,
  role: 'student' as const,
  url: 'http://localhost',
  method: 'POST',
};

describe('FlashcardPracticeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('log', () => {
    it('returns success when service logs successfully', async () => {
      const body = { wasCorrect: true };
      const result = {
        practice: { id: 'p-1', flashcard_id: 'fc-1', was_correct: true },
        reviewState: { id: 'rs-1', easiness_factor: 2.6, interval_days: 1, repetitions: 1 },
      };
      mockService.log.mockResolvedValueOnce(result as any);

      const response = await flashcardPracticeController.log('fc-1', body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns success with optional fields', async () => {
      const body = { wasCorrect: true, responseTimeMs: 1500, confidenceLevel: 4 };
      const result = {
        practice: {
          id: 'p-1',
          flashcard_id: 'fc-1',
          was_correct: true,
          response_time_ms: 1500,
          confidence_level: 4,
        },
        reviewState: { easiness_factor: 2.6, interval_days: 6, repetitions: 2 },
      };
      mockService.log.mockResolvedValueOnce(result as any);

      const response = await flashcardPracticeController.log('fc-1', body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardPracticeController.log('fc-1', { responseTimeMs: 1000 }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.log.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.log('fc-1', { wasCorrect: true }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.log.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardPracticeController.log('fc-1', { wasCorrect: true }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getDueCards', () => {
    it('returns due cards for user', async () => {
      const dueCards = [{ id: 'fc-1', front: 'Q', back: 'A', reviewState: null }];
      mockService.getDueCards.mockResolvedValueOnce(dueCards as any);

      const response = await flashcardPracticeController.getDueCards(mockCtx, {}, 20);

      expect(response).toEqual({ success: true, statusCode: 200, data: dueCards });
    });

    it('returns error when service throws', async () => {
      mockService.getDueCards.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.getDueCards(mockCtx, {}, 20);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getDueCount', () => {
    it('returns due count', async () => {
      mockService.getDueCount.mockResolvedValueOnce({ count: 5 });

      const response = await flashcardPracticeController.getDueCount(mockCtx, {});

      expect(response).toEqual({ success: true, statusCode: 200, data: { count: 5 } });
    });
  });

  describe('getStatsForFlashcard', () => {
    it('returns stats for flashcard', async () => {
      const stats = {
        totalAttempts: 10,
        correctRate: 80,
        averageResponseTimeMs: 2000,
        reviewState: null,
      };
      mockService.getStatsForFlashcard.mockResolvedValueOnce(stats);

      const response = await flashcardPracticeController.getStatsForFlashcard('fc-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service throws', async () => {
      mockService.getStatsForFlashcard.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.getStatsForFlashcard('fc-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getStatsAll', () => {
    it('returns aggregate stats', async () => {
      const stats = {
        totalPracticed: 50,
        totalDue: 10,
        totalCardsReviewed: 20,
        averageEasinessFactor: 2.3,
      };
      mockService.getStatsAll.mockResolvedValueOnce(stats);

      const response = await flashcardPracticeController.getStatsAll(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: stats });
    });

    it('returns error when service throws', async () => {
      mockService.getStatsAll.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardPracticeController.getStatsAll(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
