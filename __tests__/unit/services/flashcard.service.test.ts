import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { flashcardService } from '@/server/services/flashcard.service';

const mockProfile = { role: 'free', organization_id: null };
const mockTeacherProfile = { role: 'teacher', organization_id: 'uni-1' };

function mockProfileLookup(profile: typeof mockProfile) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: profile, error: null }),
      }),
    }),
  };
}

function mockFlashcardQueryChain(result: any) {
  const responseData = { data: result, error: null };
  const singleMock = vi.fn().mockResolvedValue(result ? responseData : { data: null, error: null });

  const inResult = Promise.resolve(responseData);
  const inMock = vi.fn().mockReturnValue(
    Object.assign(inResult, {
      order: vi.fn().mockResolvedValue(responseData),
    }),
  );

  const orderResult = Promise.resolve(responseData);
  const orderMock = vi.fn().mockReturnValue(
    Object.assign(orderResult, {
      in: inMock,
    }),
  );

  const eqMock = {
    or: vi.fn(),
    single: singleMock,
    order: orderMock,
  };

  const orMock = vi.fn().mockReturnValue({
    in: inMock,
    order: orderMock,
    single: singleMock,
    eq: vi.fn().mockReturnValue(eqMock),
  });

  eqMock.or = orMock;

  const selectMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(eqMock),
    or: orMock,
  });

  return {
    select: selectMock,
  };
}

function mockInsertChain(result: any) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: result, error: null }),
      }),
    }),
  };
}

function mockDeleteChain() {
  return {
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  };
}

function mockTopicFilterChain(assignments: any[], _flashcards: any) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: assignments, error: null }),
    }),
  };
}

describe('FlashcardService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts flashcard with organization_id for teacher role', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValueOnce(mockProfileLookup(mockTeacherProfile));
      mock.from.mockReturnValueOnce(mockInsertChain(mockFlashcard));

      const result = await flashcardService.create({ front: 'Q', back: 'A' }, userId);

      expect(result).toEqual(mockFlashcard);
      expect(mock.from).toHaveBeenCalledWith('flashcards');
    });

    it('inserts flashcard with null organization_id for non-teacher role', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValueOnce(mockInsertChain(mockFlashcard));

      const result = await flashcardService.create({ front: 'Q', back: 'A' }, userId);

      expect(result).toEqual(mockFlashcard);
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
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

      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
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
      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      });

      await expect(
        flashcardService.bulkCreate({ cards: [{ front: 'Q1', back: 'A1' }] }, userId),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });

    it('creates topic assignments when topicIds provided', async () => {
      const flashcards = [
        { id: 'fc-1', front: 'Q1', back: 'A1' },
        { id: 'fc-2', front: 'Q2', back: 'A2' },
      ];

      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: flashcards, error: null }),
        }),
      });
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await flashcardService.bulkCreate(
        {
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
          topicIds: ['t-1'],
        },
        userId,
      );

      expect(result).toEqual(flashcards);
      expect(mock.from).toHaveBeenCalledWith('flashcard_topic_assignments');
    });
  });

  describe('list', () => {
    it('returns flashcards scoped to user', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValue(mockFlashcardQueryChain(flashcards));

      const result = await flashcardService.list(userId);

      expect(result).toEqual(flashcards);
    });

    it('filters by topicIds when provided', async () => {
      const assignments = [{ flashcard_id: 'fc-1' }];
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValueOnce(mockFlashcardQueryChain(flashcards));
      mock.from.mockReturnValueOnce(mockTopicFilterChain(assignments, flashcards));

      const result = await flashcardService.list(userId, { topicIds: ['t-1'] });

      expect(result).toEqual(flashcards);
    });

    it('filters by deckIds when provided', async () => {
      mockSupabase();
      const result = await flashcardService.list(userId, { deckIds: ['d-1'] });
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns flashcard when found', async () => {
      const flashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: flashcard, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardService.getById('fc-1', userId);

      expect(result).toEqual(flashcard);
    });

    it('throws NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValueOnce(mockProfileLookup(mockProfile));
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      await expect(flashcardService.getById('nonexistent', userId)).rejects.toThrow(
        'ERROR_NOT_FOUND',
      );
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

    it('updates topic assignments when topicIds provided', async () => {
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
      mock.from.mockReturnValueOnce(mockDeleteChain());
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      });

      const result = await flashcardService.update(
        'fc-1',
        { front: 'Updated', topicIds: ['t-1'] },
        userId,
      );

      expect(result).toBeDefined();
    });

    it('updates deck assignments when deckIds provided', async () => {
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
      mock.from.mockReturnValueOnce(mockDeleteChain());
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      });

      const result = await flashcardService.update(
        'fc-1',
        { front: 'Updated', deckIds: ['d-1'] },
        userId,
      );

      expect(result).toBeDefined();
    });

    it('clears topic assignments when topicIds is empty array', async () => {
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
      mock.from.mockReturnValueOnce(mockDeleteChain());
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      });

      const result = await flashcardService.update('fc-1', { topicIds: [] }, userId);

      expect(result).toBeDefined();
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

    it('throws FORBIDDEN when flashcard not owned by user', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(flashcardService.delete('fc-1', userId)).rejects.toThrow('ERROR_FORBIDDEN');
    });
  });
});
