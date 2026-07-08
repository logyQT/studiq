import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { QuizAttemptService } from '@/server/services/quiz-attempt.service';
import { AccountType } from '@/types';
import type { RequestContext } from '@/lib/request-context';

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

describe('QuizAttemptService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: QuizAttemptService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new QuizAttemptService(async () => mock as any);
  });

  describe('list', () => {
    it('returns attempts for user', async () => {
      const attempts = [{ id: 'a-1', user_id: ctx.userId, score: 5 }];
      mock.from.mockReturnValueOnce(qb(attempts));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(attempts);
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns attempt with questions and answers', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId };
      const attemptQuestions = [{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }];
      const answers = [{ question_id: 'q-1', selected_answer_id: 'ans-1', is_correct: true }];

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(attemptQuestions));
      mock.from.mockReturnValueOnce(qb(answers));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).questions).toBeDefined();
      expect((result.data as any).answers).toBeDefined();
    });

    it('returns NOT_FOUND when attempt does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('submit', () => {
    it('submits answers and returns score', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const answer = { id: 'ans-1', is_correct: true };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(answer));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).score).toBe(1);
    });

    it('returns NOT_FOUND when attempt does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.submit({ attemptId: 'nonexistent', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns BAD_REQUEST when attempt already completed', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: '2024-01-01' };
      mock.from.mockReturnValueOnce(qb(attempt));

      const result = await service.submit({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });
  });
});
