import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { type BeforeResult, before, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupFlashcardTopics,
  cleanupOrganizationByName,
  createServiceClient,
  mockUser,
  seedQuestion,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { GET as GET_BANK_EXPORT } from '@/app/(backend)/api/v1/questions/banks/[id]/export/route';
import {
  GET as GET_QUESTION,
  PUT as PUT_QUESTION,
} from '@/app/(backend)/api/v1/questions/[id]/route';
import { GET as GET_LIST } from '@/app/(backend)/api/v1/questions/route';

// #1170, R15: the API is the second line, not the first — but a reader payload must not carry
// the key either, and export must not hand a student the whole keyed file. These tests run the
// real route handlers against the local database with a mocked session (`mockUser`).

const suiteId = crypto.randomUUID().slice(0, 8);

interface OptionPayload {
  id: string;
  content: string;
  is_correct?: boolean;
}

interface QuestionPayload {
  id: string;
  content: string;
  explanation?: string;
  question_answers: OptionPayload[];
}

interface SingleEnvelope {
  success: boolean;
  data: QuestionPayload;
}

interface ListEnvelope {
  success: boolean;
  data: QuestionPayload[];
}

interface ErrorEnvelope {
  success: boolean;
  error?: string;
}

describe('Answer key on the app surface (#1170)', () => {
  let educator!: BeforeResult;
  let student!: TestUserFixture;
  let orgId!: string;
  let bankId!: string;
  let ownBankId!: string;
  let questionId!: string;

  beforeAll(async () => {
    educator = await before({ role: 'educator', org: true, members: { count: 1 }, questions: 1 });
    orgId = educator.orgId!;
    student = educator.memberUsers[0]!;
    questionId = educator.created.questions[0]!;

    const { data: question } = await createServiceClient()
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    bankId = question!.bank_id;

    // The member role reads questions at `group` scope, so the bank has to be shared with the
    // student's group before the app's read path applies to them.
    await createServiceClient()
      .from('bank_groups')
      .insert({ bank_id: bankId, group_id: educator.defaultGroupId! });

    // The student's own personal bank with one keyed question in it: outside the org the
    // personal set gives a student `own` on content keys, so this bank is both readable
    // and updatable by its author.
    const { data: ownBank } = await createServiceClient()
      .from('question_banks')
      .insert({
        name: `student-own-bank-${suiteId}`,
        created_by: student.id,
        organization_id: null,
        visibility: 'personal',
      })
      .select('id')
      .single();
    ownBankId = ownBank!.id;
    const ownQuestion = await seedQuestion({
      type: 'mcq',
      content: `own-bank-question-${suiteId}`,
      created_by: student.id,
      bank_id: ownBankId,
    });
    await createServiceClient()
      .from('question_options')
      .insert([
        { question_id: ownQuestion.id, content: 'own-answer-a', is_correct: true, order_index: 0 },
        { question_id: ownQuestion.id, content: 'own-answer-b', is_correct: false, order_index: 1 },
      ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupFlashcardTopics(educator.user.id, `seed-${suiteId}`);
    await cleanupOrganizationByName('seed-org-');
  });

  const orgCookies = () => ({ active_org_id: orgId });

  function getQuestion(user: TestUserFixture) {
    mockUser(user);
    return GET_QUESTION(
      createNextRequest(
        `http://localhost/api/v1/questions/${questionId}`,
        { method: 'GET' },
        orgCookies(),
      ),
      { params: Promise.resolve({ id: questionId }) },
    );
  }

  it('serves a student options without is_correct and without the explanation', async () => {
    const response = await getQuestion(student);
    const body = await json<SingleEnvelope>(response);

    expect(response.status).toBe(200);
    expect(body.data.question_answers.length).toBeGreaterThan(0);
    for (const option of body.data.question_answers) {
      expect(option).not.toHaveProperty('is_correct');
    }
    expect(body.data).not.toHaveProperty('explanation');
  });

  it('serves a teacher the key and the explanation', async () => {
    const response = await getQuestion(educator.user);
    const body = await json<SingleEnvelope>(response);

    expect(response.status).toBe(200);
    expect(body.data.question_answers.map((option) => option.is_correct)).toEqual([
      true,
      false,
      false,
    ]);
    // The explanation is part of the staff key surface (#1173: every choice item has one).
    const { data: stored } = await createServiceClient()
      .from('questions')
      .select('explanation')
      .eq('id', questionId)
      .single();
    expect(body.data.explanation).toBe(stored?.explanation);
  });

  it('serves the list without a key to a student and with one to the teacher', async () => {
    mockUser(student);
    const studentList = await GET_LIST(
      createNextRequest(
        `http://localhost/api/v1/questions?bankId=${bankId}`,
        { method: 'GET' },
        orgCookies(),
      ),
    );
    const studentBody = await json<ListEnvelope>(studentList);
    expect(studentList.status).toBe(200);
    for (const question of studentBody.data) {
      for (const option of question.question_answers)
        expect(option).not.toHaveProperty('is_correct');
      expect(question).not.toHaveProperty('explanation');
    }

    mockUser(educator.user);
    const teacherList = await GET_LIST(
      createNextRequest(
        `http://localhost/api/v1/questions?bankId=${bankId}`,
        { method: 'GET' },
        orgCookies(),
      ),
    );
    const teacherBody = await json<ListEnvelope>(teacherList);
    expect(teacherList.status).toBe(200);
    expect(teacherBody.data[0]?.question_answers.map((option) => option.is_correct)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('answers 404 for a bank the student cannot read — the lookup runs before the permission check', async () => {
    mockUser(student);
    // With the org active the member role's scopes are org-scoped, so the student's
    // personal bank is invisible to the read the export starts with: NOT_FOUND, an
    // unreadable bank indistinguishable from an unknown one (less information than a 403).
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${ownBankId}/export?format=csv`,
      { id: ownBankId },
      { method: 'GET' },
      orgCookies(),
    );

    const response = await GET_BANK_EXPORT(request, { params });
    const body = await json<ErrorEnvelope>(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('refuses with EXPORT_FORBIDDEN a bank the student can read but cannot update', async () => {
    mockUser(student);
    // The bank is shared with the student's group, so the member role's `group` read
    // reaches it — but `question_bank.update` sits at `own` and the bank is the
    // teacher's, so the export is refused.
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${bankId}/export?format=csv`,
      { id: bankId },
      { method: 'GET' },
      orgCookies(),
    );

    const response = await GET_BANK_EXPORT(request, { params });
    const body = await json<ErrorEnvelope>(response);

    expect(response.status).toBe(403);
    expect(body.error).toBe('EXPORT_FORBIDDEN');
  });

  it('exports the student own personal bank — question_bank.update at own scope is the whole gate', async () => {
    mockUser(student);
    // Without the org cookie the personal set is `own` for content keys, so the
    // student's own bank is readable AND updatable: the file is served with its key.
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${ownBankId}/export?format=csv`,
      { id: ownBankId },
      { method: 'GET' },
    );

    const response = await GET_BANK_EXPORT(request, { params });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toContain(
      `questions-student-own-bank-${suiteId}.csv`,
    );
    expect(body.split('\n')[0]).toContain('answer_1');
    expect(body).toContain(`own-bank-question-${suiteId}`);
    // The key column names the correct answer by its 1-based position.
    expect(body.split('\n')[1]).toContain(',1');
  });

  it('exports the keyed file for a teacher', async () => {
    mockUser(educator.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${bankId}/export?format=csv`,
      { id: bankId },
      { method: 'GET' },
      orgCookies(),
    );

    const response = await GET_BANK_EXPORT(request, { params });
    const body = await response.text();

    expect(response.status).toBe(200);
    // The CSV names the correct answer by its 1-based position; answer-a is index 1.
    expect(body.split('\n')[1]).toContain(',1');
  });

  it('judges an authoring patch against the stored explanation read server-side (#1180)', async () => {
    // `explanation` is revoked from `authenticated`, so the author's own item cannot be read with
    // their client: the update has to judge the merged item against the key reader's copy instead
    // of failing closed or accepting an item that no longer satisfies R16.
    const { data: stored } = await createServiceClient()
      .from('questions')
      .select('explanation')
      .eq('id', questionId)
      .single();

    mockUser(educator.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Renamed stem' }),
      },
      orgCookies(),
    );

    const response = await PUT_QUESTION(request, { params });
    const body = await json<SingleEnvelope>(response);

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data.content).toBe('Renamed stem');
    expect(body.data.explanation).toBe(stored?.explanation);
  });
});
