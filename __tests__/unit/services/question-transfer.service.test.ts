import { AccountType, type RequestContext } from '@studiq/authz';
import { can, check } from '@studiq/server/lib/authz';
import { error as logError } from '@studiq/server/lib/log';
import { QuestionTransferController } from '@studiq/server/controllers/question-transfer.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import type { TransferQuestion } from '@studiq/server/models/question-transfer.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { questionService } from '@studiq/server/services/question.service';
import { questionBankService } from '@studiq/server/services/question-bank.service';
import { QuestionTransferService } from '@studiq/server/services/question-transfer.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/authz', () => ({
  can: vi.fn().mockResolvedValue(true),
  check: vi.fn().mockResolvedValue(undefined),
  Permission: {
    QUESTION_CREATE: 'question.create',
    QUESTION_BANK_UPDATE: 'question_bank.update',
  },
}));
vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@studiq/server/services/question.service', () => ({
  questionService: { listBankQuestions: vi.fn() },
}));
vi.mock('@studiq/server/services/question-bank.service', () => ({
  questionBankService: { getById: vi.fn() },
}));
vi.mock('@studiq/server/lib/log', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// #652: export reads a bank through the same access-checked services as the screens; import
// validates against the database (bank, permission, plan limit) and lands completely or not
// at all.

/** A thenable query builder that records what was asked and resolves to `result`. */
function builder(result: Record<string, unknown> = { data: null, error: null }) {
  const b: any = {};
  for (const m of ['select', 'eq', 'is', 'in', 'insert', 'delete']) b[m] = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.then = (onfulfilled: any) => Promise.resolve(result).then(onfulfilled);
  return b;
}

const ctx: RequestContext = {
  userId: 'teacher-1',
  accountType: AccountType.EDUCATOR,
  traceId: 't',
  url: '',
  method: 'POST',
  activeOrgId: 'org-1',
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

/** The same caller with no organisation selected in the app. */
const personalCtx: RequestContext = { ...ctx, activeOrgId: null };

const q = (over: Partial<TransferQuestion> = {}): TransferQuestion => ({
  type: 'mcq',
  content: 'Q',
  topics: [],
  answers: [
    { content: 'A', isCorrect: true },
    { content: 'B', isCorrect: false },
  ],
  ...over,
});

describe('QuestionTransferService.exportBank', () => {
  let service: QuestionTransferService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new QuestionTransferService(async () => ({}) as any);
  });

  it('maps the questions of a readable bank, answers in their stored order', async () => {
    vi.mocked(questionBankService.getById).mockResolvedValue(success({ name: 'Fizyka' }) as any);
    vi.mocked(questionService.listBankQuestions).mockResolvedValue(
      success([
        {
          type: 'mcq',
          content: 'Q1',
          explanation: 'because',
          topics: [{ name: 'Mechanika' }],
          question_answers: [
            { content: 'B', is_correct: false, order_index: 1 },
            { content: 'A', is_correct: true, order_index: 0 },
          ],
        },
        { type: 'open', content: 'Q2', explanation: null, topics: [], question_answers: [] },
      ]) as any,
    );

    const result = await service.exportBank(ctx, 'bank-1');

    expect(questionService.listBankQuestions).toHaveBeenCalledWith('bank-1');
    expect(result.success && result.data).toEqual({
      bankName: 'Fizyka',
      questions: [
        {
          type: 'mcq',
          content: 'Q1',
          explanation: 'because',
          topics: ['Mechanika'],
          answers: [
            { content: 'A', isCorrect: true },
            { content: 'B', isCorrect: false },
          ],
        },
        { type: 'open', content: 'Q2', topics: [], answers: [] },
      ],
      notReimportable: 0,
    });
  });

  const listed = (rows: unknown[], questionCount = rows.length) => {
    vi.mocked(questionBankService.getById).mockResolvedValue(
      success({ name: 'B', question_count: questionCount }) as any,
    );
    vi.mocked(questionService.listBankQuestions).mockResolvedValue(success(rows) as any);
  };
  const row = (over: Record<string, unknown> = {}) => ({
    type: 'mcq',
    content: 'Q',
    explanation: null,
    topics: [],
    question_answers: [
      { content: 'A', is_correct: true, order_index: 0 },
      { content: 'B', is_correct: false, order_index: 1 },
    ],
    ...over,
  });

  it('refuses a bank above the cap before reading it, the way PostgREST would clamp it', async () => {
    // The real query returns at most 1000 rows (max_rows), so the bank's own count decides.
    listed(
      Array.from({ length: 1000 }, () => row()),
      1500,
    );

    const result = await service.exportBank(ctx, 'bank-1');

    expect(result).toMatchObject({ success: false, error: 'UNPROCESSABLE_ENTITY' });
    expect(questionService.listBankQuestions).not.toHaveBeenCalled();
  });

  it('never answers with fewer questions than the bank holds', async () => {
    listed(
      Array.from({ length: 10 }, () => row()),
      12,
    );

    const result = await service.exportBank(ctx, 'bank-1');

    expect(result.success).toBe(false);
  });

  it('exports a bank of exactly the cap', async () => {
    listed(Array.from({ length: 1000 }, () => row()));

    const result = await service.exportBank(ctx, 'bank-1');

    expect(result.success && result.data.questions).toHaveLength(1000);
  });

  it('counts the questions the importer would reject, and exports them anyway', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      content: `A${i}`,
      is_correct: i === 0,
      order_index: i,
    }));
    listed([row(), row({ question_answers: eleven })]);

    const result = await service.exportBank(ctx, 'bank-1');

    expect(result.success && result.data.notReimportable).toBe(1);
    expect(result.success && result.data.questions).toHaveLength(2);
  });

  it('answers NOT_FOUND for a bank the caller cannot read, without listing questions', async () => {
    vi.mocked(questionBankService.getById).mockResolvedValue(failure('NOT_FOUND') as any);

    const result = await service.exportBank(ctx, 'foreign');

    expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
    expect(questionService.listBankQuestions).not.toHaveBeenCalled();
  });
});

