import { AccountType, type RequestContext } from '@studiq/authz';
import { QuizAttemptService } from '@studiq/server/services/quiz-attempt.service';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { firstCall } from '#test/mocks/recorded';

type QueryResult = { data: unknown; error: unknown };
type QueryChain = {
  select: Mock<(...args: unknown[]) => QueryChain>;
  insert: Mock<(...args: unknown[]) => QueryChain>;
  upsert: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  delete: Mock<(...args: unknown[]) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  in: Mock<(...args: unknown[]) => QueryChain>;
  order: Mock<(...args: unknown[]) => QueryChain>;
  limit: Mock<(...args: unknown[]) => QueryChain>;
  range: Mock<(...args: unknown[]) => QueryChain>;
  or: Mock<(...args: unknown[]) => QueryChain>;
  not: Mock<(...args: unknown[]) => QueryChain>;
  neq: Mock<(...args: unknown[]) => QueryChain>;
  is: Mock<(...args: unknown[]) => QueryChain>;
  rpc: Mock<(...args: unknown[]) => QueryChain>;
  single: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  then: Promise<QueryResult>['then'];
  catch: Promise<QueryResult>['catch'];
  finally: Promise<QueryResult>['finally'];
};

/** The serialised attempt detail (`getById` types its payload as `Record<string, unknown>`). */
type AttemptAnswers = Record<
  string,
  {
    selected_answer_id: string | null;
    text_answer: string | null;
    is_correct?: boolean;
    teacher_points?: number;
    teacher_feedback?: string;
  }
>;
type AttemptDetailView = { answers: AttemptAnswers };

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The `list` payload: one row per attempt, with the gradable count the service adds. */
function attemptRows(result: ServiceResult<unknown>): Array<{ gradable_questions: number }> {
  const data = expectSuccess(result);
  if (!Array.isArray(data)) throw new Error('expected an attempt list');
  return data.map((row: unknown) => {
    if (!isRecord(row) || !('gradable_questions' in row)) {
      throw new Error('expected gradable_questions on every attempt row');
    }
    if (typeof row.gradable_questions !== 'number') {
      throw new Error('expected gradable_questions to be a number');
    }
    return { gradable_questions: row.gradable_questions };
  });
}

function isAnswerRow(value: unknown): value is AttemptAnswers[string] {
  return (
    isRecord(value) &&
    'selected_answer_id' in value &&
    (value.selected_answer_id === null || typeof value.selected_answer_id === 'string') &&
    'text_answer' in value &&
    (value.text_answer === null || typeof value.text_answer === 'string')
  );
}

function attemptAnswers(value: unknown): AttemptAnswers {
  if (!isRecord(value)) throw new Error('expected an answers map');
  const answers: AttemptAnswers = {};
  for (const [key, row] of Object.entries(value)) {
    if (!isAnswerRow(row)) throw new Error(`expected an answer row for ${key}`);
    answers[key] = row;
  }
  return answers;
}

/** The `getById` payload, narrowed to the answers map the tests read. */
function attemptDetail(result: ServiceResult<unknown>): AttemptDetailView {
  const data = expectSuccess(result);
  if (!isRecord(data) || !('answers' in data)) {
    throw new Error('expected an answers map on the attempt detail');
  }
  return { answers: attemptAnswers(data.answers) };
}

/** A recorded mock argument, narrowed to the projection string the test asserts on. */
function stringArg(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string argument');
  return value;
}

