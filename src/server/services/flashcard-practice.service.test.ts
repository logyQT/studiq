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
});
