import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
import { FIXTURE_MODEL_ANSWER } from '#test/helpers/question-text';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
  seedGroupMembership,
  seedOrgMembership,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { GET as reviewGet } from '@/app/(backend)/api/v1/assignments/[id]/review/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1257: the review headline and the attempt index must describe the same attempt. A pool larger
// than `attempt_item_count` (R7) means an attempt can hold fewer open items than the sheet, so the
// top-level `ungradedCount` is counted from what that attempt was served — not the whole reveal.

type AssignmentRoute = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

function future(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; type: string }>;
}

interface ReviewPayload {
  attemptId: string | null;
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  items: Array<{ itemId: string; graded: boolean }>;
  attempts: Array<{ attemptId: string; ungradedCount: number }>;
}

describe('Review headline counts the reviewed attempt’s own open items (#1257)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;

  /** The keyed option of every mcq in the fixture, so a served item is answered correctly. */
  const keys = new Map<string, string>();
  const openItemIds = new Set<string>();

  /** Pool of four, three of them open: a two-item draw can never hold all three open items. */
  let subsetAssignmentId!: string;
  let subsetAttemptId!: string;
  let subsetServedOpen = 0;
  let subsetServedMcq = false;

  /** A mixed sheet served whole, as the control: the count still matches the attempt. */
  let fullAssignmentId!: string;
  let fullOpenItemId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function teacherCall<T>(
    route: AssignmentRoute,
    url: string,
    params: { id: string },
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
    const response = await route(request, { params: routeParams });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return (await json<{ data: T }>(response)).data;
  }

  /** A published, targeted run over `itemIds`, ready to be taken. */
  async function publishAssignment(itemIds: string[], attemptItemCount?: number): Promise<string> {
    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `review-ungraded-${Date.now()}`,
            deadline: future(),
            showResults: true,
            ...(attemptItemCount ? { attemptItemCount } : {}),
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    await teacherCall(
      addQuestionsPost,
      `/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      'POST',
      { questionIds: itemIds },
    );
    await teacherCall(
      targetsPut,
      `/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      'PUT',
      { groupIds: [groupId] },
    );
    await teacherCall(
      publishPost,
      `/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      'POST',
      { deadline: future(), acknowledgeExposure: true },
    );
    return assignmentId;
  }

  /** Takes the assignment as the student and submits every served item it can answer. */
  async function takeAndSubmit(id: string): Promise<AttemptPayload> {
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

    const answers: Array<{
      questionId: string;
      textAnswer?: string;
      selectedAnswerId?: string;
    }> = [];
    for (const question of attempt.questions) {
      if (question.type === 'open') {
        answers.push({
          questionId: question.id,
          textAnswer: 'Trzy przyczyny i krótkie uzasadnienie.',
        });
        continue;
      }
      const selectedAnswerId = keys.get(question.id);
      if (selectedAnswerId) answers.push({ questionId: question.id, selectedAnswerId });
    }

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers }),
      },
      cookie(),
    );
    const submitResponse = await attemptSubmit(submitted.request, { params: submitted.params });
    expect(submitResponse.status, await submitResponse.clone().text()).toBe(200);
    return attempt;
  }

  async function close(id: string): Promise<void> {
    await teacherCall(closePost, `/api/v1/teacher/assignments/${id}/close`, { id }, 'POST', {});
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

  /** One item plus its two options, inserted with the service role: this test is not about authoring. */
  async function insertItem(
    bankId: string,
    type: 'open' | 'mcq',
    content: string,
  ): Promise<string> {
    const { data: item, error } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        bank_id: bankId,
        type,
        content,
        ...(type === 'open' ? { model_answer: FIXTURE_MODEL_ANSWER } : {}),
        visibility: 'group',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    if (type === 'open') {
      openItemIds.add(item.id);
      return item.id;
    }

    const { data: options, error: optionError } = await service
      .from('question_options')
      .insert([
        { question_id: item.id, content: `${content}-correct`, is_correct: true, order_index: 0 },
        {
          question_id: item.id,
          content: `${content}-distractor`,
          is_correct: false,
          order_index: 1,
        },
      ])
      .select('id, is_correct');
    if (optionError) throw new Error(optionError.message);
    const correct = options.find((option) => option.is_correct);
    if (!correct) throw new Error('the inserted mcq has no key');
    keys.set(item.id, correct.id);
    return item.id;
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

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        name: `review-ungraded-${Date.now()}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(bankError.message);

    const stamp = Date.now();
    const open = [];
    for (const index of [0, 1, 2]) {
      open.push(await insertItem(bank.id, 'open', `open-${stamp}-${index}`));
    }
    const mcqItemId = await insertItem(bank.id, 'mcq', `mcq-${stamp}`);

    subsetAssignmentId = await publishAssignment([...open, mcqItemId], 2);
    const subsetAttempt = await takeAndSubmit(subsetAssignmentId);
    subsetAttemptId = subsetAttempt.id;
    subsetServedOpen = subsetAttempt.questions.filter((q) => openItemIds.has(q.id)).length;
    subsetServedMcq = subsetAttempt.questions.some((q) => q.id === mcqItemId);
    await close(subsetAssignmentId);

    fullOpenItemId = await insertItem(bank.id, 'open', `full-open-${stamp}`);
    const fullMcqItemId = await insertItem(bank.id, 'mcq', `full-mcq-${stamp}`);
    fullAssignmentId = await publishAssignment([fullOpenItemId, fullMcqItemId]);
    await takeAndSubmit(fullAssignmentId);
    await close(fullAssignmentId);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id);
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('reports the attempt’s own open items, not the whole sheet, for a partial sample (#1257)', async () => {
    const review = await reviewOf(subsetAssignmentId);

    // The fixture's guarantee: three open items in the pool, at most two served.
    expect(subsetServedOpen).toBeGreaterThanOrEqual(1);
    expect(subsetServedOpen).toBeLessThanOrEqual(2);

    expect(review.attemptId).toBe(subsetAttemptId);
    // The reveal still shows the whole assessment (R5) …
    expect(review.items).toHaveLength(4);
    // … while the headline counts only what this attempt held.
    expect(review.ungradedCount).toBe(subsetServedOpen);
    expect(review.attempts[0]?.attemptId).toBe(subsetAttemptId);
    expect(review.attempts[0]?.ungradedCount).toBe(subsetServedOpen);
    // The regression: the whole-sheet count is three, and a subset attempt can never hold three.
    expect(review.ungradedCount).toBeLessThan(3);

    // The denominator follows the same served set: a draw without the graded item has no score.
    expect(review.score).toEqual(subsetServedMcq ? { earned: 1, possible: 1 } : null);
  });

  it('counts a mixed sheet served whole correctly (#1257)', async () => {
    const review = await reviewOf(fullAssignmentId);

    expect(review.items).toHaveLength(2);
    expect(review.ungradedCount).toBe(1);
    expect(review.attempts[0]?.ungradedCount).toBe(1);
    expect(review.items.find((item) => item.itemId === fullOpenItemId)?.graded).toBe(false);
    expect(review.score).toEqual({ earned: 1, possible: 1 });
  });
});
