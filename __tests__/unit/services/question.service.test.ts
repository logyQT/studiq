import { AccountType, type RequestContext } from '@studiq/authz';
import { QuestionService } from '@studiq/server/services/question.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { firstCall } from '#test/mocks/recorded';
import { readQuestionKeys } from '@studiq/server/lib/question-keys';

vi.mock('@studiq/server/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({}),
  Permission: {
    QUESTION_READ: 'question.read' as const,
    QUESTION_UPDATE: 'question.update' as const,
  },
}));

/**
 * The key seam (#1170): whether a row may carry the key is decided here, and the key itself is
 * read with the service role. Unit tests switch the decision per test and never touch a
 * database.
 */
const keyAccess = vi.hoisted(() => ({ canReadQuestionKey: vi.fn(() => false) }));
vi.mock('@studiq/server/lib/question-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@studiq/server/lib/question-keys')>()),
  canReadQuestionKey: keyAccess.canReadQuestionKey,
  readQuestionKeys: vi.fn((ids: readonly string[]) => {
    const keys = new Map<string, { explanation: string | null; correctOptionIds: string[] }>();
    for (const id of ids) {
      keys.set(id, { explanation: `explanation-${id}`, correctOptionIds: ['ans-2'] });
    }
    return Promise.resolve(keys);
  }),
}));

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

type QueryResult = { data: unknown; error: unknown; count?: number };
type QueryChain = {
  select: Mock<(columns: string) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  in: Mock<(...args: unknown[]) => QueryChain>;
  or: Mock<(...args: unknown[]) => QueryChain>;
  order: Mock<(...args: unknown[]) => QueryChain>;
  filter: Mock<(...args: unknown[]) => QueryChain>;
  limit: Mock<(...args: unknown[]) => QueryChain>;
  single: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  insert: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  delete: Mock<(...args: unknown[]) => QueryChain>;
  upsert: Mock<(...args: unknown[]) => QueryChain>;
  then: Promise<QueryResult>['then'];
};