function qb(data: unknown, error: unknown = null) {
  const result: QueryResult = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: QueryChain = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    upsert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    in: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    range: vi.fn(() => b),
    or: vi.fn(() => b),
    not: vi.fn(() => b),
    neq: vi.fn(() => b),
    is: vi.fn(() => b),
    rpc: vi.fn(() => b),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

const questionsQb = () => qb([{ question_id: 'q-1' }, { question_id: 'q-2' }]);

/** The conditional completion write reports the row it flipped; `qb([])` means another submit won. */
const completedQb = () => qb([{ id: 'a-1' }]);

/** What every read of the racing attempt answers, keyed by table. */
function racingReadResult(table: string): QueryResult {
  switch (table) {
    case 'quiz_attempts':
      return { data: { id: 'a-1', assignment_id: null, completed_at: null }, error: null };
    case 'quiz_attempt_questions':
      return { data: [{ question_id: 'q-1' }], error: null };
    case 'questions':
      return { data: [{ id: 'q-1', type: 'mcq' }], error: null };
    case 'question_options':
      return { data: { is_correct: true }, error: null };
    default:
      return { data: null, error: null };
  }
}

/**
 * A client double whose completion write is the arbiter: both submits read the
 * same open attempt, the first conditional write flips it and the second affects
 * no row — the interleaving a queue of `mockReturnValueOnce` cannot express.
 * The filters each write carried are recorded too, because the double decides
 * the outcome itself: without them a dropped `completed_at IS NULL` predicate
 * would leave this interleaving green.
 */
function racingClient() {
  let completionWrites = 0;
  const upserts: unknown[][] = [];
  const completionFilters: [string, unknown[]][][] = [];

  const from = vi.fn((table: string) => {
    const read = Promise.resolve(racingReadResult(table));
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: vi.fn(self),
      insert: vi.fn(self),
      eq: vi.fn(self),
      in: vi.fn(self),
      is: vi.fn(self),
      maybeSingle: vi.fn(() => Promise.resolve(racingReadResult(table))),
      single: vi.fn(() => Promise.resolve(racingReadResult(table))),
      then: read.then.bind(read),
      catch: read.catch.bind(read),
      finally: read.finally.bind(read),
      update: vi.fn(() => {
        const filters: [string, unknown[]][] = [];
        const write = {
          eq: (...args: unknown[]) => {
            filters.push(['eq', args]);
            return write;
          },
          is: (...args: unknown[]) => {
            filters.push(['is', args]);
            return write;
          },
          select: () => {
            completionWrites += 1;
            completionFilters.push(filters);
            return Promise.resolve(
              completionWrites === 1
                ? { data: [{ id: 'a-1' }], error: null }
                : { data: [], error: null },
            );
          },
        };
        return write;
      }),
      upsert: vi.fn((records: unknown[]) => {
        upserts.push(records);
        return Promise.resolve({ data: null, error: null });
      }),
    });
    return chain;
  });

  return {
    // The double only implements `from`, the one entrypoint the service drives.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial SupabaseClient test double
    client: { from } as unknown as ReturnType<typeof mockSupabaseClient>,
    upserts,
    completionWrites: () => completionWrites,
    completionFilters,
  };
}

