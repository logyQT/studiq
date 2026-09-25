import type { RequestContext } from '@studiq/authz';
import { FlashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return {
    log: vi.fn(),
    getDueCards: vi.fn(),
    getDueBreakdown: vi.fn(),
    getDueCount: vi.fn(),
    getStatsForFlashcard: vi.fn(),
    getStatsAll: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardPracticeController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

describe('FlashcardPracticeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardPracticeController(mockService as any);
  });

  describe('log', () => {
    it('returns success when service logs successfully', async () => {
      const body = { wasCorrect: true };
      const result = {
        practice: { id: 'p-1', flashcard_id: 'fc-1', was_correct: true },
        reviewState: { id: 'rs-1', easiness_factor: 2.6, interval_days: 1, repetitions: 1 },
      };
      mockService.log.mockResolvedValueOnce(success(result));

      const response = await controller.log('fc-1', body, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(result);
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
      mockService.log.mockResolvedValueOnce(success(result));

      const response = await controller.log('fc-1', body, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(result);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.log('fc-1', { responseTimeMs: 1000 }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.log.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.log('fc-1', { wasCorrect: true }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getDueCards', () => {
    it('returns due cards for user', async () => {
      const dueCards = [{ id: 'fc-1', front: 'Q', back: 'A', reviewState: null }];
      mockService.getDueCards.mockResolvedValueOnce(success(dueCards));

      const response = await controller.getDueCards(mockCtx, {}, 20);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(dueCards);
    });

    it('returns error when service returns failure', async () => {
      mockService.getDueCards.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getDueCards(mockCtx, {}, 20);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getDueBreakdown', () => {
    it('returns due breakdown', async () => {
      const breakdown = {
        total: 10,
        byTopic: { 't-1': 5, 't-2': 5 },
        byDeck: { 'd-1': 7, 'd-2': 3 },
      };
      mockService.getDueBreakdown.mockResolvedValueOnce(success(breakdown));

      const response = await controller.getDueBreakdown(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(breakdown);
    });

    it('returns error when service returns failure', async () => {
      mockService.getDueBreakdown.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getDueBreakdown(mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getDueCount', () => {
    it('returns due count', async () => {
      mockService.getDueCount.mockResolvedValueOnce(success({ count: 5 }));

      const response = await controller.getDueCount(mockCtx, {});

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ count: 5 });
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
      mockService.getStatsForFlashcard.mockResolvedValueOnce(success(stats));

      const response = await controller.getStatsForFlashcard('fc-1', mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(stats);
    });

    it('returns error when service returns failure', async () => {
      mockService.getStatsForFlashcard.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getStatsForFlashcard('fc-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
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
      mockService.getStatsAll.mockResolvedValueOnce(success(stats));

      const response = await controller.getStatsAll(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(stats);
    });

    it('returns error when service returns failure', async () => {
      mockService.getStatsAll.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getStatsAll(mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });
});
