import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
import { FIXTURE_MODEL_ANSWER } from '#test/helpers/question-text';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
  seedGroupMembership,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequestWithParams, requiredAt } from '#test/integration/test-utils';
import { GET as reviewGet } from '@/app/(backend)/api/v1/assignments/[id]/review/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1173 (R16): the review renders the explanation for a choice item and the model answer for an
// open item, and an open item is outside the denominator — a mixed sheet scores out of the graded
// items only, and a sheet of open items has no score at all.

/** The shape every teacher route in this file shares: a body and the assignment id. */
type AssignmentRoute = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const TEACHING =
  'Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku, dlatego wyznacza oś hydrograficzną kraju, a pozostałe rzeki są od niej krótsze.';

function future(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; type: string; question_answers?: Array<{ id: string }> }>;
}

interface ReviewPayload {
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  /** The per-attempt index (#1174, R5): each attempt carries its own ungraded count. */
  attempts: Array<{ attemptId: string; ungradedCount: number }>;
  items: Array<{
    itemId: string;
    type: string;
    explanation: string | null;
    modelAnswer: string | null;
    graded: boolean;
    correct: boolean | null;
  }>;
}

describe('Review renders the teaching artefact and excludes ungraded items (#1173)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let openItemId!: string;
  let mcqItemId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function teacherCall<T>(
    route: AssignmentRoute,
    url: string,
    params: Record<string, string>,
    method: 'POST' | 'PUT',
    body: unknown,
  ): Promise<T> {
    mockUser(teacher.user);
    const { request, params: routeParams } = createNextRequestWithParams(
      `http://localhost${url}`,
      params,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      cookie(),
    );
    const response = await route(request, { params: Promise.resolve(routeParams) });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return (await json<{ data: T }>(response)).data;
  }

  /** A published, targeted run over `itemIds`, ready to be taken. */
  async function publishAssignment(itemIds: string[]): Promise<string> {
    const assignment = await teacherCall<{ id: string }>(
      createAssignmentPost,
      '/api/v1/teacher/assignments',
      {},
      'POST',
      { title: `review-model-answer-${Date.now()}`, deadline: future(), showResults: true },
    );

    await teacherCall(
      addQuestionsPost,
      `/api/v1/teacher/assignments/${assignment.id}/questions`,
      { id: assignment.id },
      'POST',
      { questionIds: itemIds },
    );
    await teacherCall(
      targetsPut,
      `/api/v1/teacher/assignments/${assignment.id}/targets`,
      { id: assignment.id },
      'PUT',
      { groupIds: [groupId] },
    );
    await teacherCall(
      publishPost,
      `/api/v1/teacher/assignments/${assignment.id}/publish`,
      { id: assignment.id },
      'POST',
      { deadline: future(), acknowledgeExposure: true },
    );
    return assignment.id;
  }

  /** Takes and submits `assignmentId` as the student; answers the submitted score. */
  async function takeAndSubmit(
    id: string,
    answers: () => Array<Record<string, string>>,
  ): Promise<number | null> {
    mockUser(student.user);
    const started = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${id}/start`,
      { id },
      { method: 'POST' },
      cookie(),
    );
    const startResponse = await assignmentStart(started.request, { params: started.params });
    expect(startResponse.status, await startResponse.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(startResponse)).data;

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers: answers() }),
      },
      cookie(),
    );
    const submitResponse = await attemptSubmit(submitted.request, { params: submitted.params });
    expect(submitResponse.status, await submitResponse.clone().text()).toBe(200);
    return (await json<{ data: { score: number | null } }>(submitResponse)).data.score;
  }

  async function reviewOf(id: string): Promise<ReviewPayload> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${id}/review`,
      { id },
      {},
      cookie(),
    );
    const response = await reviewGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: ReviewPayload }>(response)).data;
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1 });
    student = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    await seedOrgMembership({
      organizationId: orgId,
      userId: student.user.id,
      orgRoleId: asJson<{ id: string }>(memberRole).id,
    });
    await seedGroupMembership({ groupId, userId: student.user.id, role: 'member' });

    // Items are inserted with the service role: this test is about the review, not authoring.
    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        name: `review-model-answer-${Date.now()}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(bankError.message);

    const stamp = Date.now();
    const { data: openItem, error: openError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        bank_id: bank.id,
        type: 'open',
        content: `open-${stamp}`,
        model_answer: FIXTURE_MODEL_ANSWER,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (openError) throw new Error(openError.message);
    openItemId = openItem.id;

    const { data: mcqItem, error: mcqError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        bank_id: bank.id,
        type: 'mcq',
        content: `mcq-${stamp}`,
        explanation: TEACHING,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (mcqError) throw new Error(mcqError.message);
    mcqItemId = mcqItem.id;

    const { data: options, error: optionError } = await service
      .from('question_options')
      .insert([
        { question_id: mcqItemId, content: 'Wisła', is_correct: true, order_index: 0 },
        { question_id: mcqItemId, content: 'Odra', is_correct: false, order_index: 1 },
      ])
      .select('id, is_correct');
    if (optionError) throw new Error(optionError.message);
    const correctOptionId = options.find((option) => option.is_correct)?.id;
    if (!correctOptionId) throw new Error('the mcq has no key');

    assignmentId = await publishAssignment([openItemId, mcqItemId]);
    const score = await takeAndSubmit(assignmentId, () => [
      { questionId: openItemId, textAnswer: 'Trzy przyczyny i krótkie uzasadnienie.' },
      { questionId: mcqItemId, selectedAnswerId: correctOptionId },
    ]);
    // The graded item is the only one in the denominator, so the score is out of one point.
    expect(score).toBe(1);
    expect(correctOptionId).toBeTruthy();

    await teacherCall(
      closePost,
      `/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      'POST',
      {},
    );
  });

  afterAll(async () => {
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id);
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('renders the explanation for the choice item and the model answer for the open one', async () => {
    const review = await reviewOf(assignmentId);

    const open = review.items.find((item) => item.itemId === openItemId);
    const mcq = review.items.find((item) => item.itemId === mcqItemId);

    expect(open?.modelAnswer).toBe(FIXTURE_MODEL_ANSWER);
    expect(open?.explanation).toBeNull();
    expect(open?.graded).toBe(false);
    expect(open?.correct).toBeNull();

    expect(mcq?.explanation).toBe(TEACHING);
    expect(mcq?.modelAnswer).toBeNull();
    expect(mcq?.graded).toBe(true);
    expect(mcq?.correct).toBe(true);

    expect(review.ungradedCount).toBe(1);
    // R16: the open item is outside the denominator — one graded point, not two.
    expect(review.score).toEqual({ earned: 1, possible: 1 });
    // The attempt index counts the same open item for the attempt that was served it (#1174, R5).
    expect(review.attempts[0]?.ungradedCount).toBe(1);
  });

  it('reports no score at all for a sheet of open items', async () => {
    const openOnlyId = await publishAssignment([openItemId]);
    const score = await takeAndSubmit(openOnlyId, () => [
      { questionId: openItemId, textAnswer: 'Trzy przyczyny i krótkie uzasadnienie.' },
    ]);
    // R16: `possible: 0` is a real answer, so the submitted score is `null`, not `0`.
    expect(score).toBeNull();

    await teacherCall(
      closePost,
      `/api/v1/teacher/assignments/${openOnlyId}/close`,
      { id: openOnlyId },
      'POST',
      {},
    );

    const review = await reviewOf(openOnlyId);
    expect(review.score).toBeNull();
    expect(review.ungradedCount).toBe(1);
    expect(review.items[0]?.modelAnswer).toBe(FIXTURE_MODEL_ANSWER);
  });
});
