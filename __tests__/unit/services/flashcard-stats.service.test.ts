import { AccountType, type RequestContext } from '@studiq/authz';
import { FlashcardStatsService } from '@studiq/server/services/flashcard-stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({ created_by: 'user-1' }),
  Permission: { FLASHCARD_READ: 'flashcard.read' },
}));

type ChainMock = ReturnType<typeof vi.fn>;

/** A thenable PostgREST builder stand-in: every chain method returns itself. */
interface QueryBuilder {
  select: ChainMock;
  insert: ChainMock;
  update: ChainMock;
  delete: ChainMock;
  eq: ChainMock;
  or: ChainMock;
  in: ChainMock;
  not: ChainMock;
  order: ChainMock;
  rpc: ChainMock;
  single: ChainMock;
  maybeSingle: ChainMock;
  then: ChainMock;
  catch: ChainMock;
  finally: ChainMock;
}

const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'eq',
  'or',
  'in',
  'not',
  'order',
  'rpc',
] as const;

function qb(data: unknown, error: unknown = null): QueryBuilder {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const builder = {} as QueryBuilder;
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = vi.fn(promise.then.bind(promise));
  builder.catch = vi.fn(promise.catch.bind(promise));
  builder.finally = vi.fn(promise.finally.bind(promise));
  return builder;
}

const emptyRpcResult = {
  summary: {
    totalDecks: 0,
    totalFlashcards: 0,
    totalPractices: 0,
    practicingStudents: 0,
    rosterStudents: null,
    overallAccuracy: 0,
    averageEasinessFactor: 0,
    difficultyBreakdown: { easy: 0, medium: 0, hard: 0, new: 0 },
  },
  byDeck: [],
  byTopic: [],
};

describe('FlashcardStatsService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: FlashcardStatsService;
  const ctx: RequestContext = {
    userId: 'teacher-1',
    accountType: AccountType.EDUCATOR,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new FlashcardStatsService(async () => mock);
  });

  describe('getTeacherStats', () => {
    it('returns empty without calling the RPC when filter is impossible', async () => {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({ _impossible: true });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(mock.rpc).not.toHaveBeenCalled();
      expect(result.data.summary.totalFlashcards).toBe(0);
      expect(result.data.summary.practicingStudents).toBe(0);
      expect(result.data.summary.rosterStudents).toBeNull();
    });

    it('applies the resolved filter and passes the active org to the RPC', async () => {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({
        organization_id: 'org-1',
        or: 'created_by.eq.teacher-1,id.in.(fc-1)',
      });
      const flashcardQuery = qb([{ id: 'fc-1' }]);
      mock.from.mockReturnValueOnce(flashcardQuery);
      mock.rpc.mockResolvedValueOnce({
        data: { ...emptyRpcResult, summary: { ...emptyRpcResult.summary, totalFlashcards: 1 } },
        error: null,
      });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(flashcardQuery.or).toHaveBeenCalledWith('created_by.eq.teacher-1,id.in.(fc-1)');
      expect(flashcardQuery.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(mock.rpc).toHaveBeenCalledWith('get_teacher_stats', {
        p_flashcard_ids: ['fc-1'],
        p_user_id: 'teacher-1',
        p_deck_id: null,
        p_organization_id: 'org-1',
      });
    });

    it('passes a null organization id outside an org scope', async () => {
      const ownCtx: RequestContext = { ...ctx, activeOrgId: null };
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));
      mock.rpc.mockResolvedValueOnce({ data: emptyRpcResult, error: null });

      const result = await service.getTeacherStats(ownCtx);

      expect(result.success).toBe(true);
      expect(mock.rpc).toHaveBeenCalledWith('get_teacher_stats', {
        p_flashcard_ids: ['fc-1'],
        p_user_id: 'teacher-1',
        p_deck_id: null,
        p_organization_id: null,
      });
    });

    it('still calls the RPC with no flashcards so the roster survives', async () => {
      // A brand-new organization has no cards yet — the roster must still be
      // returned instead of short-circuiting to the empty response (#460).
      mock.from.mockReturnValueOnce(qb([]));
      mock.rpc.mockResolvedValueOnce({
        data: {
          ...emptyRpcResult,
          summary: { ...emptyRpcResult.summary, rosterStudents: 2 },
        },
        error: null,
      });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(mock.rpc).toHaveBeenCalledWith('get_teacher_stats', {
        p_flashcard_ids: [],
        p_user_id: 'teacher-1',
        p_deck_id: null,
        p_organization_id: 'org-1',
      });
      expect(result.data.summary.totalFlashcards).toBe(0);
      expect(result.data.summary.rosterStudents).toBe(2);
    });

    it('returns stats when flashcards exist', async () => {
      const flashcards = [{ id: 'fc-1' }, { id: 'fc-2' }];
      const rpcResult = {
        summary: {
          totalDecks: 1,
          totalFlashcards: 2,
          totalPractices: 10,
          practicingStudents: 5,
          rosterStudents: 6,
          overallAccuracy: 80,
          averageEasinessFactor: 2.5,
          difficultyBreakdown: { easy: 1, medium: 0, hard: 1, new: 0 },
        },
        byDeck: [],
        byTopic: [],
      };
      mock.from.mockReturnValueOnce(qb(flashcards));
      mock.rpc.mockResolvedValueOnce({ data: rpcResult, error: null });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.summary.totalFlashcards).toBe(2);
      expect(result.data.summary.practicingStudents).toBe(5);
      expect(result.data.summary.rosterStudents).toBe(6);
    });

    it('returns error on flashcard query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(false);
    });

    it('returns error on RPC failure', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));
      mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('getDifficultyCards', () => {
    it('returns empty when filter is impossible', async () => {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({ _impossible: true });

      const result = await service.getDifficultyCards(ctx, 'easy');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('applies the resolved group filter before querying cards', async () => {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({
        organization_id: 'org-1',
        or: 'created_by.eq.teacher-1,id.in.(fc-1)',
      });
      const flashcardQuery = qb([{ id: 'fc-1', front: 'F', back: 'B' }]);
      mock.from
        .mockReturnValueOnce(flashcardQuery)
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]));

      const result = await service.getDifficultyCards(ctx, 'new');

      expect(result.success).toBe(true);
      expect(flashcardQuery.or).toHaveBeenCalledWith('created_by.eq.teacher-1,id.in.(fc-1)');
      expect(flashcardQuery.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('returns empty when no flashcards', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getDifficultyCards(ctx, 'easy');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns new cards for new bucket', async () => {
      const flashcards = [
        { id: 'fc-1', front: 'Hello', back: 'Cześć' },
        { id: 'fc-2', front: 'Bye', back: 'Pa' },
      ];
      // flashcards query
      mock.from.mockReturnValueOnce(qb(flashcards));
      // flashcards with decks
      mock.from.mockReturnValueOnce(qb([]));
      // topic assignments
      mock.from.mockReturnValueOnce(qb([]));
      // topics
      mock.from.mockReturnValueOnce(qb([]));
      // practice rows
      mock.from.mockReturnValueOnce(
        qb([{ flashcard_id: 'fc-1', was_correct: true, user_id: 'u-1' }]),
      );

      const result = await service.getDifficultyCards(ctx, 'new');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1); // fc-2 has no practice, so it's "new"
    });

    it('returns error on flashcard query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getDifficultyCards(ctx, 'easy');

      expect(result.success).toBe(false);
    });
  });
});
