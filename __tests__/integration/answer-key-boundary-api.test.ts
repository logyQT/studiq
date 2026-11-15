import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { type BeforeResult, before, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupFlashcardTopics,
  cleanupOrganizationByName,
  createServiceClient,
  mockUser,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { GET as GET_BANK_EXPORT } from '@/app/(backend)/api/v1/questions/banks/[id]/export/route';
import { GET as GET_QUESTION } from '@/app/(backend)/api/v1/questions/[id]/route';
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
    expect(body.data.explanation).toBeNull();
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

  it('refuses a student export with EXPORT_FORBIDDEN', async () => {
    mockUser(student);
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

    // Even a bank the student authors: export is staff-only, so the refusal cannot come from
    // the permission check alone.
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
    const own = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${ownBank!.id}/export?format=csv`,
      { id: ownBank!.id },
      { method: 'GET' },
      orgCookies(),
    );
    const ownResponse = await GET_BANK_EXPORT(own.request, { params: own.params });
    expect(ownResponse.status).toBe(403);
    expect((await json<ErrorEnvelope>(ownResponse)).error).toBe('EXPORT_FORBIDDEN');
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
});
