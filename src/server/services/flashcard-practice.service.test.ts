import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardPracticeService } from './flashcard-practice.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('FlashcardPracticeService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('log', () => {
    it('inserts practice record and returns it', async () => {
      const mockRecord = { id: 'p-1', user_id: userId, flashcard_id: 'fc-1', was_correct: true };
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockRecord, error: null }),
          }),
        }),
      });

      const result = await flashcardPracticeService.log('fc-1', true, userId);

      expect(result).toEqual(mockRecord);
      expect(mock.from).toHaveBeenCalledWith('flashcard_practice');
    });

    it('inserts practice record with optional fields', async () => {
      const mockRecord = {
        id: 'p-1',
        user_id: userId,
        flashcard_id: 'fc-1',
        was_correct: true,
        response_time_ms: 1500,
        confidence_level: 4,
        session_id: 'session-1',
      };
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockRecord, error: null }),
          }),
        }),
      });

      const result = await flashcardPracticeService.log('fc-1', true, userId, 1500, 4, 'session-1');

      expect(result).toEqual(mockRecord);
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardPracticeService.log('fc-1', true, userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('getHistory', () => {
    it('returns practice history for user', async () => {
      const history = [{ id: 'p-1', user_id: userId, flashcard_id: 'fc-1', was_correct: true }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: history, error: null }),
          }),
        }),
      });

      const result = await flashcardPracticeService.getHistory(userId);

      expect(result).toEqual(history);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardPracticeService.getHistory(userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('getHistoryForFlashcard', () => {
    it('returns practice history for user on specific flashcard', async () => {
      const history = [{ id: 'p-1', user_id: userId, flashcard_id: 'fc-1', was_correct: true }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: history, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardPracticeService.getHistoryForFlashcard('fc-1', userId);

      expect(result).toEqual(history);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }),
      });

      await expect(flashcardPracticeService.getHistoryForFlashcard('fc-1', userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });
});
