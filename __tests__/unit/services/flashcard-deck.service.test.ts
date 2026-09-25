import { AccountType, type RequestContext } from '@studiq/authz';
import { FlashcardDeckService } from '@studiq/server/services/flashcard-deck.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

function qb(data: any, error: any = null, count?: number) {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.neq = vi.fn(() => b);
  b.rpc = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('FlashcardDeckService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: FlashcardDeckService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new FlashcardDeckService(async () => mock as any);
  });

  describe('create', () => {
    it('inserts deck and returns it', async () => {
      const mockDeck = { id: 'd-1', name: 'Study Deck', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(mockDeck));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(mockDeck));

      const result = await service.create({ name: 'Study Deck' }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('flashcard_decks');
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.create({ name: 'Study Deck' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns decks for user', async () => {
      const decks = [
        { id: 'd-1', name: 'Study Deck', flashcard_count: 0, groupIds: [], suspended: false },
      ];
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(decks));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns empty result for groupFilter=mine when the caller has no groups', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb([], null));

      const result = await service.list(ctx, { groupFilter: 'mine' } as any);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false });
    });

    it('filters to decks shared with the caller groups when groupFilter=mine', async () => {
      const groupCtx = { ...ctx, groupIds: ['g-1'] };
      const decks = [
        { id: 'd-1', name: 'Group Deck', flashcard_count: 0, groupIds: ['g-1'], suspended: false },
      ];
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }], null));
      mock.from.mockReturnValueOnce(qb(decks));

      const result = await service.list(groupCtx, { groupFilter: 'mine' } as any);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
    });
  });

  describe('getById', () => {
    it('returns deck when found', async () => {
      const deck = { id: 'd-1', name: 'Study Deck' };
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(deck));

      const result = await service.getById('d-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates deck and returns it', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId };
      const updated = { id: 'd-1', name: 'Updated', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb(updated));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(updated));

      const result = await service.update('d-1', { name: 'Updated' }, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.update('nonexistent', { name: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('delete', () => {
    it('deletes deck successfully', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'd-1', created_by: ctx.userId }));
      mock.from.mockReturnValueOnce(qb({ id: 'd-1' }));

      const result = await service.delete('d-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.delete('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });
});
