import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { SearchService } from '@studiq/server/services/search.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

vi.mock('@studiq/server/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({ or: 'created_by.eq.user-1' }),
  Permission: { FLASHCARD_READ: 'flashcard.read' },
}));

type QueryResult = { data: unknown; error: unknown };
type QueryChain = {
  rpc: Mock<(...args: unknown[]) => QueryChain>;
  then: Promise<QueryResult>['then'];
  catch: Promise<QueryResult>['catch'];
  finally: Promise<QueryResult>['finally'];
};

function qb(data: unknown, error: unknown = null) {
  const promise = Promise.resolve<QueryResult>({ data: data ?? null, error });
  const b: QueryChain = {
    rpc: vi.fn(() => b),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

describe('SearchService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: SearchService;
  const ctx: RequestContext = {
    userId: 'user-1',
    accountType: AccountType.STUDENT,
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
    service = new SearchService(() => Promise.resolve(mock));
  });

  describe('search', () => {
    it('returns empty when filter is impossible', async () => {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({ _impossible: true });

      const result = await service.search('test', ctx);
      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual([]);
    });

    it('returns search results', async () => {
      const rows = [
        { id: 'fc-1', front: 'Hello', back: 'Cześć', rank: 0.9, deck_id: 'd-1', deck_name: 'Deck' },
      ];
      mock.rpc.mockReturnValueOnce(qb(rows));

      const result = await service.search('hello', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.title).toBe('Hello');
    });

    it('groups results by flashcard id', async () => {
      const rows = [
        {
          id: 'fc-1',
          front: 'Hello',
          back: 'Cześć',
          rank: 0.8,
          deck_id: 'd-1',
          deck_name: 'Deck1',
        },
        {
          id: 'fc-1',
          front: 'Hello',
          back: 'Cześć',
          rank: 0.9,
          deck_id: 'd-2',
          deck_name: 'Deck2',
        },
      ];
      mock.rpc.mockReturnValueOnce(qb(rows));

      const result = await service.search('hello', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.decks).toHaveLength(2);
      expect(expectSuccess(result)[0]?.rank).toBe(0.9); // max rank
    });

    it('returns empty when no results', async () => {
      mock.rpc.mockReturnValueOnce(qb([]));

      const result = await service.search('xyz', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual([]);
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
      expect(expectSuccess(result)).toEqual([]);
    });

    it('uses /edu path for educators', async () => {
      const educatorCtx = { ...ctx, accountType: AccountType.EDUCATOR };
      const rows = [
        { id: 'fc-1', front: 'Hello', back: 'Cześć', rank: 0.9, deck_id: 'd-1', deck_name: 'Deck' },
      ];
      mock.rpc.mockReturnValueOnce(qb(rows));

      const result = await service.search('hello', educatorCtx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)[0]?.decks[0]?.href).toContain('/edu/');
    });
  });
});
