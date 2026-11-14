import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupQuizAttempts,
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
import { POST as generateQuiz } from '@/app/(backend)/api/v1/quiz/new/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as assignmentDetail } from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1171 slice 1: item states, the version counter and the frozen assessment snapshot. The
// behaviour seam is the real service stack (route -> controller -> service -> local Supabase);
// the column boundary is proven with real user JWTs in `assignment-snapshot-boundary.test.ts`.

interface TakePayload {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    type: string;
    explanation?: string;
    question_answers: Array<{ id: string; content: string; is_correct?: boolean }>;
  }>;
}

interface ReviewPayload {
  questions: TakePayload['questions'];
}

interface AssignmentDetailPayload {
  assignment_questions: Array<{
    question: {
      id: string;
      content: string;
      explanation: string | null;
      question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
    } | null;
  }>;
}

describe('Item states, versioning and the frozen assignment snapshot (#1171)', () => {
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

  async function startAs(): Promise<TakePayload> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
    );
    const response = await assignmentStart(request, { params });
    expect(response.status).toBe(200);
    return (await json<{ data: TakePayload }>(response)).data;
  }

  /** The teacher's edit path: new content + a fresh option set (new option ids). */
  async function editItem(questionId: string, label: string): Promise<number> {
    const { error: updateError } = await service
      .from('questions')
      .update({
        content: `snapshot-${label}-edited-stem`,
        explanation: `snapshot-${label}-edited-explanation`,
      })
      .eq('id', questionId);
    if (updateError) throw new Error(updateError.message);

    await service.from('question_options').delete().eq('question_id', questionId);
    const { error } = await service.from('question_options').insert([
      {
        question_id: questionId,
        content: `snapshot-${label}-edited-correct`,
        is_correct: true,
        order_index: 0,
      },
      {
        question_id: questionId,
        content: `snapshot-${label}-edited-wrong`,
        is_correct: false,
        order_index: 1,
      },
    ]);
    if (error) throw new Error(error.message);

    const { data } = await service
      .from('questions')
      .select('version')
      .eq('id', questionId)
      .single();
    return asJson<{ version: number }>(data).version;
  }

  async function liveContent(questionId: string): Promise<string> {
    const { data } = await service
      .from('questions')
      .select('content')
      .eq('id', questionId)
      .single();
    return asJson<{ content: string }>(data).content;
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

    // The seeded questions carry no explanation; the published key is what review renders.
    for (const [index, questionId] of teacher.created.questions.entries()) {
      await service
        .from('questions')
        .update({ explanation: `published-explanation-${index}` })
        .eq('id', questionId);
    }
    await service.from('teacher_assignments').update({ show_results: true }).eq('id', assignmentId);

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
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupQuestions(teacher.user.id, 'snapshot-');
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
  });

  it('serves the published snapshot to an in-progress attempt while the item is edited underneath it', async () => {
    const questionId = requiredAt(teacher.created.questions, 0, 'seeded question');
    const started = await startAs();
    const taken = started.questions.find((question) => question.id === questionId);
    if (!taken) throw new Error('the attempt did not serve the seeded question');
    expect(taken).not.toHaveProperty('explanation');
    expect(taken.question_answers[0]).not.toHaveProperty('is_correct');

    const { data: keyRow } = await service
      .from('question_options')
      .select('id')
      .eq('question_id', questionId)
      .eq('is_correct', true)
      .single();
    const publishedCorrectOptionId = asJson<{ id: string }>(keyRow).id;

    const { data: linkRow } = await service
      .from('assignment_questions')
      .select('snapshot_version')
      .eq('assignment_id', assignmentId)
      .eq('question_id', questionId)
      .single();
    const snapshotVersion = asJson<{ snapshot_version: number | null }>(linkRow).snapshot_version;

    const versionAfterEdit = await editItem(questionId, 'freeze');
    expect(snapshotVersion).not.toBeNull();
    expect(versionAfterEdit, 'the live item moved past its published version').toBeGreaterThan(
      snapshotVersion ?? 0,
    );

    mockUser(student.user);
    const { request: continueReq, params: continueParams } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${started.id}`,
      { attemptId: started.id },
    );
    const continued = await attemptGet(continueReq, { params: continueParams });
    const resumedList = (await json<{ data: ReviewPayload }>(continued)).data.questions;
    const resumed = resumedList.find((question) => question.id === questionId);
    if (!resumed) throw new Error('the resumed attempt did not serve the published question');
    expect(resumed.content, 'the live attempt keeps its published stem').toBe(taken.content);
    expect(resumed.question_answers.map((option) => option.id).toSorted()).toEqual(
      taken.question_answers.map((option) => option.id).toSorted(),
    );

    // The published option still scores, and the published key grades it (#1165 boundary intact).
    const { request: submitReq, params: submitParams } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${started.id}`,
      { attemptId: started.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: started.id,
          answers: [{ questionId, selectedAnswerId: publishedCorrectOptionId }],
        }),
      },
    );
    const submitted = await attemptPost(submitReq, { params: submitParams });
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    expect((await json<{ data: { score: number } }>(submitted)).data.score).toBe(1);

    const { request: reviewReq, params: reviewParams } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${started.id}`,
      { attemptId: started.id },
    );
    const reviewedList = (
      await json<{ data: ReviewPayload }>(await attemptGet(reviewReq, { params: reviewParams }))
    ).data.questions;
    const reviewed = reviewedList.find((question) => question.id === questionId);
    if (!reviewed) throw new Error('review did not render the published question');
    expect(reviewed.content).toBe(taken.content);
    expect(reviewed.explanation, 'review renders the published explanation').toBe(
      'published-explanation-0',
    );
    expect(
      reviewed.question_answers.find((option) => option.id === publishedCorrectOptionId)
        ?.is_correct,
    ).toBe(true);
  });

  it('keeps the published snapshot on the teacher print/detail payload, not the edited item', async () => {
    const questionId = requiredAt(teacher.created.questions, 1, 'seeded question');
    const publishedContent = await liveContent(questionId);
    const publishedVersion = await editItem(questionId, 'print');

    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}`,
      { id: assignmentId },
    );
    const response = await assignmentDetail(request, { params });
    expect(response.status).toBe(200);
    const detail = await json<{ data: AssignmentDetailPayload }>(response);

    const printed = detail.data.assignment_questions.find(
      (row) => row.question?.id === questionId,
    )?.question;
    expect(printed?.content, 'print renders the frozen stem').toBe(publishedContent);
    expect(printed?.explanation).toBe('published-explanation-1');
    expect(printed?.question_answers.some((option) => option.is_correct)).toBe(true);
    expect(publishedVersion).toBeGreaterThan(0);
  });

  it('gives a new practice quiz the live, edited version', async () => {
    const questionId = requiredAt(teacher.created.questions, 1, 'seeded question');
    const bankId = await bankOf(questionId);
    const live = await liveContent(questionId);
    expect(live, 'the previous test edited the item').toContain('edited');

    mockUser(teacher.user);
    const request = createNextRequest('http://localhost/api/v1/quiz/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankId, questionTypes: ['mcq'], questionCount: 10 }),
    });
    const response = await generateQuiz(request);
    expect(response.status).toBe(201);
    const body = await json<{ data: TakePayload }>(response);
    expect(
      body.data.questions.some(
        (question) => question.id === questionId && question.content === live,
      ),
    ).toBe(true);
  });
});
