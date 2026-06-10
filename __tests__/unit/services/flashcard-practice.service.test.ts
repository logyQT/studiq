import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardPracticeService } from '@/server/services/flashcard-practice.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

const mockCtx = {
  userId: 'test-user-id',
  universityId: null,
  role: 'student' as const,
  url: 'http://localhost',
  method: 'POST',
};

describe('FlashcardPracticeService', () => {
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('log', () => {
    function setupMocks(practiceResult: any, existingState: any, upsertResult: any) {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: existingState, error: null });
      const getStateEq2Mock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const getStateEq1Mock = vi.fn().mockReturnValue({ eq: getStateEq2Mock });
      const getStateSelectMock = vi.fn().mockReturnValue({ eq: getStateEq1Mock });

      const upsertSingleMock = vi.fn().mockResolvedValue(upsertResult);
      const upsertSelectMock = vi.fn().mockReturnValue({ single: upsertSingleMock });
      const upsertMock = vi.fn().mockReturnValue({ select: upsertSelectMock });

      const practiceSingleMock = vi.fn().mockResolvedValue(practiceResult);
      const practiceSelectMock = vi.fn().mockReturnValue({ single: practiceSingleMock });
      const insertMock = vi.fn().mockReturnValue({ select: practiceSelectMock });

      mock.from.mockImplementation((table: string) => {
        if (table === 'flashcard_practice') {
          return { insert: insertMock };
        }
        if (table === 'flashcard_review_state') {
          return {
            select: getStateSelectMock,
            upsert: upsertMock,
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });
    }

    it('inserts practice record and returns it with review state', async () => {
      const mockPractice = { id: 'p-1', user_id: mockCtx.userId, flashcard_id: 'fc-1', was_correct: true };
      const mockReviewState = {
        user_id: mockCtx.userId,
        flashcard_id: 'fc-1',
        easiness_factor: 2.6,
        interval_days: 1,
        repetitions: 1,
        next_review_at: new Date().toISOString(),
        last_reviewed_at: new Date().toISOString(),
        last_quality: 4,
      };

      setupMocks(
        { data: mockPractice, error: null },
        null,
        { data: mockReviewState, error: null },
      );

      const result = await flashcardPracticeService.log('fc-1', true, mockCtx);

      expect(result.practice).toEqual(mockPractice);
      expect(result.reviewState).toEqual(mockReviewState);
    });

    it('inserts practice record with optional fields', async () => {
      const mockPractice = {
        id: 'p-1',
        user_id: mockCtx.userId,
        flashcard_id: 'fc-1',
        was_correct: true,
        response_time_ms: 1500,
        confidence_level: 4,
        session_id: 'session-1',
      };
      const mockReviewState = {
        user_id: mockCtx.userId,
        flashcard_id: 'fc-1',
        easiness_factor: 2.5,
        interval_days: 1,
        repetitions: 1,
      };

      setupMocks(
        { data: mockPractice, error: null },
        null,
        { data: mockReviewState, error: null },
      );

      const result = await flashcardPracticeService.log('fc-1', true, mockCtx, 1500, 4, 'session-1');

      expect(result.practice).toEqual(mockPractice);
      expect(result.reviewState).toEqual(mockReviewState);
    });

    it('throws on insert failure', async () => {
      const practiceSingleMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error', code: 'PGRST116' } });
      const practiceSelectMock = vi.fn().mockReturnValue({ single: practiceSingleMock });
      const insertMock = vi.fn().mockReturnValue({ select: practiceSelectMock });

      mock.from.mockReturnValue({ insert: insertMock });

      await expect(flashcardPracticeService.log('fc-1', true, mockCtx)).rejects.toThrow();
    });

    it('uses existing review state when available', async () => {
      const mockPractice = { id: 'p-1', user_id: mockCtx.userId, flashcard_id: 'fc-1', was_correct: true };
      const existingState = {
        user_id: mockCtx.userId,
        flashcard_id: 'fc-1',
        easiness_factor: 2.5,
        interval_days: 6,
        repetitions: 1,
        next_review_at: new Date().toISOString(),
      };
      const updatedState = {
        ...existingState,
        easiness_factor: 2.5,
        interval_days: 15,
        repetitions: 2,
      };

      setupMocks(
        { data: mockPractice, error: null },
        existingState,
        { data: updatedState, error: null },
      );

      const result = await flashcardPracticeService.log('fc-1', true, mockCtx, undefined, 4);

      expect(result.practice).toEqual(mockPractice);
      expect(result.reviewState.repetitions).toBe(2);
      expect(result.reviewState.interval_days).toBeGreaterThan(6);
    });
  });
});
