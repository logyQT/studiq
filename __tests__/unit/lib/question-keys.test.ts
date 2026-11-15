import { AccountType, type RequestContext } from '@studiq/authz';
import {
  canReadQuestionKey,
  readQuestionKeys,
  withAnswerKey,
} from '@studiq/server/lib/question-keys';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// #1170: the key reader is the one place that still sees `question_options.is_correct`
// (service role). These tests pin the two things that make it safe — it reads only the ids it
// is handed, and the staff decision is conservative — plus the shape it adds to a question.

const client = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@studiq/server/lib/supabase/service', () => ({
  createServiceClient: () => client,
}));

type QueryResult = { data: unknown; error: unknown };
type Chain = {
  select: Mock<(...args: unknown[]) => Chain>;
  in: Mock<(...args: unknown[]) => Chain>;
  then: Promise<QueryResult>['then'];
};

/** One PostgREST builder stub: records the ids it is filtered by and answers `data`. */
function table(data: unknown, idsSeen: string[][]): Chain {
  const result: QueryResult = { data, error: null };
  const promise = Promise.resolve(result);
  const chain: Chain = {
    select: vi.fn(() => chain),
    in: vi.fn((_column: unknown, ids: unknown) => {
      if (Array.isArray(ids)) idsSeen.push(ids.map(String));
      return chain;
    }),
    then: promise.then.bind(promise),
  };
  return chain;
}

const ctx: RequestContext = {
  userId: 'teacher-1',
  accountType: AccountType.EDUCATOR,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: 'org-1',
  orgRoleId: null,
  groupIds: [],
  permissionScopes: { 'question_bank.update': 'organization' },
};

const question = { created_by: 'teacher-1', organization_id: 'org-1' };

describe('canReadQuestionKey', () => {
  it('lets the author and organisation staff read a key', () => {
    expect(canReadQuestionKey(ctx, question)).toBe(true);
    expect(
      canReadQuestionKey(
        { ...ctx, userId: 'teacher-2' },
        { created_by: 'teacher-1', organization_id: 'org-1' },
      ),
    ).toBe(true);
  });

  it('refuses a caller without the staff permission, even inside the organisation', () => {
    const student: RequestContext = {
      ...ctx,
      userId: 'student-1',
      accountType: AccountType.STUDENT,
      permissionScopes: { 'question_bank.update': 'own' },
    };
    expect(canReadQuestionKey(student, question)).toBe(false);
    // No scope at all is not a key grant for somebody else's question (own scope would still
    // let the author read their own).
    expect(
      canReadQuestionKey(
        { ...ctx, permissionScopes: {} },
        { created_by: 'someone-else', organization_id: 'org-1' },
      ),
    ).toBe(false);
  });

  it('refuses staff scope that does not reach the question organisation', () => {
    expect(canReadQuestionKey(ctx, { created_by: 'someone-else', organization_id: 'org-2' })).toBe(
      false,
    );
  });
});

describe('readQuestionKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the correct option ids and the explanation of the ids it was asked for', async () => {
    const idsSeen: string[][] = [];
    client.from.mockReturnValueOnce(table([{ id: 'q-1', explanation: 'because' }], idsSeen));
    client.from.mockReturnValueOnce(
      table(
        [
          { id: 'o-1', question_id: 'q-1', is_correct: true },
          { id: 'o-2', question_id: 'q-1', is_correct: false },
          // A row whose question was deleted cannot be keyed.
          { id: 'o-3', question_id: null, is_correct: true },
        ],
        idsSeen,
      ),
    );

    const keys = await readQuestionKeys(['q-1', 'q-1']);

    expect([...keys]).toEqual([['q-1', { explanation: 'because', correctOptionIds: ['o-1'] }]]);
    // The same ids reach both tables, deduplicated, and nothing else is asked for.
    expect(idsSeen).toEqual([['q-1'], ['q-1']]);
    expect(client.from).toHaveBeenNthCalledWith(1, 'questions');
    expect(client.from).toHaveBeenNthCalledWith(2, 'question_options');
  });

  it('asks for nothing when there are no ids', async () => {
    const keys = await readQuestionKeys([]);

    expect(keys.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('batches at 200 ids so a large attempt stays below the request limit', async () => {
    const idsSeen: string[][] = [];
    const ids = Array.from({ length: 250 }, (_, index) => `q-${index}`);
    for (let i = 0; i < 4; i += 1) client.from.mockReturnValueOnce(table([], idsSeen));

    await readQuestionKeys(ids);

    expect(idsSeen.map((batch) => batch.length)).toEqual([200, 200, 50, 50]);
  });
});

describe('withAnswerKey', () => {
  it('adds is_correct to every option and keeps the explanation', () => {
    const keyed = withAnswerKey(
      {
        id: 'q-1',
        question_answers: [
          { id: 'o-1', content: 'A' },
          { id: 'o-2', content: 'B' },
        ],
      },
      { explanation: 'because', correctOptionIds: ['o-2'] },
    );

    expect(keyed).toEqual({
      id: 'q-1',
      explanation: 'because',
      question_answers: [
        { id: 'o-1', content: 'A', is_correct: false },
        { id: 'o-2', content: 'B', is_correct: true },
      ],
    });
  });
});
