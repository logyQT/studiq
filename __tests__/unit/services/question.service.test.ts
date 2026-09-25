import { AccountType, type RequestContext } from '@studiq/authz';
import { QuestionService } from '@studiq/server/services/question.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({}),
  Permission: {
    QUESTION_READ: 'question.read' as const,
    QUESTION_UPDATE: 'question.update' as const,
  },
}));

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

function chain(result: any, count?: number) {
  const resolved =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
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

describe('QuestionService', () => {
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
  const service = new QuestionService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts question and answers and returns it', async () => {
      const mockQuestion = { id: 'q-1', type: 'mcq', content: 'Q1' };

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValueOnce(chain(mockQuestion));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(mockQuestion));

      const result = await service.create(
        {
          type: 'mcq',
          content: 'Q1',
          difficulty: 'easy',
          answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mock.from).toHaveBeenCalledWith('questions');
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

      const result = await service.create(
        {
          type: 'mcq',
          content: 'Q1',
          difficulty: 'easy',
          answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns all questions when no filter', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      mock.from.mockReturnValue(chain(questions));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(questions);
    });

    it('filters by bankId when provided', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];

      mock.from.mockReturnValue(chain(questions));

      const result = await service.list(ctx, { bankId: 'bank-1' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(questions);
    });
  });

  describe('getById', () => {
    it('returns question when found', async () => {
      const question = { id: 'q-1', content: 'Q1' };
      mock.from.mockReturnValue(chain(question));

      const result = await service.getById('q-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(question);
    });

    it('returns NOT_FOUND when question does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates question and returns it', async () => {
      const updated = { id: 'q-1', content: 'Updated' };

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));

      const result = await service.update('q-1', { content: 'Updated' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns FORBIDDEN when question not owned by user', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.update('q-1', { content: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('updates question with answers replacement', async () => {
      const updated = { id: 'q-1', content: 'Updated' };

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(updated));

      const result = await service.update(
        'q-1',
        {
          content: 'Updated',
          answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mock.from).toHaveBeenCalledWith('question_options');
    });
  });

  describe('delete', () => {
    it('deletes question successfully', async () => {
      mock.from.mockReturnValue(chain({ id: 'q-1' }));

      const result = await service.delete('q-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns FORBIDDEN when question not owned by user', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.delete('q-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });
  });
});
