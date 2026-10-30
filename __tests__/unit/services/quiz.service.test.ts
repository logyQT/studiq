import { AccountType, type RequestContext } from '@studiq/authz';
import { accessibleFilter } from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { QuizService } from '@studiq/server/services/quiz.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({}),
  Permission: {
    QUESTION_READ: 'question.read' as const,
  },
}));

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
  b.is = vi.fn(() => b);
  b.gte = vi.fn(() => b);
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

      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
      mock.from.mockReturnValueOnce(qb(questions));
      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 2 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).questions).toBeDefined();
    });

    it('returns NOT_FOUND when no questions available', async () => {
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 5 }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns INTERNAL_SERVER when fetch fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
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
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
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

    it('never exposes the answer key in the generated quiz payload (#331)', async () => {
      const questionsBuilder = qb([
        { id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] },
      ]);
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb({ id: 'attempt-1', user_id: ctx.userId }));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 1 }, ctx);

      expect(result.success).toBe(true);
      const projection = questionsBuilder.select.mock.calls[0][0] as string;
      expect(projection).not.toContain('*');
      expect(projection).not.toContain('is_correct');
      expect(projection).not.toContain('explanation');
      expect(projection).not.toContain('search_vector');
    });

    it('narrows the question query to the selected topics', async () => {
      const questionsBuilder = qb([
        { id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] },
      ]);
      const assignmentsBuilder = qb([{ question_id: 'q-1' }, { question_id: 'q-2' }]);
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(assignmentsBuilder);
      mock.from.mockReturnValueOnce(qb({ id: 'attempt-1', user_id: ctx.userId }));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.generateQuiz(
        { topicIds: ['topic-1'], questionTypes: ['mcq'], questionCount: 1 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('question_topic_assignments');
      expect(assignmentsBuilder.in).toHaveBeenCalledWith('topic_id', ['topic-1']);
      expect(questionsBuilder.in).toHaveBeenCalledWith('id', ['q-1', 'q-2']);
    });

    it('returns NOT_FOUND when the selected topic has no questions', async () => {
      const questionsBuilder = qb([
        { id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] },
      ]);
      const questionsAwaited = vi.fn(questionsBuilder.then);
      questionsBuilder.then = questionsAwaited;
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // daily attempt count
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb([])); // no question_topic_assignments rows

      const result = await service.generateQuiz(
        { topicIds: ['topic-without-questions'], questionTypes: ['mcq'], questionCount: 5 },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      // No attempt / attempt-question insert and no question fetch happened.
      expect(mock.from).toHaveBeenCalledTimes(3);
      expect(mock.from).not.toHaveBeenCalledWith('quiz_attempt_questions');
      expect(questionsAwaited).not.toHaveBeenCalled();
    });
  });

  describe('max_quiz_attempts_per_day limit', () => {
    it("counts only the caller's practice attempts started today", async () => {
      const countBuilder = qb(null, null, 2);
      mock.from.mockReturnValueOnce(countBuilder);
      mock.from.mockReturnValueOnce(
        qb([{ id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] }]),
      );
      mock.from.mockReturnValueOnce(qb({ id: 'attempt-1', user_id: ctx.userId }));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.generateQuiz({ questionTypes: ['mcq'], questionCount: 1 }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('quiz_attempts');
      expect(countBuilder.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(countBuilder.eq).toHaveBeenCalledWith('user_id', ctx.userId);
      expect(countBuilder.eq).toHaveBeenCalledWith('is_assignment_attempt', false);
      expect(countBuilder.gte).toHaveBeenCalledWith('started_at', expect.any(String));
      expect(limitsResolver.checkLimit).toHaveBeenCalledWith(ctx, 'max_quiz_attempts_per_day', 2);
    });

    it('rejects with USAGE_LIMIT_EXCEEDED and creates no attempt when over the daily limit', async () => {
      const countBuilder = qb(null, null, 10);
      mock.from.mockReturnValueOnce(countBuilder);
      vi.mocked(limitsResolver.checkLimit).mockRejectedValueOnce(
        new AppError('USAGE_LIMIT_EXCEEDED'),
      );

      await expect(
        service.generateQuiz({ questionTypes: ['mcq'], questionCount: 1 }, ctx),
      ).rejects.toThrow(AppError);

      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(countBuilder.insert).not.toHaveBeenCalled();
    });
  });
});
