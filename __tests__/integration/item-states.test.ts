import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
  seedOrgMembership,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { asJson, json } from '#test/helpers/json';
import {
  GET as listQuestions,
  POST as createQuestionPost,
} from '@/app/(backend)/api/v1/questions/route';
import {
  GET as listBanks,
  POST as createBankPost,
} from '@/app/(backend)/api/v1/questions/banks/route';
import {
  DELETE as deleteQuestion,
  GET as getQuestion,
} from '@/app/(backend)/api/v1/questions/[id]/route';
import {
  DELETE as deleteBank,
  GET as getBank,
} from '@/app/(backend)/api/v1/questions/banks/[id]/route';
import { POST as generateQuiz } from '@/app/(backend)/api/v1/quiz/new/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import {
  GET as listQuizzes,
  POST as createQuizPost,
} from '@/app/(backend)/api/v1/teacher/quizzes/route';
import { GET as getQuiz } from '@/app/(backend)/api/v1/teacher/quizzes/[id]/route';
import { POST as addQuizQuestions } from '@/app/(backend)/api/v1/teacher/quizzes/[id]/questions/route';
import { POST as createAssignmentFromQuiz } from '@/app/(backend)/api/v1/teacher/quizzes/[id]/create-assignment/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1171 slice 1a: item states (`open`/`retired`/`deleted`) and the database-maintained version
// counter. The behaviour seam is the real service stack against local Supabase; the frozen
// assessment snapshot lands in the stacked slice.

/** A published run must be able to close (publish gate, R2/R5). */
const DEADLINE = new Date(Date.now() + 2 * 86_400_000).toISOString();

