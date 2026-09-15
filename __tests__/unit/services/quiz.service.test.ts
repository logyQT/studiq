import { AccountType, RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { accessibleFilter } from '@/lib/authz';
import { QuizService } from '@/server/services/quiz.service';

vi.mock('@/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({}),
  Permission: {
    QUESTION_READ: 'question.read' as const,
  },
}));

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
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

describe('QuizService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: QuizService;
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
    service = new QuizService(async () => mock as any);
  });

  describe('generateQuiz', () => {
    it('generates quiz with questions and returns attempt', async () => {
      const questions = [
        { id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] },
        { id: 'q-2', type: 'mcq', content: 'Q2', question_answers: [] },
      ];
      const attempt = { id: 'attempt-1', user_id: ctx.userId, score: 0, total_questions: 2 };

      mock.from.mockReturnValueOnce(qb(questions));
      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 2 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).questions).toBeDefined();
    });

    it('returns NOT_FOUND when no questions available', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 5 }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns INTERNAL_SERVER when fetch fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 5 }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns an empty quiz without querying when the caller has no access', async () => {
      vi.mocked(accessibleFilter).mockResolvedValueOnce({ _impossible: true });

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 5 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ questions: [], attemptId: '' });
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('scopes the question query to the group-visibility filter instead of the whole org', async () => {
      vi.mocked(accessibleFilter).mockResolvedValueOnce({
        organization_id: 'org-1',
        or: 'created_by.eq.test-user-id,id.in.(q-1,q-2)',
      });
      const questionsBuilder = qb([
        { id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] },
      ]);
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb({ id: 'attempt-1', user_id: ctx.userId }));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 1 }, ctx);

      expect(result.success).toBe(true);
      expect(questionsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(questionsBuilder.or).toHaveBeenCalledWith(
        'created_by.eq.test-user-id,id.in.(q-1,q-2)',
      );
    });
  });
});
