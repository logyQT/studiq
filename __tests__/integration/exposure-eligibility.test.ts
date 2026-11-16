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
import { GET as questionGet } from '@/app/(backend)/api/v1/questions/[id]/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { PATCH as taughtPatch } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/[questionId]/flags/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1172 phase 3 (slice B1): eligibility is computed per student at attempt start (R7/R8/R9).
// An item with an exposure event or a prior answer is not in that student's graded sample, unless
// the assessment item is declared `taughtItem` — which waives the penalty and never unseals the
// item while the window is live. The seam is the real route → controller → service stack.

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; question_answers?: Array<{ id: string }> }>;
}

function FUTURE(): string {
  return new Date(Date.now() + 48 * 3_600_000).toISOString();
}

describe('Exposure eligibility (#1172)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let fresh!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let pool: string[] = [];

  const cookie = () => ({ active_org_id: orgId });

  async function startAs(user: BeforeResult['user'], assignmentId: string): Promise<Response> {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    return assignmentStart(request, { params });
  }

  async function submit(
    user: BeforeResult['user'],
    attemptId: string,
    answer?: { questionId: string; optionId: string },
  ): Promise<Response> {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          answers: answer
            ? [{ questionId: answer.questionId, selectedAnswerId: answer.optionId }]
            : [],
        }),
      },
      cookie(),
    );
    return attemptSubmit(request, { params });
  }

  /** The item ids one student's start serves, and the status it answered with. */
  async function sampleOf(
    user: BeforeResult['user'],
    assignmentId: string,
  ): Promise<{ status: number; error?: string; served: string[] }> {
    const response = await startAs(user, assignmentId);
    const body = await json<{ data?: AttemptPayload; error?: string }>(response);
    return {
      status: response.status,
      error: body.error,
      served: (body.data?.questions ?? []).map((question) => question.id),
    };
  }

  /**
   * Sits and submits one attempt, answering its first item. No review is read, so the item is burnt
   * by the answer alone — the case a ledger-only exclusion would miss.
   */
  async function sit(
    user: BeforeResult['user'],
    assignmentId: string,
    answerQuestionId?: string,
  ): Promise<string[]> {
    const started = await startAs(user, assignmentId);
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;
    // Questions are shuffled, so the item to answer is addressed by id, never by position.
    const answered =
      attempt.questions.find((question) => question.id === answerQuestionId) ??
      attempt.questions[0];
    const optionId = answered?.question_answers?.[0]?.id;
    const response = await submit(
      user,
      attempt.id,
      answered && optionId ? { questionId: answered.id, optionId } : undefined,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return attempt.questions.map((question) => question.id);
  }

  async function createAssessment(title: string, questionIds: string[]): Promise<string> {
    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            deadline: FUTURE(),
            showResults: true,
            shuffleQuestions: false,
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await json<{ data: { id: string } }>(created)).data.id;

    const add = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${id}/questions`,
      { id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds }),
      },
      cookie(),
    );
    expect((await addQuestionsPost(add.request, { params: add.params })).status).toBe(200);

    const targets = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${id}/targets`,
      { id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: [groupId] }),
      },
      cookie(),
    );
    expect((await targetsPut(targets.request, { params: targets.params })).status).toBe(200);
    return id;
  }

  async function publish(assignmentId: string): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE() }),
      },
      cookie(),
    );
    return publishPost(request, { params });
  }

  async function declareTaught(assignmentId: string, questionId: string): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions/${questionId}/flags`,
      { id: assignmentId, questionId },
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taught: true }),
      },
      cookie(),
    );
    return taughtPatch(request, { params });
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 6 });
    student = await before({ role: 'student' });
    fresh = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    for (const member of [student, fresh]) {
      await seedOrgMembership({
        organizationId: orgId,
        userId: member.user.id,
        orgRoleId: asJson<{ id: string }>(memberRole).id,
      });
      await seedGroupMembership({ groupId, userId: member.user.id, role: 'member' });
    }

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id)
      .order('id', { ascending: true });
    pool = asJson<Array<{ id: string }>>(questionRows ?? []).map((row) => row.id);
    expect(pool.length, 'the fixture seeds six items').toBe(6);

    const bankId = asJson<{ bank_id: string }>(
      requiredAt(questionRows, 0, 'a seeded question'),
    ).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuizAttempts(fresh.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('omits a burnt item from the next assessment’s sample (R8)', async () => {
    const [first, second, third] = pool;
    const seen = await createAssessment(`eligibility-burn-${Date.now()}`, [
      requiredAt(pool, 0, 'first item'),
      requiredAt(pool, 1, 'second item'),
    ]);
    expect((await publish(seen)).status).toBe(200);

    const sat = await sit(student.user, seen);
    expect(sat).toEqual(expect.arrayContaining([first, second]));

    mockUser(teacher.user);
    const closeCall = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${seen}/close`,
      { id: seen },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(closeCall.request, { params: closeCall.params })).status).toBe(200);

    mockUser(student.user);
    const reviewCall = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${seen}/review`,
      { id: seen },
      {},
      cookie(),
    );
    expect((await reviewGet(reviewCall.request, { params: reviewCall.params })).status).toBe(200);

    // The next assessment over the same items, plus one the student has never met.
    const next = await createAssessment(`eligibility-next-${Date.now()}`, [
      requiredAt(pool, 0, 'first item'),
      requiredAt(pool, 1, 'second item'),
      requiredAt(pool, 2, 'third item'),
    ]);
    expect((await publish(next)).status).toBe(200);

    const sample = await sampleOf(student.user, next);
    expect(sample.status, JSON.stringify(sample)).toBe(200);
    expect(sample.served, 'the burnt items are not in this student’s sample').toEqual([third]);
  });

  it('serves a taughtItem despite the event, and still hides its key while live (R9)', async () => {
    const [first, second] = pool;
    const taught = await createAssessment(`eligibility-taught-${Date.now()}`, [
      requiredAt(pool, 0, 'first item'),
      requiredAt(pool, 1, 'second item'),
      requiredAt(pool, 3, 'fourth item'),
    ]);
    // Declared while the run is a draft: the flag is frozen with the published snapshot.
    const declared = await declareTaught(taught, first);
    expect(declared.status, await declared.clone().text()).toBe(200);
    expect((await publish(taught)).status).toBe(200);

    // The event from the previous test still stands, so without the waiver this item is burnt.
    const sample = await sampleOf(student.user, taught);
    expect(sample.status, JSON.stringify(sample)).toBe(200);
    expect(sample.served, 'the taught item is served').toContain(first);
    expect(sample.served, 'the other burnt item stays out').not.toContain(second);
    expect(sample.served).toHaveLength(2);

    // R2/R4 are untouched by the flag: the item is sealed for the class while the window is live.
    mockUser(student.user);
    const read = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${first}`,
      { id: first },
      {},
      cookie(),
    );
    const readResponse = await questionGet(read.request, { params: read.params });
    expect(readResponse.status, 'taughtItem never unseals the item').toBe(404);
  });

  it('starts a new cohort with an empty ledger: a fresh student sees the item again', async () => {
    const [first, second] = pool;
    const reuse = await createAssessment(`eligibility-cohort-${Date.now()}`, [
      requiredAt(pool, 0, 'first item'),
      requiredAt(pool, 1, 'second item'),
    ]);
    expect((await publish(reuse)).status).toBe(200);

    const sample = await sampleOf(fresh.user, reuse);
    expect(sample.status, JSON.stringify(sample)).toBe(200);
    expect(sample.served, 'events are per student, so a new cohort starts clean').toEqual([
      first,
      second,
    ]);
  });

  it('omits an item the student answered even when no key was rendered (R8)', async () => {
    const answered = requiredAt(pool, 3, 'fourth item');
    const untouched = requiredAt(pool, 4, 'fifth item');
    const other = requiredAt(pool, 5, 'sixth item');

    const sat = await createAssessment(`eligibility-answer-${Date.now()}`, [answered, untouched]);
    expect((await publish(sat)).status).toBe(200);
    // Submitted, never reviewed: no exposure event, only a prior answer.
    expect(await sit(fresh.user, sat, answered)).toEqual(expect.arrayContaining([answered]));

    const next = await createAssessment(`eligibility-answer-next-${Date.now()}`, [answered, other]);
    expect((await publish(next)).status).toBe(200);

    const sample = await sampleOf(fresh.user, next);
    expect(sample.status, JSON.stringify(sample)).toBe(200);
    expect(sample.served, 'a prior answer burns the item on its own').toEqual([other]);
  });

  it('waives a prior answer too, not only a ledger event (R9)', async () => {
    const answered = requiredAt(pool, 3, 'fourth item');
    const other = requiredAt(pool, 4, 'fifth item');

    const taught = await createAssessment(`eligibility-answer-taught-${Date.now()}`, [
      answered,
      other,
    ]);
    expect((await declareTaught(taught, answered)).status).toBe(200);
    expect((await publish(taught)).status).toBe(200);

    const sample = await sampleOf(fresh.user, taught);
    expect(sample.status, JSON.stringify(sample)).toBe(200);
    expect(sample.served, 'the declaration outranks the prior answer').toEqual([answered, other]);
  });
});