/** The attempt snapshot `submit` and `saveDraft` validate the answers against. */
const attemptQuestionsQb = (...questionIds: string[]) =>
  qb(questionIds.map((question_id) => ({ question_id })));

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
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new QuizAttemptService(() => Promise.resolve(mock));
  });

  describe('list', () => {
    it('returns attempts for user', async () => {
      const attempts = [{ id: 'a-1', user_id: ctx.userId, score: 5 }];
      mock.from.mockReturnValueOnce(qb(attempts));
      mock.from.mockReturnValueOnce(qb([{ attempt_id: 'a-1', questions: { type: 'mcq' } }]));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ ...attempts[0], gradable_questions: 1 }]);
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('does not look up assignments when the caller has only practice attempts (#374)', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'a-1', user_id: ctx.userId, score: 5 }]));
      mock.from.mockReturnValueOnce(qb([{ attempt_id: 'a-1', questions: { type: 'mcq' } }]));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      // Fail closed would be pointless here: there is no assignment flag to read.
      expect(mock.from.mock.calls.map((call: unknown[]) => call[0])).not.toContain(
        'teacher_assignments',
      );
    });

    it('withholds the score of a hidden assignment attempt (#374)', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'a-1', user_id: ctx.userId, score: 3, assignment_id: 'assignment-hidden' },
          { id: 'a-2', user_id: ctx.userId, score: 2, assignment_id: 'assignment-visible' },
          { id: 'a-3', user_id: ctx.userId, score: 1, assignment_id: null },
        ]),
      );
      mock.from.mockReturnValueOnce(qb([{ attempt_id: 'a-1', questions: { type: 'mcq' } }]));
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'assignment-hidden', show_results: false },
          { id: 'assignment-visible', show_results: true },
        ]),
      );

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'a-1', score: null }),
        expect.objectContaining({ id: 'a-2', score: 2 }),
        expect.objectContaining({ id: 'a-3', score: 1 }),
      ]);
    });

    it('fails closed when the assignment lookup fails (#374)', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'a-1', score: 3, assignment_id: 'assignment-1' }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    /**
     * #329 — `total_questions` includes `open` questions, which are never
     * auto-graded, so the practice score needs its own denominator.
     */
    it('excludes open questions and treats an attempt with no rows as 0', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'a-1', user_id: ctx.userId, score: 2, assignment_id: null },
          { id: 'a-2', user_id: ctx.userId, score: 0, assignment_id: null },
        ]),
      );
      mock.from.mockReturnValueOnce(
        qb([
          { attempt_id: 'a-1', questions: { type: 'mcq' } },
          { attempt_id: 'a-1', questions: { type: 'true_false' } },
          { attempt_id: 'a-1', questions: { type: 'open' } },
          // A missing / RLS-hidden question embed must not count as gradable.
          { attempt_id: 'a-1', questions: null },
        ]),
      );

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'a-1', gradable_questions: 2 }),
        expect.objectContaining({ id: 'a-2', gradable_questions: 0 }),
      ]);
    });

    it('splits a long attempt history into one request per 100 ids (#619)', async () => {
      const attempts = Array.from({ length: 101 }, (_, index) => ({
        id: `a-${index}`,
        user_id: ctx.userId,
        score: 1,
        assignment_id: null,
      }));

      mock.from.mockReturnValueOnce(qb(attempts));
      // The helper chunks the `attempt_id` filter so a long history cannot blow
      // the gateway URL limit.
      mock.from.mockReturnValueOnce(qb([{ attempt_id: 'a-0', questions: { type: 'mcq' } }]));
      mock.from.mockReturnValueOnce(qb([{ attempt_id: 'a-100', questions: { type: 'mcq' } }]));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledTimes(3);
      const rows = attemptRows(result);
      expect(rows).toHaveLength(101);
      expect(rows[0]?.gradable_questions).toBe(1);
      expect(rows[100]?.gradable_questions).toBe(1);
      expect(rows[1]?.gradable_questions).toBe(0);
    });

    it('returns INTERNAL_SERVER when the gradable lookup fails', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'a-1', user_id: ctx.userId, score: 2 }]));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('does not query questions when the caller has no attempts', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(mock.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('getById', () => {
    it('returns attempt with questions and answers', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: '2026-10-24T10:00:00.000Z' };
      const attemptQuestions = [{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }];
      const answers = [
        {
          question_id: 'q-1',
          selected_option_id: 'ans-1',
          text_answer: null,
          is_correct: true,
          teacher_points: null,
          teacher_feedback: null,
        },
      ];

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(attemptQuestions));
      mock.from.mockReturnValueOnce(qb(answers));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).questions).toBeDefined();
      expect(expectSuccess(result).answers).toBeDefined();
    });

    it('returns NOT_FOUND when attempt does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('projects only take-page columns while the attempt is in progress (#331)', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const questionsBuilder = qb([
        { order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } },
      ]);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const projection = stringArg(firstCall(questionsBuilder.select)[0]);
      expect(projection).not.toContain('*');
      expect(projection).not.toContain('is_correct');
      expect(projection).not.toContain('explanation');
      expect(projection).not.toContain('search_vector');
      expect(projection).toContain('question_answers:question_options(id, content)');
    });

    it('includes the answer key once the attempt is completed (#331)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: '2026-10-24T10:00:00.000Z',
      };
      const questionsBuilder = qb([
        { order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } },
      ]);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const projection = stringArg(firstCall(questionsBuilder.select)[0]);
      expect(projection).toContain('explanation');
      expect(projection).toContain('is_correct');
    });

    it('omits is_correct from the answers map while the attempt is in progress (#331)', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      // Graded rows cannot appear before submission — only the draft is served.
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            is_correct: true,
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).answers).toEqual({});
    });

    it('serves the saved draft as `answers` for an in-progress attempt (#349)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        draft_answers: {
          'q-1': { selected_answer_id: 'ans-1', text_answer: null },
          'q-2': { selected_answer_id: null, text_answer: 'Wisła' },
        },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const data = attemptDetail(result);
      expect(data.answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null },
        'q-2': { selected_answer_id: null, text_answer: 'Wisła' },
      });
      expect(data.answers['q-1']).not.toHaveProperty('is_correct');
      // The raw column must never be serialised.
      expect(data).not.toHaveProperty('draft_answers');
    });

    it('drops anything but the student selection out of a tampered draft (#331)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        draft_answers: {
          'q-1': { selected_answer_id: 'ans-1', text_answer: null, is_correct: true },
          'q-2': 'not-an-object',
          'q-3': null,
        },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const data = attemptDetail(result);
      expect(data.answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null },
      });
      expect(data.answers['q-1']).not.toHaveProperty('is_correct');
    });

    it('ignores the draft once the attempt is completed (#349)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: '2026-10-24T10:00:00.000Z',
        draft_answers: { 'q-1': { selected_answer_id: 'stale', text_answer: null } },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            is_correct: true,
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null, is_correct: true },
      });
    });

    it('keeps is_correct in the answers map for a completed attempt (#331)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            is_correct: true,
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect(attemptDetail(result).answers['q-1']?.is_correct).toBe(true);
    });

    it('includes teacher grading in the answers map for a completed attempt (#175)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'assignment-1', show_results: true }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-open',
            selected_option_id: null,
            text_answer: 'Rozbiory',
            is_correct: false,
            teacher_points: 2,
            teacher_feedback: 'Dobrze, ale brakuje liberum veto.',
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect(attemptDetail(result).answers['q-open']).toEqual({
        selected_answer_id: null,
        text_answer: 'Rozbiory',
        is_correct: false,
        teacher_points: 2,
        teacher_feedback: 'Dobrze, ale brakuje liberum veto.',
      });
    });

    it('refuses the review of a completed attempt when show_results is off (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'assignment-1', show_results: false }]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      // No answer key / graded rows may even be loaded.
      expect(mock.from.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        'quiz_attempts',
        'teacher_assignments',
      ]);
    });

    it('fails closed when the assignment row is missing (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('keeps resuming a running assignment attempt without reading show_results (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: null,
        draft_answers: { 'q-1': { selected_answer_id: 'ans-1', text_answer: null } },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null },
      });
      expect(mock.from).not.toHaveBeenCalledWith('teacher_assignments');
    });
  });

  describe('submit', () => {
    it('submits answers and returns score', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const answer = { id: 'ans-1', is_correct: true };
      const insertQb = qb(null);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb(answer));
      mock.from.mockReturnValueOnce(completedQb());
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(expectSuccess(result).score).toBe(1);
      // Practice quizzes must not look up assignment points.
      expect(mock.from).not.toHaveBeenCalledWith('assignment_questions');
      expect(insertQb.upsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            question_type: 'mcq',
            is_correct: true,
          }),
        ],
        // The sheet is idempotent on the one-row contract (#1066).
        { onConflict: 'attempt_id,question_id', ignoreDuplicates: true },
      );
    });

    it('counts a practice-quiz question once even when it produced several answer rows', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(completedQb()); // attempt update
      mock.from.mockReturnValueOnce(qb(null)); // answers insert

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-1', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).score).toBe(1);
      expect(mock.from).not.toHaveBeenCalledWith('assignment_questions');
    });

    it('stores an open answer as text and does not auto-score it', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const insertQb = qb(null);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-open'));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-open', type: 'open' }]));
      mock.from.mockReturnValueOnce(completedQb());
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [
            {
              questionId: 'q-open',
              textAnswer: '  Rozbiory, słaba władza centralna, liberum veto.  ',
            },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).score).toBe(0);
      expect(insertQb.upsert).toHaveBeenCalledWith(
        [
          {
            attempt_id: 'a-1',
            question_id: 'q-open',
            question_type: 'open',
            selected_option_id: null,
            text_answer: 'Rozbiory, słaba władza centralna, liberum veto.',
            is_correct: false,
          },
        ],
        { onConflict: 'attempt_id,question_id', ignoreDuplicates: true },
      );
      // No option lookup is performed for an open question.
      expect(mock.from).toHaveBeenCalledTimes(5);
    });

    it('awards assignment points instead of counting correct answers (#167)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: true })); // teacher_assignments
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true })); // question_options
      mock.from.mockReturnValueOnce(completedQb()); // attempt update
      mock.from.mockReturnValueOnce(qb(null)); // answers insert

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).score).toBe(2);
    });

    it('withholds the score of a hidden assignment after submission (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: false }));
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(completedQb()); // attempt update
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).score).toBeNull();
      // The attempt itself is still scored and stored.
      expect(expectSuccess(result).totalQuestions).toBe(1);
    });

    it('withholds the score when the assignment row is missing (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(completedQb()); // attempt update
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).score).toBeNull();
    });

    it('awards a question once even when it produced several answer rows', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: true }));
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(completedQb()); // attempt update
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-1', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).score).toBe(2);
    });

    it('returns INTERNAL_SERVER when assignment points cannot be loaded', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: true }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
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

    it('rejects an answer for a question outside the attempt and writes nothing (#1065)', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', user_id: ctx.userId, completed_at: null }));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1', 'q-2'));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          // q-1 belongs to the attempt; the stranger must sink the whole payload.
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-stranger', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      // The 422 names the offending entry, like the schema-level errors do.
      if (!result.success) {
        expect(result.details).toEqual([
          {
            code: 'custom',
            path: ['answers', 1, 'questionId'],
            message: 'VALIDATION_INVALID_INPUT',
          },
        ]);
      }
      // No score lookup, no completion, no answer rows: the payload is refused whole.
      expect(mock.from.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        'quiz_attempts',
        'quiz_attempt_questions',
      ]);
    });

    it('rejects a payload longer than the attempt, not a fixed cap (#1065)', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', user_id: ctx.userId, completed_at: null }));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1', 'q-2'));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          // Three distinct questions is more than this attempt can contain, even
          // though it is far below the parser bound.
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-2', selectedAnswerId: 'ans-2' },
            { questionId: 'q-3', selectedAnswerId: 'ans-3' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      if (!result.success) {
        expect(result.details).toEqual([
          { code: 'custom', path: ['answers'], message: 'VALIDATION_INVALID_TOO_MANY' },
        ]);
      }
    });

    it('submits an attempt with more than 100 questions (#1065)', async () => {
      const questionIds = Array.from({ length: 101 }, (_, index) => `q-${index}`);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', user_id: ctx.userId, completed_at: null }));
      mock.from.mockReturnValueOnce(attemptQuestionsQb(...questionIds));
      mock.from.mockReturnValueOnce(qb(questionIds.map((id) => ({ id, type: 'mcq' }))));
      questionIds.forEach(() => {
        mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      });
      mock.from.mockReturnValueOnce(completedQb()); // attempt update
      const insertQb = qb(null);
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: questionIds.map((questionId, index) => ({
            questionId,
            selectedAnswerId: `ans-${index}`,
          })),
        },
        ctx,
      );

      expect(result.success).toBe(true);
      // Every question is correct and each is counted once.
      expect(expectSuccess(result).score).toBe(101);
      expect(insertQb.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ question_id: 'q-100' })]),
        { onConflict: 'attempt_id,question_id', ignoreDuplicates: true },
      );
      expect(insertQb.upsert.mock.calls[0]?.[0]).toHaveLength(101);
    });

    it('returns INTERNAL_SERVER when the attempt questions cannot be loaded (#1065)', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', user_id: ctx.userId, completed_at: null }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.submit({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('clears the draft in the same update that completes the attempt (#349)', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const updateQb = completedQb();

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(updateQb);
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith(
        expect.objectContaining({ score: 1, draft_answers: {} }),
      );
      // The completion write is conditional, so only one racing submit can win (#1066).
      expect(updateQb.is).toHaveBeenCalledWith('completed_at', null);
      expect(updateQb.eq).toHaveBeenCalledWith('user_id', ctx.userId);
    });

    it('answers the losing submit of a race like a re-submit (#1066)', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', user_id: ctx.userId, completed_at: null }));
      mock.from.mockReturnValueOnce(attemptQuestionsQb('q-1'));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      // Another request flipped `completed_at` between the gate and this write.
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
      // The loser must not write a second answer sheet.
      expect(mock.from).not.toHaveBeenCalledWith('student_answers');
    });

    it('lets exactly one of two concurrent submits complete the attempt (#1066)', async () => {
      const { client, upserts, completionWrites, completionFilters } = racingClient();
      const racing = new QuizAttemptService(() => Promise.resolve(client));

      const [first, second] = await Promise.all([
        racing.submit(
          { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
          ctx,
        ),
        racing.submit(
          { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
          ctx,
        ),
      ]);

      const outcomes = [first, second].map((result) => (result.success ? 'ok' : result.error));
      expect(outcomes.toSorted()).toEqual(['BAD_REQUEST', 'ok']);
      // Both requests passed the gate, so the completion write is the only arbiter.
      expect(completionWrites()).toBe(2);
      expect(upserts).toHaveLength(1);
      // And each write is conditional on the attempt still being open and on the
      // caller owning it — that predicate is what makes the second write affect
      // no row, so it is asserted here rather than left to the integration test.
      expect(completionFilters).toHaveLength(2);
      for (const filters of completionFilters) {
        expect(filters).toContainEqual(['is', ['completed_at', null]]);
        expect(filters).toContainEqual(['eq', ['user_id', ctx.userId]]);
      }
    });
  });

  describe('saveDraft (#349)', () => {
    it('stores the normalised draft map and reports the saved count', async () => {
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.saveDraft(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-2', textAnswer: '  Wisła  ' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).saved).toBe(2);
      expect(updateQb.update).toHaveBeenCalledWith({
        draft_answers: {
          'q-1': { selected_answer_id: 'ans-1', text_answer: null },
          'q-2': { selected_answer_id: null, text_answer: 'Wisła' },
        },
      });
      // A late autosave must never revive a submitted attempt.
      expect(updateQb.is).toHaveBeenCalledWith('completed_at', null);
      expect(updateQb.eq).toHaveBeenCalledWith('user_id', ctx.userId);
    });

    it('replaces the whole draft, so a cleared answer disappears', async () => {
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(updateQb);

      await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(updateQb.update).toHaveBeenCalledWith({ draft_answers: {} });
    });

    it('keeps the last value when a question is sent twice', async () => {
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(updateQb);

      await service.saveDraft(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-1', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(updateQb.update).toHaveBeenCalledWith({
        draft_answers: { 'q-1': { selected_answer_id: 'ans-2', text_answer: null } },
      });
    });

    it('saves a draft for an assignment with more than 100 questions (#1065)', async () => {
      const updateQb = qb(null);
      const questionIds = Array.from({ length: 101 }, (_, index) => `q-${index}`);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(attemptQuestionsQb(...questionIds));
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.saveDraft(
        {
          attemptId: 'a-1',
          answers: questionIds.map((questionId, index) => ({
            questionId,
            selectedAnswerId: `ans-${index}`,
          })),
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result).saved).toBe(101);
    });

    it('rejects a draft longer than the attempt, not a fixed cap (#1065)', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());

      const result = await service.saveDraft(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-2', selectedAnswerId: 'ans-2' },
            { questionId: 'q-stranger', selectedAnswerId: 'ans-3' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      if (!result.success) {
        expect(result.details).toEqual([
          { code: 'custom', path: ['answers'], message: 'VALIDATION_INVALID_TOO_MANY' },
        ]);
      }
    });

    it('returns NOT_FOUND for a foreign or missing attempt', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns BAD_REQUEST when the attempt is already submitted', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: '2026-10-24T10:00:00.000Z' }));

      const result = await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns UNPROCESSABLE_ENTITY when a question is not part of the attempt', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());

      const result = await service.saveDraft(
        { attemptId: 'a-1', answers: [{ questionId: 'q-stranger', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns INTERNAL_SERVER when the draft update fails', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.saveDraft(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns INTERNAL_SERVER when the attempt questions cannot be loaded', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
