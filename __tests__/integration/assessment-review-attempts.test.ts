import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { asJson, json } from '#test/helpers/json';
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

// #1174 phase 5: the per-attempt review (R5/R19). A retake is its own attempt with its own score,
// so the review exposes the earlier attempts as well as the latest one — and stays locked for every
// attempt until the close. The seam is the real route → controller → service stack against local
// Supabase.

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; question_answers?: Array<{ id: string; content: string }> }>;
}

interface ReviewBody {
  attemptId: string | null;
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  items: Array<{ itemId: string; correct: boolean | null; graded: boolean }>;
  attempts: Array<{
    attemptId: string;
    completedAt: string | null;
    score: { earned: number; possible: number } | null;
    ungradedCount: number;
  }>;
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Assessment review: one verdict per attempt (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let outsider!: BeforeResult;
  let orgId!: string;
  let assignmentId!: string;
  /** The first attempt (answered correctly) and the second (left blank). */
  let firstAttemptId!: string;
  let secondAttemptId!: string;
  let firstCorrect = 0;

  const cookie = () => ({ active_org_id: orgId });

  async function review(attemptId?: string): Promise<Response> {
    mockUser(student.user);
    const query = attemptId ? `?attemptId=${attemptId}` : '';
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review${query}`,
      { id: assignmentId },
      {},
      {},
    );
    return reviewGet(request, { params });
  }

  async function start(): Promise<AttemptPayload> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    const response = await assignmentStart(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: AttemptPayload }>(response)).data;
  }

  async function submit(attempt: AttemptPayload, answerCorrectly: boolean): Promise<void> {
    mockUser(student.user);
    const answers = answerCorrectly
      ? attempt.questions.flatMap((question) => {
          const correct = (question.question_answers ?? []).find((option) =>
            option.content.startsWith('answer-a'),
          );
          return correct ? [{ questionId: question.id, selectedAnswerId: correct.id }] : [];
        })
      : [];
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers }),
      },
      {},
    );
    const response = await attemptSubmit(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 4 });
    student = await before({ role: 'student' });
    outsider = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    const groupId = requiredAt(teacher.groups, 0, 'the seeded group');

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
    await seedOrgMembership({
      organizationId: orgId,
      userId: outsider.user.id,
      orgRoleId: asJson<{ id: string }>(memberRole).id,
    });

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id);
    const questionIds = asJson<Array<{ id: string }>>(questionRows ?? []).map((row) => row.id);
    await service.from('bank_groups').insert({
      bank_id: asJson<{ bank_id: string }>(requiredAt(questionRows, 0, 'a seeded question'))
        .bank_id,
      group_id: groupId,
    });

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `review-attempts-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            // Two attempts of two items each: the second is a fresh sample, so the two attempts
            // have different items and different scores.
            maxAttempts: 2,
            attemptItemCount: 2,
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestions = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestions.request, { params: addQuestions.params });
    const targets = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: [groupId] }),
      },
      cookie(),
    );
    await targetsPut(targets.request, { params: targets.params });
    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE() }),
      },
      cookie(),
    );
    expect((await publishPost(publish.request, { params: publish.params })).status).toBe(200);

    // Attempt 1 answered correctly, attempt 2 left blank — two different verdicts.
    const first = await start();
    firstAttemptId = first.id;
    await submit(first, true);
    firstCorrect = first.questions.length;

    const second = await start();
    secondAttemptId = second.id;
    await submit(second, false);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuizAttempts(outsider.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('keeps the review locked for every attempt until the close (R5)', async () => {
    const latest = await review();
    expect(latest.status).toBe(403);
    expect(await errorOf(latest)).toBe('REVIEW_LOCKED');

    const named = await review(firstAttemptId);
    expect(named.status, 'a named earlier attempt is locked too').toBe(403);
    expect(await errorOf(named)).toBe('REVIEW_LOCKED');
  });

  it('exposes every submitted attempt with its own score after the close (R5/R19)', async () => {
    mockUser(teacher.user);
    const closed = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(closed.request, { params: closed.params })).status).toBe(200);

    const response = await review();
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await json<{ data: ReviewBody }>(response)).data;

    expect(body.attempts).toHaveLength(2);
    // Newest first: the blank attempt is the default review.
    expect(body.attemptId).toBe(secondAttemptId);
    expect(body.attempts[0]?.attemptId).toBe(secondAttemptId);
    expect(body.attempts[1]?.attemptId).toBe(firstAttemptId);

    // Each attempt keeps its own score: the first was answered correctly, the second was not.
    expect(body.attempts[1]?.score).toEqual({ earned: firstCorrect, possible: firstCorrect });
    expect(body.attempts[0]?.score).toEqual({ earned: 0, possible: 2 });
    expect(body.attempts[0]?.ungradedCount).toBe(0);
    expect(body.attempts.every((attempt) => attempt.completedAt !== null)).toBe(true);
  });

  it('reviews a named earlier attempt with its own score and its own verdicts (R19)', async () => {
    const response = await review(firstAttemptId);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await json<{ data: ReviewBody }>(response)).data;

    expect(body.attemptId).toBe(firstAttemptId);
    expect(body.score).toEqual({ earned: firstCorrect, possible: firstCorrect });

    // The reveal shows the whole assessment, but the verdict is the attempt's own: the items it was
    // served carry a boolean, and the ones the other attempt drew carry no verdict at all.
    expect(body.items.length).toBe(4);
    expect(body.items.filter((item) => item.correct !== null)).toHaveLength(firstCorrect);
  });

  it('answers 404 for an attempt that is not the caller’s (R19)', async () => {
    mockUser(outsider.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review?attemptId=${firstAttemptId}`,
      { id: assignmentId },
      {},
      {},
    );
    const response = await reviewGet(request, { params });
    // A foreign attempt is indistinguishable from a missing one; the run is not theirs either.
    expect(response.status).toBe(404);
  });
});
