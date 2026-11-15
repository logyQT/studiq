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
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { PUT as flagsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/[questionId]/flags/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';

// #1172 phase 3: eligibility (R8/R9). A key render burns an item for that student, and the graded
// sample is computed per student at attempt start — so a practised item is absent from *their* first
// attempt while a classmate still gets it. `taught_item` is the only waiver, and it never unseals the
// item. The seam is the real route → controller → service stack against local Supabase.

interface AttemptPayload {
  id: string;
  questions: Array<{
    id: string;
    explanation?: string;
    question_answers: Array<{ id: string; is_correct?: boolean }>;
  }>;
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Assessment eligibility: a key render burns the item (#1172)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let seenStudent!: BeforeResult;
  let classmate!: BeforeResult;
  let orgId!: string;
  let seenGroupId!: string;
  let classmateGroupId!: string;
  let bankId!: string;
  /** The burnt item and the untouched one, in binding order. */
  let burntId!: string;
  let freshId!: string;
  let assignmentId!: string;
  let seenAttempt!: AttemptPayload;
  let classmateAttempt!: AttemptPayload;

  const cookie = () => ({ active_org_id: orgId });

  async function start(student: BeforeResult, id: string = assignmentId): Promise<Response> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${id}/start`,
      { id },
      { method: 'POST' },
      cookie(),
    );
    return assignmentStart(request, { params });
  }

  async function submit(attempt: AttemptPayload, student: BeforeResult): Promise<Response> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: attempt.questions.map((question) => ({
            questionId: question.id,
            selectedAnswerId: requiredAt(question.question_answers, 0, 'an option').id,
          })),
        }),
      },
      cookie(),
    );
    return attemptSubmit(request, { params });
  }

  async function createAssessment(input: {
    title: string;
    groupIds: string[];
    questionIds: string[];
    maxAttempts?: number;
  }): Promise<string> {
    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: input.title,
            deadline: FUTURE(),
            showResults: true,
            // Deterministic samples: the assertion is about *which* items, not their order.
            shuffleQuestions: false,
            maxAttempts: input.maxAttempts ?? 1,
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
        body: JSON.stringify({ questionIds: input.questionIds }),
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
        body: JSON.stringify({ groupIds: input.groupIds }),
      },
      cookie(),
    );
    expect((await targetsPut(targets.request, { params: targets.params })).status).toBe(200);

    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${id}/publish`,
      { id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE(), acknowledgeExposure: true }),
      },
      cookie(),
    );
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);
    return id;
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 2, questions: 3 });
    seenStudent = await before({ role: 'student' });
    classmate = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    seenGroupId = requiredAt(teacher.groups, 0, 'the first group');
    classmateGroupId = requiredAt(teacher.groups, 1, 'the second group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    const orgRoleId = asJson<{ id: string }>(memberRole).id;
    await seedOrgMembership({ organizationId: orgId, userId: seenStudent.user.id, orgRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: classmate.user.id, orgRoleId });
    await seedGroupMembership({
      groupId: seenGroupId,
      userId: seenStudent.user.id,
      role: 'member',
    });
    await seedGroupMembership({
      groupId: classmateGroupId,
      userId: classmate.user.id,
      role: 'member',
    });

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id)
      .order('id', { ascending: true });
    const questions = asJson<Array<{ id: string; bank_id: string }>>(questionRows);
    expect(questions.length, 'the fixture seeds three items').toBe(3);
    bankId = requiredAt(questions, 0, 'a seeded item').bank_id;
    burntId = requiredAt(questions, 0, 'the burnt item').id;
    freshId = requiredAt(questions, 1, 'the untouched item').id;

    // Both classes can practise the bank, so eligibility is per student, not per class.
    await service.from('bank_groups').insert([
      { bank_id: bankId, group_id: seenGroupId },
      { bank_id: bankId, group_id: classmateGroupId },
    ]);

    // The ledger's write path is covered by `exposure-ledger.test.ts`; this suite starts after the
    // render, with the event the practice review would have written.
    const { error: eventError } = await service.from('exposure_events').insert({
      student_id: seenStudent.user.id,
      question_id: burntId,
      organization_id: orgId,
      group_ids: [seenGroupId],
      seen_correct: true,
    });
    expect(eventError, 'the exposure event is the fixture, not the behaviour').toBeNull();

    assignmentId = await createAssessment({
      title: `eligibility-${Date.now()}`,
      groupIds: [seenGroupId, classmateGroupId],
      questionIds: [burntId, freshId],
      maxAttempts: 2,
    });

    mockUser(seenStudent.user);
    const started = await start(seenStudent);
    expect(started.status, await started.clone().text()).toBe(200);
    seenAttempt = (await json<{ data: AttemptPayload }>(started)).data;

    mockUser(classmate.user);
    const other = await start(classmate);
    expect(other.status, await other.clone().text()).toBe(200);
    classmateAttempt = (await json<{ data: AttemptPayload }>(other)).data;
  });

  afterAll(async () => {
    await cleanupQuizAttempts(seenStudent.user.id);
    await cleanupQuizAttempts(classmate.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('omits a burnt item from that student’s first attempt and serves it to a classmate (R8/R9)', () => {
    expect(
      seenAttempt.questions.map((question) => question.id),
      'the item whose key was rendered is absent from the practised student’s sample',
    ).toEqual([freshId]);
    expect(
      classmateAttempt.questions.map((question) => question.id),
      'the same class sample still serves it to a student with an empty ledger',
    ).toEqual([burntId, freshId]);
  });

  it('keeps the ledger per student, so a new cohort starts clean (R8)', async () => {
    const { data } = await service
      .from('exposure_events')
      .select('question_id')
      .eq('student_id', classmate.user.id);
    expect(data, 'the classmate has no exposure event').toEqual([]);
  });

  it('keeps the key hidden while the window is live, taught or not (R2/R4)', () => {
    const payload = JSON.stringify(seenAttempt.questions);
    expect(payload).not.toContain('explanation');
    expect(payload).not.toContain('is_correct');
  });

  it('serves a burnt item once the teacher declares it taught (R9)', async () => {
    mockUser(teacher.user);
    const declare = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions/${burntId}/flags`,
      { id: assignmentId, questionId: burntId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taught: true }),
      },
      cookie(),
    );
    const declared = await flagsPut(declare.request, { params: declare.params });
    expect(declared.status, await declared.clone().text()).toBe(200);

    // The first attempt is submitted, so the retake is a fresh draw over what is left.
    expect((await submit(seenAttempt, seenStudent)).status).toBe(200);
    const retake = await start(seenStudent);
    expect(retake.status, await retake.clone().text()).toBe(200);
    const served = (await json<{ data: AttemptPayload }>(retake)).data;
    expect(
      served.questions.map((question) => question.id),
      'the declared item is eligible despite its ledger event; the seen retake item is not',
    ).toEqual([burntId]);
    seenAttempt = served;
  });

  it('waives a prior answer from another assessment, not only a ledger event (R9)', async () => {
    // A first assessment where the classmate answers the item without ever reading its key.
    const answeredId = burntId;
    const earlier = await createAssessment({
      title: `eligibility-earlier-${Date.now()}`,
      groupIds: [classmateGroupId],
      questionIds: [answeredId],
    });
    const first = await start(classmate, earlier);
    expect(first.status, await first.clone().text()).toBe(200);
    const firstAttempt = (await json<{ data: AttemptPayload }>(first)).data;
    expect((await submit(firstAttempt, classmate)).status).toBe(200);

    const { data: events } = await service
      .from('exposure_events')
      .select('question_id')
      .eq('student_id', classmate.user.id)
      .eq('question_id', answeredId);
    expect(events, 'submitting is not a key render — no ledger event').toEqual([]);

    const graded = await createAssessment({
      title: `eligibility-graded-${Date.now()}`,
      groupIds: [classmateGroupId],
      questionIds: [answeredId, freshId],
      maxAttempts: 2,
    });
    const excluded = await start(classmate, graded);
    expect(excluded.status, await excluded.clone().text()).toBe(200);
    const excludedAttempt = (await json<{ data: AttemptPayload }>(excluded)).data;
    expect(
      excludedAttempt.questions.map((question) => question.id),
      'an item answered in an earlier assessment is not eligible here',
    ).toEqual([freshId]);

    mockUser(teacher.user);
    const declare = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${graded}/questions/${answeredId}/flags`,
      { id: graded, questionId: answeredId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taught: true }),
      },
      cookie(),
    );
    const declared = await flagsPut(declare.request, { params: declare.params });
    expect(declared.status, await declared.clone().text()).toBe(200);

    expect((await submit(excludedAttempt, classmate)).status).toBe(200);
    const retake = await start(classmate, graded);
    expect(retake.status, await retake.clone().text()).toBe(200);
    const served = (await json<{ data: AttemptPayload }>(retake)).data;
    expect(
      served.questions.map((question) => question.id),
      'the declaration waives the prior answer too',
    ).toEqual([answeredId]);

    mockUser(teacher.user);
    const close = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${earlier}/close`,
      { id: earlier },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(close.request, { params: close.params })).status).toBe(200);

    const late = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${earlier}/questions/${answeredId}/flags`,
      { id: earlier, questionId: answeredId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taught: false }),
      },
      cookie(),
    );
    const refused = await flagsPut(late.request, { params: late.params });
    expect(refused.status, 'eligibility is decided by then').toBe(409);
    expect(await errorOf(refused)).toBe('ASSESSMENT_CLOSED');
  });
});
