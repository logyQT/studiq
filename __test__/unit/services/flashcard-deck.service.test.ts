import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardDeckService } from '@/server/services/flashcard-deck.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('FlashcardDeckService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts deck with university_id and returns it', async () => {
      const mockDeck = { id: 'd-1', name: 'Study Deck', created_by: userId };

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { university_id: 'uni-1' },
              error: null,
            }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockDeck, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockDeck, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardDeckService.create({ name: 'Study Deck' }, userId);

      expect(result).toBeDefined();
      expect(mock.from).toHaveBeenCalledWith('flashcard_decks');
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { university_id: null },
              error: null,
            }),
          }),
        }),
      });

      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardDeckService.create({ name: 'Study Deck' }, userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('list', () => {
    it('returns decks for user', async () => {
      const decks = [{ id: 'd-1', name: 'Study Deck', flashcard_deck_assignments: [] }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: decks, error: null }),
          }),
        }),
      });

      const result = await flashcardDeckService.list(userId);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardDeckService.list(userId)).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns deck when found', async () => {
      const deck = { id: 'd-1', name: 'Study Deck', flashcard_deck_assignments: [] };
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: deck, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardDeckService.getById('d-1', userId);

      expect(result).toBeDefined();
    });

    it('throws NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      await expect(flashcardDeckService.getById('nonexistent', userId)).rejects.toThrow(
        'ERROR_NOT_FOUND',
      );
    });
  });

  describe('update', () => {
    it('updates deck and returns it', async () => {
      const updated = { id: 'd-1', name: 'Updated', flashcard_deck_assignments: [] };
      mock.from.mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updated, error: null }),
              }),
            }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updated, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardDeckService.update('d-1', { name: 'Updated' }, userId);

      expect(result).toBeDefined();
    });

    it('throws FORBIDDEN when deck not owned by user', async () => {
      mock.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(
        flashcardDeckService.update('d-1', { name: 'Updated' }, userId),
      ).rejects.toThrow('ERROR_FORBIDDEN');
    });
  });

  describe('delete', () => {
    it('deletes deck successfully', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'd-1' }, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(flashcardDeckService.delete('d-1', userId)).resolves.toBeUndefined();
    });
  });
});
