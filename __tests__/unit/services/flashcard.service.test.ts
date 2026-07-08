import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { FlashcardService } from '@/server/services/flashcard.service';
import { success, failure } from '@/lib/service-result';
import type { RequestContext } from '@/lib/request-context';
import { AccountType } from '@/types';

vi.mock('@/lib/rbac', () => {
  const checkPermission = vi.fn().mockResolvedValue(undefined);
  return {
    checkPermission,
    buildQueryFilter: vi.fn().mockResolvedValue({}),
    Permission: {
      FLASHCARD_READ: 'flashcard.read',
      FLASHCARD_UPDATE: 'flashcard.update',
      FLASHCARD_DELETE: 'flashcard.delete',
      DECK_UPDATE: 'deck.update',
    },
  };
});

vi.mock('@/server/services', () => ({
  planResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

function chain(result: any, count?: number) {
  const resolved = count !== undefined
    ? { data: result, count, error: null }
    : { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: any) => Promise.resolve(resolved).then(onfulfilled);
  return c;
}

describe('FlashcardService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
  };
  const service = new FlashcardService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts flashcard', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValue(chain(mockFlashcard));

      const result = await service.create({ front: 'Q', back: 'A' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockFlashcard);
      expect(mock.from).toHaveBeenCalledWith('flashcards');
    });

    it('inserts flashcard with organization_id when activeOrgId is set', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };
      const orgCtx = { ...ctx, activeOrgId: 'uni-1' };

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValue(chain(mockFlashcard));

      const result = await service.create({ front: 'Q', back: 'A' }, orgCtx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockFlashcard);
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      const result = await service.create({ front: 'Q', back: 'A' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('bulkCreate', () => {
    it('inserts multiple flashcards and returns them', async () => {
      const flashcards = [
        { id: 'fc-1', front: 'Q1', back: 'A1' },
        { id: 'fc-2', front: 'Q2', back: 'A2' },
      ];

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.rpc.mockResolvedValue({ data: flashcards, error: null });

      const result = await service.bulkCreate(
        {
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flashcards);
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(chain([], 0));
      mock.rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

      const result = await service.bulkCreate(
        { cards: [{ front: 'Q1', back: 'A1' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('creates topic assignments when topicIds provided', async () => {
      const flashcards = [
        { id: 'fc-1', front: 'Q1', back: 'A1' },
        { id: 'fc-2', front: 'Q2', back: 'A2' },
      ];

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.rpc.mockResolvedValue({ data: flashcards, error: null });

      const result = await service.bulkCreate(
        {
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
          topicIds: ['t-1'],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flashcards);
      expect(mock.rpc).toHaveBeenCalledWith(
        'bulk_create_flashcards',
        expect.objectContaining({ p_topic_ids: ['t-1'] }),
      );
    });
  });

  describe('list', () => {
    it('returns flashcards scoped to user', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValue(chain(flashcards));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data.items).toEqual(flashcards);
    });

    it('filters by topicIds when provided', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValue(chain(flashcards));

      const result = await service.list(ctx, { topicIds: ['t-1'] });

      expect(result.success).toBe(true);
      expect(result.data.items).toEqual(flashcards);
    });

    it('filters by deckIds when provided', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValue(chain(flashcards));

      const result = await service.list(ctx, { deckIds: ['d-1'] });

      expect(result.success).toBe(true);
      expect(result.data.items).toEqual(flashcards);
    });
  });

  describe('getById', () => {
    it('returns flashcard when found', async () => {
      const flashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValue(chain(flashcard));

      const result = await service.getById('fc-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flashcard);
    });

    it('returns NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates flashcard and returns it', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update('fc-1', { front: 'Updated' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.update('fc-1', { front: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('updates topic assignments when topicIds provided', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update(
        'fc-1',
        { front: 'Updated', topicIds: ['t-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('updates deck assignments when deckIds provided', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update(
        'fc-1',
        { front: 'Updated', deckIds: ['d-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('clears topic assignments when topicIds is empty array', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update('fc-1', { topicIds: [] }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('delete', () => {
    it('deletes flashcard successfully', async () => {
      const existing = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValueOnce(chain(existing));
      mock.from.mockReturnValue(chain(null));

      const result = await service.delete('fc-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.delete('fc-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });
});