describe('QuestionTransferService.importQuestions', () => {
  let tables: Record<string, any>;
  let inserts: Record<string, any[]>;
  let service: QuestionTransferService;

  /** `from()` hands out one builder per call; each table may be asked for several times. */
  function setup(overrides: Record<string, Array<Record<string, unknown>>> = {}) {
    inserts = {};
    const queues: Record<string, Array<Record<string, unknown>>> = {
      question_banks: [
        {
          data: {
            id: 'bank-1',
            visibility: 'group',
            created_by: 'teacher-1',
            organization_id: 'org-1',
          },
          error: null,
        },
      ],
      questions: [
        { count: 3, data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      topics: [
        { data: [{ id: 'topic-1', name: 'Mechanika' }], error: null },
        { data: [{ id: 'topic-2', name: 'Optyka' }], error: null },
      ],
      question_options: [{ data: null, error: null }],
      question_topic_assignments: [{ data: null, error: null }],
      ...overrides,
    };
    tables = {};
    const supabase = {
      from: vi.fn((table: string) => {
        const result = queues[table]?.shift() ?? { data: null, error: null };
        const b = builder(result);
        const insert = b.insert;
        b.insert = vi.fn((rows: unknown) => {
          (inserts[table] ??= []).push(rows);
          return insert(rows);
        });
        (tables[table] ??= []).push(b);
        return b;
      }),
    };
    service = new QuestionTransferService(async () => supabase as any);
    return supabase;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(can).mockResolvedValue(true);
    vi.mocked(check).mockResolvedValue(undefined as any);
    vi.mocked(limitsResolver.checkLimit).mockResolvedValue(undefined);
  });

  it('refuses a caller without the question.create permission before touching the database', async () => {
    const supabase = setup();
    vi.mocked(can).mockResolvedValue(false);

    await expect(service.importQuestions(ctx, 'bank-1', [q()])).rejects.toThrow();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an unknown bank', async () => {
    setup({ question_banks: [{ data: null, error: null }] });
    const result = await service.importQuestions(ctx, 'nope', [q()]);
    expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
  });

  it('requires the right to update the bank', async () => {
    setup();
    vi.mocked(check).mockRejectedValue(new Error('FORBIDDEN'));
    await expect(service.importQuestions(ctx, 'bank-1', [q()])).rejects.toThrow('FORBIDDEN');
    expect(inserts.questions).toBeUndefined();
  });

  it('checks the plan limit for the whole batch before writing anything', async () => {
    setup();
    vi.mocked(limitsResolver.checkLimit).mockRejectedValue(new Error('USAGE_LIMIT_EXCEEDED'));

    await expect(service.importQuestions(ctx, 'bank-1', [q(), q(), q()])).rejects.toThrow(
      'USAGE_LIMIT_EXCEEDED',
    );
    expect(limitsResolver.checkLimit).toHaveBeenCalledWith(ctx, 'max_questions', 3, 3);
    expect(inserts.questions).toBeUndefined();
  });

  it('creates the questions in the bank with its visibility, then options and topic links', async () => {
    setup();
    const result = await service.importQuestions(ctx, 'bank-1', [
      q({ content: 'One', topics: ['mechanika', 'Optyka', 'Mechanika'] }),
      q({ content: 'Two', type: 'open', answers: [] }),
    ]);

    expect(result.success && result.data).toEqual({ imported: 2 });

    const questions = inserts.questions[0] as any[];
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      content: 'One',
      type: 'mcq',
      bank_id: 'bank-1',
      visibility: 'group',
      created_by: 'teacher-1',
      organization_id: 'org-1',
    });
    expect(new Set(questions.map((r) => r.id)).size).toBe(2);

    const options = inserts.question_options[0] as any[];
    expect(options).toEqual([
      { question_id: questions[0].id, content: 'A', is_correct: true, order_index: 0 },
      { question_id: questions[0].id, content: 'B', is_correct: false, order_index: 1 },
    ]);

    // "mechanika" and "Mechanika" are the same existing topic, "Optyka" is created.
    expect(inserts.topics[0]).toEqual([
      expect.objectContaining({
        name: 'Optyka',
        created_by: 'teacher-1',
        organization_id: 'org-1',
        visibility: 'personal',
      }),
    ]);
    expect(inserts.question_topic_assignments[0]).toEqual([
      { question_id: questions[0].id, topic_id: 'topic-1' },
      { question_id: questions[0].id, topic_id: 'topic-2' },
    ]);
  });

  it('keeps a personal bank personal even when an organisation is active', async () => {
    setup({
      question_banks: [
        {
          data: {
            id: 'bank-1',
            visibility: 'personal',
            created_by: 'teacher-1',
            organization_id: null,
          },
          error: null,
        },
      ],
    });

    await service.importQuestions(ctx, 'bank-1', [q({ topics: ['Optyka'] })]);

    expect(inserts.questions[0][0]).toMatchObject({ organization_id: null });
    expect(inserts.topics[0][0]).toMatchObject({ name: 'Optyka', organization_id: null });
    // The limit count and the topic lookup follow the bank's tenant, not `ctx.activeOrgId`: a
    // personal bucket is `IS NULL`, never `eq(col, null)` (the 22P02/500 case).
    expect(tables.questions[0].eq.mock.calls.map((call) => call[0])).toEqual(['created_by']);
    expect(tables.questions[0].is).toHaveBeenCalledWith('organization_id', null);
    expect(tables.topics[0].is).toHaveBeenCalledWith('organization_id', null);
    // Counted and charged in the same bucket: the personal plan, not the selected org's.
    expect(limitsResolver.checkLimit.mock.calls[0][0].activeOrgId).toBeNull();
  });

  it('writes into the bank organisation even when no organisation is active', async () => {
    setup();

    await service.importQuestions(personalCtx, 'bank-1', [q({ topics: ['Optyka'] })]);

    expect(inserts.questions[0][0]).toMatchObject({ organization_id: 'org-1' });
    expect(inserts.topics[0][0]).toMatchObject({ name: 'Optyka', organization_id: 'org-1' });
    expect(tables.questions[0].eq).toHaveBeenCalledWith('organization_id', 'org-1');
    // ...and the org's plan counts it, even though no org is selected in the app.
    expect(limitsResolver.checkLimit.mock.calls[0][0].activeOrgId).toBe('org-1');
  });

  it('writes no option or topic rows for questions that have none', async () => {
    setup();
    await service.importQuestions(ctx, 'bank-1', [q({ type: 'open', answers: [] })]);
    expect(inserts.question_options).toBeUndefined();
    expect(inserts.question_topic_assignments).toBeUndefined();
  });

  it('removes the created questions when writing the options fails', async () => {
    setup({ question_options: [{ data: null, error: { code: 'XX000', message: 'boom' } }] });

    const result = await service.importQuestions(ctx, 'bank-1', [q(), q()]);

    expect(result.success).toBe(false);
    const created = (inserts.questions[0] as any[]).map((r) => r.id);
    const cleanup = tables.questions.at(-1);
    expect(cleanup.delete).toHaveBeenCalled();
    expect(cleanup.in).toHaveBeenCalledWith('id', created);
  });

  it('removes a failed import in batches of 100 ids', async () => {
    setup({ question_options: [{ data: null, error: { code: 'XX000', message: 'boom' } }] });
    const many = Array.from({ length: 250 }, (_, i) => q({ content: `Q${i}` }));

    const result = await service.importQuestions(ctx, 'bank-1', many);

    expect(result.success).toBe(false);
    const created = (inserts.questions[0] as any[]).map((r) => r.id);
    // One `in (…)` per 100 ids: the whole batch in one request is ~18 KB of query string.
    const chunks = tables.questions.slice(2).map((b) => b.in.mock.calls[0][1] as string[]);
    expect(chunks.map((ids) => ids.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(created);
  });

  it('reports the failure the caller hit and logs the rollback failure separately', async () => {
    setup({
      questions: [
        { count: 3, data: null, error: null },
        { data: null, error: null },
        { data: null, error: { code: '42501', message: 'denied' } },
      ],
      question_options: [{ data: null, error: { code: 'XX000', message: 'boom' } }],
    });

    const result = await service.importQuestions(ctx, 'bank-1', [q(), q()]);

    // The original write failed, not the caller's access: `42501` from the cleanup must not turn
    // a half-written import into "you may not add questions to this bank".
    expect(result).toMatchObject({ success: false, error: 'INTERNAL_SERVER' });
    expect(logError).toHaveBeenCalledWith('question-transfer.rollback_failed', {
      bankId: 'bank-1',
      total: 2,
      remaining: 2,
      originalError: 'XX000: boom',
      cleanupError: '42501: denied',
    });
  });

  it('logs only the questions the rollback never reached', async () => {
    setup({
      questions: [
        { count: 0, data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: { code: '57014', message: 'timeout' } },
      ],
      question_options: [{ data: null, error: { code: 'XX000', message: 'boom' } }],
    });
    const many = Array.from({ length: 250 }, (_, i) => q({ content: `Q${i}` }));

    await service.importQuestions(ctx, 'bank-1', many);

    // The first 100 were deleted; the other 150 are what the log reports as left behind.
    expect(logError).toHaveBeenCalledWith(
      'question-transfer.rollback_failed',
      expect.objectContaining({ total: 250, remaining: 150 }),
    );
  });
});

describe('QuestionTransferController', () => {
  const service = { exportBank: vi.fn(), importQuestions: vi.fn() };
  const controller = new QuestionTransferController(service as any);

  beforeEach(() => vi.clearAllMocks());

  it('exports CSV by default with a safe ASCII file name', async () => {
    service.exportBank.mockResolvedValue(
      success({
        bankName: 'Łódź: "Ćwiczenia"/1',
        questions: [q({ type: 'open', answers: [] })],
        notReimportable: 0,
      }),
    );

    const response = await controller.exportBank('b', {}, ctx);

    expect(response).toMatchObject({ success: true });
    const file = (response as any).data;
    expect(file.notReimportable).toBe(0);
    expect(file.filename).toBe('questions-lodz-cwiczenia-1.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.body.startsWith('﻿type,content')).toBe(true);
  });

  it('exports JSON with the format version, bank name and questions', async () => {
    service.exportBank.mockResolvedValue(success({ bankName: 'B', questions: [q()] }));

    const response = await controller.exportBank('b', { format: 'json' }, ctx);
    const file = (response as any).data;

    expect(file.filename).toBe('questions-b.json');
    expect(JSON.parse(file.body)).toMatchObject({ version: 1, bank: 'B', questions: [q()] });
  });

  it('answers 422 for an unknown format and for an invalid import body', async () => {
    expect(await controller.exportBank('b', { format: 'xml' }, ctx)).toMatchObject({
      success: false,
      statusCode: 422,
    });
    expect(await controller.importQuestions('b', { questions: [] }, ctx)).toMatchObject({
      success: false,
      statusCode: 422,
    });
    expect(await controller.importQuestions('b', null, ctx)).toMatchObject({
      success: false,
      statusCode: 422,
    });
    expect(service.importQuestions).not.toHaveBeenCalled();
  });

  it('answers 201 with the number of imported questions', async () => {
    service.importQuestions.mockResolvedValue(success({ imported: 1 }));

    const response = await controller.importQuestions('b', { questions: [q()] }, ctx);

    expect(response).toMatchObject({ success: true, statusCode: 201, data: { imported: 1 } });
    expect(service.importQuestions).toHaveBeenCalledWith(ctx, 'b', [
      expect.objectContaining({ content: 'Q', topics: [] }),
    ]);
  });
});
