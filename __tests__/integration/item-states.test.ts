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
  DELETE as deleteQuestion,
  GET as getQuestion,
} from '@/app/(backend)/api/v1/questions/[id]/route';
import { DELETE as deleteBank } from '@/app/(backend)/api/v1/questions/banks/[id]/route';
import { POST as generateQuiz } from '@/app/(backend)/api/v1/quiz/new/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1171 slice 1a: item states (`open`/`retired`/`deleted`) and the database-maintained version
// counter. The behaviour seam is the real service stack against local Supabase; the frozen
// assessment snapshot is covered by `item-snapshot.test.ts`.

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

  async function createQuestion(label: string): Promise<string> {
    const bankId = await bankOf(requiredAt(teacher.created.questions, 0, 'seeded question'));
    mockUser(teacher.user);
    const request = createNextRequest('http://localhost/api/v1/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankId,
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
        body: JSON.stringify({}),
      },
    );
    const publishRes = await publishPost(publishReq, { params: publishParams });
    expect(publishRes.status, await publishRes.text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupTeacherAssignments(teacher.user.id);
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
});
