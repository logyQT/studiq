import { AccountType, type RequestContext } from '@studiq/authz';
import { StatsService } from '@studiq/server/services/stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null, count?: number) {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.lte = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('StatsService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
  const service = new StatsService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('getTeacherStats', () => {
    it('returns basic stats', async () => {
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'fc-1' }], error: null }),
        }),
      });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ totalQuestions: 1, totalFlashcards: 1 });
    });

    it('scopes question/flashcard counts to the active organization', async () => {
      const orgCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      const questionsBuilder = qb([{ id: 'q-1' }]);
      const flashcardsBuilder = qb([{ id: 'fc-1' }]);
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(flashcardsBuilder);

      const result = await service.getTeacherStats(orgCtx);

      expect(result.success).toBe(true);
      expect(questionsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(flashcardsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });
  });

  describe('getStudentStats', () => {
    it('returns student stats with attempts and practice', async () => {
      const attempts = [
        { score: 8, total_questions: 10, started_at: '2024-01-01', config: {} },
        { score: 6, total_questions: 10, started_at: '2024-01-02', config: {} },
      ];
      const practice = [
        { was_correct: true, practiced_at: '2024-01-01' },
        { was_correct: false, practiced_at: '2024-01-02' },
      ];

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: attempts, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: practice, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lte: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          }),
        }),
      });

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.totalQuizzes).toBe(2);
      expect(result.data.avgScore).toBe(70);
      expect(result.data.totalQuestionsCreated).toBe(1);
      expect(result.data.flashcardsPracticed).toBe(2);
      expect(result.data.flashcardAccuracy).toBe(50);
      expect(result.data.attemptsOverTime.length).toBe(2);
    });

    it('returns zero stats when no data exists', async () => {
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      c.order = vi.fn(() => c);
      c.lte = vi.fn(() => c);
      c.then = (onfulfilled: any) => Promise.resolve({ data: [], error: null }).then(onfulfilled);
      mock.from.mockReturnValue(c);

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.totalQuizzes).toBe(0);
      expect(result.data.avgScore).toBe(0);
      expect(result.data.flashcardsPracticed).toBe(0);
      expect(result.data.flashcardAccuracy).toBe(0);
    });

    it('scopes content counts to the active organization, but not activity logs', async () => {
      const orgCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      const attemptsBuilder = qb([]);
      const practiceBuilder = qb([]);
      const questionsBuilder = qb([{ id: 'q-1' }]);
      const decksBuilder = qb([], null, 0);
      const flashcardsBuilder = qb([], null, 0);
      const reviewStateBuilder = qb([], null, 0);
      mock.from.mockReturnValueOnce(attemptsBuilder);
      mock.from.mockReturnValueOnce(practiceBuilder);
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(decksBuilder);
      mock.from.mockReturnValueOnce(flashcardsBuilder);
      mock.from.mockReturnValueOnce(reviewStateBuilder);

      const result = await service.getStudentStats(orgCtx);

      expect(result.success).toBe(true);
      expect(questionsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(decksBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(flashcardsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(attemptsBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1');
      expect(practiceBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1');
      expect(reviewStateBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1');
    });
  });
});
