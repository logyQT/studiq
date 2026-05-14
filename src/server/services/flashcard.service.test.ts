import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardService } from './flashcard.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('FlashcardService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts flashcard and returns it', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockFlashcard, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockFlashcard, error: null }),
          }),
        }),
      });

      const result = await flashcardService.create({ front: 'Q', back: 'A' }, userId);

      expect(result).toBeDefined();
      expect(mock.from).toHaveBeenCalledWith('flashcards');
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardService.create({ front: 'Q', back: 'A' }, userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('bulkCreate', () => {
    it('inserts multiple flashcards and returns them', async () => {
      const flashcards = [
        { id: 'fc-1', front: 'Q1', back: 'A1' },
        { id: 'fc-2', front: 'Q2', back: 'A2' },
      ];
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: flashcards, error: null }),
        }),
      });

      const result = await flashcardService.bulkCreate(
        {
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
        },
        userId,
      );

      expect(result).toEqual(flashcards);
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      });

      await expect(
        flashcardService.bulkCreate({ cards: [{ front: 'Q1', back: 'A1' }] }, userId),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns all flashcards when no filter', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: flashcards, error: null }),
        }),
      });

      const result = await flashcardService.list();

      expect(result).toEqual(flashcards);
    });

    it('filters by topicIds when provided', async () => {
      const assignments = [{ flashcard_id: 'fc-1' }];
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: assignments, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: flashcards, error: null }),
          }),
        }),
      });

      const result = await flashcardService.list({ topicIds: ['t-1'] });

      expect(result).toEqual(flashcards);
    });
  });

  describe('getById', () => {
    it('returns flashcard when found', async () => {
      const flashcard = { id: 'fc-1', front: 'Q', back: 'A' };
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: flashcard, error: null }),
          }),
        }),
      });

      const result = await flashcardService.getById('fc-1');

      expect(result).toEqual(flashcard);
    });

    it('throws NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      await expect(flashcardService.getById('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates flashcard and returns it', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };
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
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      });

      const result = await flashcardService.update('fc-1', { front: 'Updated' }, userId);

      expect(result).toBeDefined();
    });

    it('throws FORBIDDEN when flashcard not owned by user', async () => {
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

      await expect(flashcardService.update('fc-1', { front: 'Updated' }, userId)).rejects.toThrow(
        'ERROR_FORBIDDEN',
      );
    });
  });

  describe('delete', () => {
    it('deletes flashcard successfully', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'fc-1' }, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(flashcardService.delete('fc-1', userId)).resolves.toBeUndefined();
    });
  });
});
