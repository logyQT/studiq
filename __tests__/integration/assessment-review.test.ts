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
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import {
  GET as attemptGet,
  POST as attemptSubmit,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { PUT as questionPut } from '@/app/(backend)/api/v1/questions/[id]/route';

// #1171 slice 3b: the review lock and the close-time reveal (R5/R10). The seam is the real
// route → controller → service stack against local Supabase, so the lock, the key and the frozen
// snapshot are observed exactly as a student sees them.

interface AttemptPayload {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    question_answers?: Array<{ id: string; content: string }>;
  }>;
}

interface ReviewItem {
  itemId: string;
  type: string;
  content: string;
  explanation: string | null;
  graded: boolean;
  correct: boolean | null;
  selectedOptionId: string | null;
  options: Array<{ id: string; content: string; isCorrect: boolean }>;
}

interface ReviewPayload {
  assignmentId: string;
  attemptId: string | null;
  completedAt: string | null;
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  items: ReviewItem[];
}

function as(user: BeforeResult['user']): void {
  mockUser(user);
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Assignment review: locked before close, revealed at close (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let idle!: BeforeResult;
  let outsider!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let bankId!: string;
  let items!: { id: string; explanation: string; content: string };
  let assignmentId!: string;
  let attemptId!: string;
  let firstAttemptId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function review(user: BeforeResult['user'], attempt?: string): Promise<Response> {
    as(user);
    const suffix = attempt ? `?attemptId=${attempt}` : '';
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review${suffix}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    return reviewGet(request, { params });
  }

  async function start(user: BeforeResult['user']): Promise<AttemptPayload> {
    as(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const response = await assignmentStart(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: AttemptPayload }>(response)).data;
  }

  async function submit(attempt: AttemptPayload, answers: Array<Record<string, string>>) {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers }),
      },
      cookie(),
    );
    const response = await attemptSubmit(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
  }

  async function close(): Promise<Response> {
    as(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    return closePost(request, { params });
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 2 });
    student = await before({ role: 'student' });
    idle = await before({ role: 'student' });
    outsider = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    for (const member of [student, idle]) {
      await seedOrgMembership({
        organizationId: orgId,
        userId: member.user.id,
        orgRoleId: asJson<{ id: string }>(memberRole).id,
      });
      await seedGroupMembership({ groupId, userId: member.user.id, role: 'member' });
    }

    const ids = teacher.created.questions.slice(0, 2);
    const explanation = `review-explanation-${Date.now()}`;
    const content = `review-content-${Date.now()}`;
    await service
      .from('questions')
      .update({ explanation, content: `${content}-a` })
      .eq('id', requiredAt(ids, 0, 'first item'));
    await service
      .from('questions')
      .update({ explanation: `${explanation}-b`, content: `${content}-b` })
      .eq('id', requiredAt(ids, 1, 'second item'));
    items = { id: requiredAt(ids, 0, 'first item'), explanation, content };

    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', items.id)
      .single();
    bankId = asJson<{ bank_id: string }>(questionRow).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });

    as(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `review-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            maxAttempts: 2,
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const add = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: ids }),
      },
      cookie(),
    );
    expect((await addQuestionsPost(add.request, { params: add.params })).status).toBe(200);

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
    expect((await targetsPut(targets.request, { params: targets.params })).status).toBe(200);

    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE(), acknowledgeExposure: true }),
      },
      cookie(),
    );
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);

    // Two submitted attempts: the review must pick the latest one, and `?attemptId=` the other.
    const attempt = await start(student.user);
    firstAttemptId = attempt.id;
    const first = attempt.questions[0];
    if (!first) throw new Error('the attempt has no questions');
    await submit(attempt, [
      {
        questionId: first.id,
        selectedAnswerId: first.question_answers?.[0]?.id ?? '',
      },
    ]);

    const second = await start(student.user);
    attemptId = second.id;
    await submit(second, []);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuizAttempts(idle.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('locks the review for the whole cohort before the close (R5)', async () => {
    const locked = await review(student.user);
    expect(locked.status).toBe(403);
    expect(await errorOf(locked)).toBe('REVIEW_LOCKED');

    // The per-attempt review route is the same artefact and must not be a way around the lock.
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {},
      cookie(),
    );
    const attemptReview = await attemptGet(request, { params });
    expect(attemptReview.status).toBe(403);
    expect(await errorOf(attemptReview)).toBe('REVIEW_LOCKED');

    // The detail page tells the client the same thing, so the UI does not offer a doomed link.
    as(student.user);
    const detailCall = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const detail = await assignmentGet(detailCall.request, { params: detailCall.params });
    expect((await json<{ data: { review_unlocked: boolean } }>(detail)).data.review_unlocked).toBe(
      false,
    );
  });

  it('hides a review that does not exist when the teacher did not share results (R5)', async () => {
    await service
      .from('teacher_assignments')
      .update({ show_results: false })
      .eq('id', assignmentId);
    const hidden = await review(student.user);
    expect(hidden.status, 'no review exists at any time, so no lock either').toBe(404);
    expect(await errorOf(hidden)).toBe('NOT_FOUND');
    await service.from('teacher_assignments').update({ show_results: true }).eq('id', assignmentId);
  });

  it('refuses the review to a student the assessment does not target', async () => {
    const foreign = await review(outsider.user);
    expect(foreign.status).toBe(404);
  });

  it('reveals the frozen key and explanation to the whole cohort at the close (R5/R11)', async () => {
    // The author edits the bound item after publish: the review must still render the published
    // version and its published key (R11).
    as(teacher.user);
    const edit = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${items.id}`,
      { id: items.id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `edited-after-publish-${Date.now()}`,
          explanation: `edited-explanation-${Date.now()}`,
          type: 'mcq',
          answers: [
            { content: 'edited-a', isCorrect: true, orderIndex: 0 },
            { content: 'edited-b', isCorrect: false, orderIndex: 1 },
          ],
        }),
      },
      cookie(),
    );
    expect((await questionPut(edit.request, { params: edit.params })).status).toBe(200);

    const closed = await close();
    expect(closed.status, await closed.clone().text()).toBe(200);

    const response = await review(student.user);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await json<{ data: ReviewPayload }>(response)).data;

    expect(body.attemptId, 'the latest submitted attempt is the one reviewed').toBe(attemptId);
    expect(body.score?.possible).toBeGreaterThan(0);
    expect(body.items).toHaveLength(2);

    const frozen = body.items.find((item) => item.itemId === items.id);
    expect(frozen?.content, 'the published stem, not the edited one').toBe(`${items.content}-a`);
    expect(frozen?.explanation, 'the published explanation').toBe(items.explanation);
    expect(frozen?.options.some((option) => option.content === 'edited-a')).toBe(false);
    expect(frozen?.options.filter((option) => option.isCorrect)).toHaveLength(1);
    expect(frozen?.graded).toBe(true);
    expect(typeof frozen?.correct).toBe('boolean');

    // The cohort reveal serves a target who never started an attempt: the key, not a score.
    const idleReview = await review(idle.user);
    expect(idleReview.status).toBe(200);
    const idleBody = (await json<{ data: ReviewPayload }>(idleReview)).data;
    expect(idleBody.attemptId).toBeNull();
    expect(idleBody.score).toBeNull();
    expect(idleBody.items.map((item) => item.itemId).toSorted()).toEqual(
      body.items.map((item) => item.itemId).toSorted(),
    );
  });

  it('reviews the named attempt when one is requested (tie-break by attempt id)', async () => {
    const response = await review(student.user, firstAttemptId);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await json<{ data: ReviewPayload }>(response)).data.attemptId).toBe(firstAttemptId);

    // An attempt id that is not the caller's own is indistinguishable from a missing one.
    async function notMine(): Promise<number> {
      as(idle.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/assignments/${assignmentId}/review?attemptId=${firstAttemptId}`,
        { id: assignmentId },
        {},
        cookie(),
      );
      return (await reviewGet(request, { params })).status;
    }
    expect(await notMine()).toBe(404);
  });

  it('keeps the per-attempt review route open after the close too (R5)', async () => {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {},
      cookie(),
    );
    const response = await attemptGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await json<{ data: { questions: Array<{ explanation?: string }> } }>(response))
      .data;
    expect(body.questions[0]?.explanation).toBeTruthy();
  });
});
