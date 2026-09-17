import { RequestContext } from '@studiq/authz';
import { FlashcardStatsService } from '@studiq/server/services/flashcard-stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@/lib/authz', () => ({
  buildQueryFilter: vi.fn().mockReturnValue({ created_by: 'user-1' }),
  Permission: { FLASHCARD_READ: 'flashcard.read' },
}));

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.rpc = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('FlashcardStatsService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: FlashcardStatsService;
  const ctx: RequestContext = {
    userId: 'teacher-1',
    accountType: 'educator' as any,
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
    service = new FlashcardStatsService(async () => mock as any);
  });

  describe('getTeacherStats', () => {
    it('returns empty when filter is impossible', async () => {
      const { buildQueryFilter } = await import('@/lib/authz');
      vi.mocked(buildQueryFilter).mockReturnValueOnce({ _impossible: true } as any);

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.summary.totalFlashcards).toBe(0);
    });

    it('returns empty when no flashcards', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.summary.totalFlashcards).toBe(0);
    });

    it('returns stats when flashcards exist', async () => {
      const flashcards = [{ id: 'fc-1' }, { id: 'fc-2' }];
      const rpcResult = {
        summary: {
          totalDecks: 1,
          totalFlashcards: 2,
          totalPractices: 10,
          totalStudents: 5,
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
    });

    it('returns error on flashcard query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('getDifficultyCards', () => {
    it('returns empty when filter is impossible', async () => {
      const { buildQueryFilter } = await import('@/lib/authz');
      vi.mocked(buildQueryFilter).mockReturnValueOnce({ _impossible: true } as any);

      const result = await service.getDifficultyCards(ctx, 'easy');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
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
