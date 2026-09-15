import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { SearchService } from '@/server/services/search.service';
import type { RequestContext } from '@/lib/request-context';

vi.mock('@/lib/access', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({ or: 'created_by.eq.user-1' }),
  Permission: { FLASHCARD_READ: 'flashcard.read' },
}));

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.rpc = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('SearchService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: SearchService;
  const ctx: RequestContext = {
    userId: 'user-1',
    accountType: 'student' as any,
    traceId: 'test',
    url: '',
    method: 'POST',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new SearchService(async () => mock as any);
  });

  describe('search', () => {
    it('returns empty when filter is impossible', async () => {
      const { accessibleFilter } = await import('@/lib/access');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({ _impossible: true } as any);

      const result = await service.search('test', ctx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns search results', async () => {
      const rows = [
        { id: 'fc-1', front: 'Hello', back: 'Cześć', rank: 0.9, deck_id: 'd-1', deck_name: 'Deck' },
      ];
      mock.rpc.mockReturnValueOnce(qb(rows));

      const result = await service.search('hello', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe('Hello');
    });

    it('groups results by flashcard id', async () => {
      const rows = [
        { id: 'fc-1', front: 'Hello', back: 'Cześć', rank: 0.8, deck_id: 'd-1', deck_name: 'Deck1' },
        { id: 'fc-1', front: 'Hello', back: 'Cześć', rank: 0.9, deck_id: 'd-2', deck_name: 'Deck2' },
      ];
      mock.rpc.mockReturnValueOnce(qb(rows));

      const result = await service.search('hello', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].decks).toHaveLength(2);
      expect(result.data[0].rank).toBe(0.9); // max rank
    });

    it('returns empty when no results', async () => {
      mock.rpc.mockReturnValueOnce(qb([]));

      const result = await service.search('xyz', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error on RPC failure', async () => {
      mock.rpc.mockReturnValueOnce(qb(null, { message: 'RPC error' }));

      const result = await service.search('test', ctx);

      expect(result.success).toBe(false);
    });

    it('returns empty when data is null', async () => {
      mock.rpc.mockReturnValueOnce(qb(null, null));

      const result = await service.search('test', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('uses /edu path for educators', async () => {
      const educatorCtx = { ...ctx, accountType: 'educator' as any };
      const rows = [
        { id: 'fc-1', front: 'Hello', back: 'Cześć', rank: 0.9, deck_id: 'd-1', deck_name: 'Deck' },
      ];
      mock.rpc.mockReturnValueOnce(qb(rows));

      const result = await service.search('hello', educatorCtx);

      expect(result.success).toBe(true);
      expect(result.data[0].decks[0].href).toContain('/edu/');
    });
  });
});