describe('Item states and versioning (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let assignmentId: string;

  async function bankOf(questionId: string): Promise<string> {
    const { data } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    return asJson<{ bank_id: string }>(data).bank_id;
  }

  async function createQuiz(label: string): Promise<string> {
    mockUser(teacher.user);
    const request = createNextRequest(
      'http://localhost/api/v1/teacher/quizzes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `state-quiz-${label}` }),
      },
      { active_org_id: teacher.orgId ?? '' },
    );
    const response = await createQuizPost(request);
    const body = await json<{ data: { id: string } }>(response);
    expect(response.status, JSON.stringify(body)).toBe(201);
    return body.data.id;
  }

  async function addItemsToQuiz(quizId: string, questionIds: string[]): Promise<void> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/quizzes/${quizId}/questions`,
      { id: quizId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds }),
      },
      { active_org_id: teacher.orgId ?? '' },
    );
    const response = await addQuizQuestions(request, { params });
    expect(response.status, await response.text()).toBe(200);
  }

  async function deleteAsTeacher(questionId: string): Promise<void> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      { method: 'DELETE' },
    );
    const response = await deleteQuestion(request, { params });
    expect(response.status).toBe(200);
  }

  async function createBank(label: string): Promise<string> {
    mockUser(teacher.user);
    const request = createNextRequest('http://localhost/api/v1/questions/banks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `state-bank-${label}`, visibility: 'group' }),
    });
    const response = await createBankPost(request);
    const body = await json<{ data: { id: string } }>(response);
    expect(response.status, JSON.stringify(body)).toBe(201);
    return body.data.id;
  }

  async function createQuestion(label: string, bankId?: string): Promise<string> {
    const targetBank =
      bankId ?? (await bankOf(requiredAt(teacher.created.questions, 0, 'seeded question')));
    mockUser(teacher.user);
    const request = createNextRequest('http://localhost/api/v1/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankId: targetBank,
        type: 'mcq',
        content: `state-${label}-stem`,
        answers: [
          { content: `state-${label}-correct`, isCorrect: true, orderIndex: 0 },
          { content: `state-${label}-wrong`, isCorrect: false, orderIndex: 1 },
        ],
      }),
    });
    const response = await createQuestionPost(request);
    const body = await json<{ data: { id: string } }>(response);
    expect(response.status, JSON.stringify(body)).toBe(201);
    return body.data.id;
  }

  async function versionOf(questionId: string): Promise<number> {
    const { data } = await service
      .from('questions')
      .select('version')
      .eq('id', questionId)
      .single();
    return asJson<{ version: number }>(data).version;
  }

  async function createDraftAssignment(): Promise<string> {
    mockUser(teacher.user);
    const request = createNextRequest('http://localhost/api/v1/teacher/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `state-draft-${Date.now().toString(36)}` }),
    });
    const response = await createAssignmentPost(request);
    expect(response.status).toBe(201);
    return (await json<{ data: { id: string } }>(response)).data.id;
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, questions: 2, assignment: true });
    student = await before({ role: 'student' });
    assignmentId = asJson<string>(teacher.created.assignmentId);
    if (!assignmentId || !teacher.orgId) throw new Error('assignment fixture missing');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', teacher.orgId)
      .eq('name', 'member')
      .single();
    await seedOrgMembership({
      organizationId: teacher.orgId,
      userId: student.user.id,
      orgRoleId: asJson<{ id: string }>(memberRole).id,
    });

    mockUser(teacher.user);
    const { request: questionsReq, params: questionsParams } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: teacher.created.questions }),
      },
    );
    expect((await addQuestionsPost(questionsReq, { params: questionsParams })).status).toBe(200);

    const { request: targetsReq, params: targetsParams } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: [student.user.id] }),
      },
    );
    expect((await targetsPut(targetsReq, { params: targetsParams })).status).toBe(200);

    const { request: publishReq, params: publishParams } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: DEADLINE }),
      },
    );
    const publishRes = await publishPost(publishReq, { params: publishParams });
    expect(publishRes.status, await publishRes.text()).toBe(200);
  });

  afterAll(async () => {
    await service.from('quizzes').delete().eq('created_by', teacher.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await service
      .from('question_banks')
      .delete()
      .eq('created_by', teacher.user.id)
      .ilike('name', 'state-bank-%');
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupQuestions(teacher.user.id, 'state-');
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
  });

  it('bumps the version on content and option changes, but not on a status change', async () => {
    const questionId = await createQuestion('version');
    const afterCreate = await versionOf(questionId);

    await service
      .from('questions')
      .update({ content: 'state-version-new-stem' })
      .eq('id', questionId);
    const afterContent = await versionOf(questionId);
    expect(afterContent).toBeGreaterThan(afterCreate);

    await service.from('questions').update({ status: 'retired' }).eq('id', questionId);
    expect(await versionOf(questionId), 'a status is not content').toBe(afterContent);

    const { data: option } = await service
      .from('question_options')
      .select('id')
      .eq('question_id', questionId)
      .limit(1)
      .single();
    await service
      .from('question_options')
      .update({ content: 'state-version-option-edited' })
      .eq('id', asJson<{ id: string }>(option).id);
    expect(await versionOf(questionId)).toBeGreaterThan(afterContent);
  });

  it('refuses to bind a retired item to a new assignment', async () => {
    const questionId = await createQuestion('retired');
    await service.from('questions').update({ status: 'retired' }).eq('id', questionId);

    const draft = await createDraftAssignment();
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${draft}/questions`,
      { id: draft },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [questionId] }),
      },
    );
    const response = await addQuestionsPost(request, { params });
    expect(response.status).toBe(422);
  });

  it('hides a deleted item from authoring and practice, and keeps the versioned row', async () => {
    const questionId = await createQuestion('deleted');
    const bankId = await bankOf(questionId);

    mockUser(teacher.user);
    const { request: deleteReq, params: deleteParams } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      { method: 'DELETE' },
    );
    expect((await deleteQuestion(deleteReq, { params: deleteParams })).status).toBe(200);

    const { data: row } = await service
      .from('questions')
      .select('id, status')
      .eq('id', questionId)
      .maybeSingle();
    expect(asJson<{ status: string } | null>(row)?.status, 'soft delete keeps the row').toBe(
      'deleted',
    );

    const { request: getReq, params: getParams } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
    );
    expect((await getQuestion(getReq, { params: getParams })).status).toBe(404);

    mockUser(teacher.user);
    const listReq = createNextRequest(`http://localhost/api/v1/questions?bankId=${bankId}`);
    const listBody = await json<{ data: Array<{ id: string }> }>(await listQuestions(listReq));
    expect(listBody.data.some((item) => item.id === questionId)).toBe(false);

    const quizReq = createNextRequest('http://localhost/api/v1/quiz/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankId, questionTypes: ['mcq'], questionCount: 10 }),
    });
    const quizRes = await generateQuiz(quizReq);
    const quizBody = await json<{ success: boolean; data?: { questions: Array<{ id: string }> } }>(
      quizRes,
    );
    expect(
      quizBody.data?.questions.some((question) => question.id === questionId) ?? false,
      'practice never draws a deleted item',
    ).toBe(false);
  });

  it('refuses to delete a bank whose items are bound to a published assessment', async () => {
    const boundQuestion = requiredAt(teacher.created.questions, 0, 'seeded question');
    const bankId = await bankOf(boundQuestion);

    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${bankId}`,
      { id: bankId },
      { method: 'DELETE' },
    );
    const response = await deleteBank(request, { params });
    expect(response.status, 'the bound item must not be cascaded away').toBe(409);
  });

  it('counts only non-deleted items on a bank card and its detail (#1171)', async () => {
    const bankId = await createBank(`counts-${Date.now().toString(36)}`);
    await createQuestion('counts-keep', bankId);
    const gone = await createQuestion('counts-gone', bankId);
    await deleteAsTeacher(gone);

    mockUser(teacher.user);
    const { request: detailReq, params: detailParams } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${bankId}`,
      { id: bankId },
    );
    const detail = await json<{ data: { question_count: number } }>(
      await getBank(detailReq, { params: detailParams }),
    );
    expect(detail.data.question_count, 'the detail contradicts the list otherwise').toBe(1);

    const listRes = await listBanks(
      createNextRequest('http://localhost/api/v1/questions/banks?limit=100'),
    );
    const listBody = await json<{ data: { items: Array<{ id: string; question_count: number }> } }>(
      listRes,
    );
    expect(listBody.data.items.find((bank) => bank.id === bankId)?.question_count).toBe(1);
  });

  it('counts only non-deleted items on a quiz and hides them from its builder (#1171)', async () => {
    const bankId = await createBank(`quiz-counts-${Date.now().toString(36)}`);
    const keep = await createQuestion('quiz-counts-keep', bankId);
    const gone = await createQuestion('quiz-counts-gone', bankId);
    const quizId = await createQuiz(`counts-${Date.now().toString(36)}`);
    await addItemsToQuiz(quizId, [keep, gone]);
    await deleteAsTeacher(gone);

    mockUser(teacher.user);
    const listRes = await listQuizzes(
      createNextRequest('http://localhost/api/v1/teacher/quizzes', undefined, {
        active_org_id: teacher.orgId ?? '',
      }),
    );
    const listBody = await json<{
      data: Array<{ id: string; quiz_questions: Array<{ count: number }> }>;
    }>(listRes);
    expect(listBody.data.find((quiz) => quiz.id === quizId)?.quiz_questions[0]?.count).toBe(1);

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/quizzes/${quizId}`,
      { id: quizId },
      undefined,
      { active_org_id: teacher.orgId ?? '' },
    );
    const detail = await json<{ data: { quiz_questions: Array<{ question_id: string }> } }>(
      await getQuiz(request, { params }),
    );
    expect(detail.data.quiz_questions.map((item) => item.question_id)).toEqual([keep]);
  });

  it('refuses to copy a quiz with a retired or deleted item, and creates nothing (#1171)', async () => {
    const bankId = await createBank(`bind-${Date.now().toString(36)}`);
    const retired = await createQuestion('bind-retired', bankId);
    const deleted = await createQuestion('bind-deleted', bankId);
    const quizId = await createQuiz(`bind-${Date.now().toString(36)}`);
    await addItemsToQuiz(quizId, [retired, deleted]);

    await service.from('questions').update({ status: 'retired' }).eq('id', retired);
    await service.from('questions').update({ status: 'deleted' }).eq('id', deleted);

    mockUser(teacher.user);
    const title = `state-copy-${Date.now().toString(36)}`;
    const createRes = await createAssignmentPost(
      createNextRequest('http://localhost/api/v1/teacher/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, quizId }),
      }),
    );
    expect(createRes.status, await createRes.text()).toBe(422);

    const fromQuizParams = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/quizzes/${quizId}/create-assignment`,
      { id: quizId },
      { method: 'POST' },
      { active_org_id: teacher.orgId ?? '' },
    );
    const fromQuizRes = await createAssignmentFromQuiz(fromQuizParams.request, {
      params: fromQuizParams.params,
    });
    expect(fromQuizRes.status, await fromQuizRes.text()).toBe(422);

    const { count } = await service
      .from('teacher_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', teacher.user.id)
      .eq('quiz_id', quizId);
    expect(count, 'a refused copy must not leave an assignment behind').toBe(0);
    const { count: titled } = await service
      .from('teacher_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', teacher.user.id)
      .eq('title', title);
    expect(titled).toBe(0);
  });

  it('still creates an assessment from a quiz whose items are all open', async () => {
    const bankId = await createBank(`open-${Date.now().toString(36)}`);
    const open = await createQuestion('open-item', bankId);
    const quizId = await createQuiz(`open-${Date.now().toString(36)}`);
    await addItemsToQuiz(quizId, [open]);

    const params = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/quizzes/${quizId}/create-assignment`,
      { id: quizId },
      { method: 'POST' },
      { active_org_id: teacher.orgId ?? '' },
    );
    mockUser(teacher.user);
    const response = await createAssignmentFromQuiz(params.request, { params: params.params });
    expect(response.status, await response.text()).toBe(201);

    const { data: links } = await service
      .from('assignment_questions')
      .select('question_id')
      .eq('assignment_id', await assignmentIdOfQuiz(quizId));
    expect(asJson<Array<{ question_id: string }>>(links).map((row) => row.question_id)).toEqual([
      open,
    ]);
  });

  async function assignmentIdOfQuiz(quizId: string): Promise<string> {
    const { data } = await service
      .from('teacher_assignments')
      .select('id')
      .eq('quiz_id', quizId)
      .single();
    return asJson<{ id: string }>(data).id;
  }
});