function chain(result: unknown, count?: number) {
  const resolved: QueryResult =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
  const promise = Promise.resolve(resolved);
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: QueryChain = {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    or: vi.fn(() => c),
    order: vi.fn(() => c),
    filter: vi.fn(() => c),
    limit: vi.fn(() => c),
    single: terminal,
    maybeSingle: terminal,
    insert: vi.fn(() => c),
    update: vi.fn(() => c),
    delete: vi.fn(() => c),
    upsert: vi.fn(() => c),
    then: promise.then.bind(promise),
  };
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
  const service = new QuestionService(() => Promise.resolve(mock));

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

    it('counts only the caller content in the active org (#233)', async () => {
      const mockQuestion = { id: 'q-1', type: 'open', content: 'Q1' };
      const countChain = chain([], 0);
      mock.from.mockReturnValueOnce(countChain);
      mock.from.mockReturnValue(chain(mockQuestion));

      await service.create(
        { type: 'open', content: 'Q1', answers: [] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(countChain.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countChain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('does not filter the count by org outside an org context (#233)', async () => {
      const mockQuestion = { id: 'q-1', type: 'open', content: 'Q1' };
      const countChain = chain([], 0);
      mock.from.mockReturnValueOnce(countChain);
      mock.from.mockReturnValue(chain(mockQuestion));

      await service.create({ type: 'open', content: 'Q1', answers: [] }, ctx);

      expect(countChain.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countChain.eq).not.toHaveBeenCalledWith('organization_id', expect.anything());
    });

    it('creates an open question without inserting any options', async () => {
      const mockQuestion = { id: 'q-open', type: 'open', content: 'Explain' };

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValueOnce(chain(mockQuestion));
      // getById
      mock.from.mockReturnValueOnce(chain(mockQuestion));

      const result = await service.create(
        {
          bankId: '00000000-0000-4000-8020-000000000001',
          type: 'open',
          content: 'Explain',
          answers: [],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mock.from).not.toHaveBeenCalledWith('question_options');
    });

    it('inserts topic assignments and returns the question with topics', async () => {
      const mockQuestion = { id: 'q-topic', type: 'mcq', content: 'Q1' };

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValueOnce(chain(mockQuestion));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(
        chain({
          ...mockQuestion,
          question_answers: [],
          question_topic_assignments: [
            { topic_id: 't-1', topics: { id: 't-1', name: 'Kinematyka' } },
          ],
        }),
      );

      const result = await service.create(
        {
          bankId: '00000000-0000-4000-8020-000000000001',
          type: 'mcq',
          content: 'Q1',
          topicIds: ['t-1'],
          answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        ...mockQuestion,
        question_answers: [],
        topics: [{ id: 't-1', name: 'Kinematyka' }],
      });
      expect(mock.from).toHaveBeenCalledWith('question_topic_assignments');
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

  describe('listBankQuestions', () => {
    it('scopes by the bank only, never by the caller or their active organisation', async () => {
      const questions = [{ id: 'q-1', content: 'Q1', question_answers: [] }];
      const query = chain(questions, 7);
      mock.from.mockReturnValue(query);

      const result = await service.listBankQuestions('bank-1');

      expect(result.success).toBe(true);
      // `total` comes from the query's own count, so a clamped result is still detectable.
      expect(result.data).toEqual({
        questions: [
          {
            id: 'q-1',
            content: 'Q1',
            question_answers: [],
            explanation: 'explanation-q-1',
            topics: [],
          },
        ],
        total: 7,
      });
      // The caller already checked `question_bank.read`; adding `question.read` here is what
      // made an authorised export return a partial file (#669 review).
      expect(query.eq).toHaveBeenCalledWith('bank_id', 'bank-1');
      expect(query.eq).toHaveBeenCalledTimes(1);
      expect(query.or).not.toHaveBeenCalled();
    });

    it('reports a database error instead of an empty bank', async () => {
      const query = chain(null);
      const failure = Promise.resolve<QueryResult>({
        data: null,
        error: { code: 'XX000', message: 'boom' },
      });
      query.then = failure.then.bind(failure);
      mock.from.mockReturnValue(query);

      const result = await service.listBankQuestions('bank-1');

      expect(result.success).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all questions when no filter', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      mock.from.mockReturnValue(chain(questions));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ id: 'q-1', content: 'Q1', topics: [] }]);
    });

    it('filters by bankId when provided', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];

      mock.from.mockReturnValue(chain(questions));

      const result = await service.list(ctx, { bankId: 'bank-1' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ id: 'q-1', content: 'Q1', topics: [] }]);
    });

    it('flattens topic assignments into topics and drops unreadable ones', async () => {
      const questions = [
        {
          id: 'q-1',
          content: 'Q1',
          question_topic_assignments: [
            { topic_id: 't-1', topics: { id: 't-1', name: 'Kinematyka' } },
            { topic_id: 't-hidden', topics: null },
          ],
        },
      ];
      mock.from.mockReturnValue(chain(questions));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        { id: 'q-1', content: 'Q1', topics: [{ id: 't-1', name: 'Kinematyka' }] },
      ]);
    });

    it('selects the topic names embed for the question list', async () => {
      const listChain = chain([]);
      mock.from.mockReturnValue(listChain);

      await service.list(ctx);

      expect(listChain.select).toHaveBeenCalledWith(
        'id, type, content, visibility, created_by, organization_id, bank_id, created_at, updated_at, question_answers:question_options(id, content, order_index, match_group, match_side), question_topic_assignments(topic_id, topics(id, name))',
      );
    });

    it('inner-joins topic assignments when filtering by topicIds', async () => {
      const c = chain([{ id: 'q-1', content: 'Q1' }]);
      mock.from.mockReturnValue(c);

      const result = await service.list(ctx, { topicIds: ['topic-1', 'topic-2'] });

      expect(result.success).toBe(true);
      expect(c.select).toHaveBeenCalledWith(
        expect.stringContaining('question_topic_assignments!inner(topic_id, topics(id, name))'),
      );
      expect(c.filter).toHaveBeenCalledWith(
        'question_topic_assignments.topic_id',
        'in',
        '(topic-1,topic-2)',
      );
    });

    it('keeps a plain topic embed when no topicIds are given', async () => {
      const c = chain([]);
      mock.from.mockReturnValue(c);

      await service.list(ctx, { type: 'mcq' });

      const selectArg = firstCall(c.select)[0];
      expect(selectArg).toContain('question_topic_assignments(topic_id, topics(id, name))');
      expect(selectArg).not.toContain('!inner');
      expect(c.filter).not.toHaveBeenCalledWith(
        'question_topic_assignments.topic_id',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('getById', () => {
    it('returns question when found', async () => {
      const question = { id: 'q-1', content: 'Q1' };
      mock.from.mockReturnValue(chain(question));

      const result = await service.getById('q-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'q-1', content: 'Q1', topics: [] });
    });

    it('returns the question with its topics', async () => {
      const question = {
        id: 'q-1',
        content: 'Q1',
        question_topic_assignments: [{ topic_id: 't-1', topics: { id: 't-1', name: 'Dynamika' } }],
      };
      mock.from.mockReturnValue(chain(question));

      const result = await service.getById('q-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'q-1',
        content: 'Q1',
        topics: [{ id: 't-1', name: 'Dynamika' }],
      });
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

    it('clears options when converting a question to open', async () => {
      const updated = { id: 'q-1', content: 'Updated', type: 'open' };
      const optionsChain = chain(null);

      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(optionsChain);
      mock.from.mockReturnValueOnce(chain(updated));

      const result = await service.update('q-1', { type: 'open', answers: [] }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('question_options');
      expect(optionsChain.delete).toHaveBeenCalled();
      expect(optionsChain.insert).not.toHaveBeenCalled();
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

    it('does not filter by organization_id when there is no active org (#148)', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
      const updateChain = chain(updated);

      mock.from.mockReturnValueOnce(updateChain);
      mock.from.mockReturnValueOnce(chain(updated));

      const result = await service.update('q-1', { content: 'Updated' }, ctx);

      expect(result.success).toBe(true);
      expect(updateChain.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      // `.eq('organization_id', null)` would serialise to `eq.null` → 22P02 → 500, so the
      // tenant filter must be absent entirely (not merely "not null").
      expect(
        updateChain.eq.mock.calls.filter(([column]: unknown[]) => column === 'organization_id'),
      ).toEqual([]);
    });

    it('filters by organization_id when an org is active (#148)', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
      const updateChain = chain(updated);

      mock.from.mockReturnValueOnce(updateChain);
      mock.from.mockReturnValueOnce(chain(updated));

      const result = await service.update(
        'q-1',
        { content: 'Updated' },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(true);
      expect(updateChain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
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

  describe('answer key projection (#1170)', () => {
    const questionRow = {
      id: 'q-1',
      content: 'Q1',
      question_answers: [
        { id: 'ans-1', content: 'A', order_index: 0 },
        { id: 'ans-2', content: 'B', order_index: 1 },
      ],
    };

    it('serves a reader neither is_correct nor explanation', async () => {
      keyAccess.canReadQuestionKey.mockReturnValue(false);
      mock.from.mockReturnValue(chain(questionRow));

      const result = await service.getById('q-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toStrictEqual({
        id: 'q-1',
        content: 'Q1',
        question_answers: [
          { id: 'ans-1', content: 'A', order_index: 0 },
          { id: 'ans-2', content: 'B', order_index: 1 },
        ],
        topics: [],
      });
      expect(readQuestionKeys).not.toHaveBeenCalled();
    });

    it('adds the key and the explanation for a staff caller, from that question id', async () => {
      keyAccess.canReadQuestionKey.mockReturnValue(true);
      mock.from.mockReturnValue(chain(questionRow));

      const result = await service.getById('q-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toStrictEqual({
        id: 'q-1',
        content: 'Q1',
        explanation: 'explanation-q-1',
        question_answers: [
          { id: 'ans-1', content: 'A', order_index: 0, is_correct: false },
          { id: 'ans-2', content: 'B', order_index: 1, is_correct: true },
        ],
        topics: [],
      });
      // The ids come from the row the caller was authorized to read, never from the request.
      expect(readQuestionKeys).toHaveBeenCalledWith(['q-1']);
    });
  });
});
