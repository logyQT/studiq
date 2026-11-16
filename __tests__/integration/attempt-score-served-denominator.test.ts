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
  seedOrgMembership,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { GET as studentAssignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { GET as reviewGet } from '@/app/(backend)/api/v1/assignments/[id]/review/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as gradingGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/[studentId]/route';
import { PUT as gradePut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/[studentId]/route';
import { GET as resultsGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

/**
 * #1298: grading an open item must re-score the attempt against the items it was **served**
 * (`quiz_attempt_questions`), never the assignment's whole pool. A manual grade used to write the
 * pool's points into `quiz_attempts.total_points`, so a partially served attempt jumped from
 * `3/4` to `4/20` — the earned numerator was right and only the denominator widened.
 *
 * The draws are made deterministic through eligibility: an item the student has already answered is
 * not served again (R8), so answering the two pool items this fixture does not need leaves exactly
 * the served set the test asserts on.
 */

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

interface AttemptScore {
  score: number | null;
  total_points: number | null;
  total_questions: number;
}

interface ReviewPayload {
  attemptId: string | null;
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  attempts: Array<{ attemptId: string; score: { earned: number; possible: number } | null }>;
}

interface ResultsRow extends AttemptScore {
  id: string;
}

interface ResultsPayload {
  attempts: ResultsRow[];
}

describe('A manual grade re-scores the served items, not the pool (#1298)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;

  /** Both option ids of every mcq, so a served item can be answered right or wrong on purpose. */
  const options = new Map<string, { correct: string; wrong: string }>();

  /** Pool of six, four served: the two burned mcq are never drawn, so the open item always is. */
  let subsetAssignmentId!: string;
  let subsetAttemptId!: string;
  let subsetOpenItemId!: string;

  /** Pool of three served whole, as the control: the fix must not move a whole-pool attempt. */
  let fullAssignmentId!: string;
  let fullAttemptId!: string;
  let fullOpenItemId!: string;

  /** One closed item and two open ones, served whole: the ungraded rule holds until each is graded. */
  let mixedAssignmentId!: string;
  let mixedAttemptId!: string;
  let mixedOpenItemIds!: string[];

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
            title: `served-denominator-${Date.now()}-${itemIds.length}`,
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
      { studentIds: [student.user.id] },
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

  /**
   * Takes the assignment and submits the given answers. `answers` maps a served question id to the
   * option it should carry, or to `'open'` for an open item.
   */
  async function takeAndSubmit(id: string, answers: Map<string, string>): Promise<AttemptPayload> {
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

    const payload = attempt.questions.flatMap((question) => {
      if (question.type === 'open') {
        return [{ questionId: question.id, textAnswer: 'Trzy przyczyny i krótkie uzasadnienie.' }];
      }
      const choice = answers.get(question.id);
      return choice ? [{ questionId: question.id, selectedAnswerId: choice }] : [];
    });

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers: payload }),
      },
      cookie(),
    );
    const submitResponse = await attemptSubmit(submitted.request, { params: submitted.params });
    expect(submitResponse.status, await submitResponse.clone().text()).toBe(200);
    return attempt;
  }

  /** The `quiz_attempts` row the results, grading and student surfaces all read. */
  async function storedAttempt(attemptId: string): Promise<AttemptScore> {
    const { data, error } = await service
      .from('quiz_attempts')
      .select('score, total_points, total_questions')
      .eq('id', attemptId)
      .single();
    if (error) throw new Error(error.message);
    return asJson<AttemptScore>(data);
  }

  async function resultsRow(assignmentId: string, attemptId: string): Promise<AttemptScore> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await resultsGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = (await json<{ data: ResultsPayload }>(response)).data;
    const row = payload.attempts.find((attempt) => attempt.id === attemptId);
    if (!row) throw new Error('the results payload is missing the attempt');
    return row;
  }

  /** The grading header's attempt (`GET …/results/:attemptId`). */
  async function gradingHeader(assignmentId: string, attemptId: string): Promise<AttemptScore> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results/${attemptId}`,
      { id: assignmentId, studentId: attemptId },
      {},
      cookie(),
    );
    const response = await gradingGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return asJson<AttemptScore>((await json<{ data: AttemptScore }>(response)).data);
  }

  /** The student's own assignment card (`last_completed_attempt`). */
  async function studentCard(assignmentId: string): Promise<AttemptScore> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await studentAssignmentGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = asJson<{ last_completed_attempt: AttemptScore | null }>(
      (await json<{ data: unknown }>(response)).data,
    );
    if (!payload.last_completed_attempt) throw new Error('the student card has no attempt');
    return payload.last_completed_attempt;
  }

  async function review(assignmentId: string): Promise<ReviewPayload> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await reviewGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: ReviewPayload }>(response)).data;
  }

  async function close(assignmentId: string): Promise<void> {
    await teacherCall(
      closePost,
      `/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      'POST',
      {},
    );
  }

  async function grade(
    assignmentId: string,
    attemptId: string,
    questionId: string,
    points: number,
  ): Promise<void> {
    await teacherCall(
      gradePut,
      `/api/v1/teacher/assignments/${assignmentId}/results/${attemptId}`,
      { id: assignmentId, studentId: attemptId },
      'PUT',
      { questionId, points, feedback: 'Dobra odpowiedź.' },
    );
  }

  /** One item plus its options, inserted with the service role: this test is not about authoring. */
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
    if (type === 'open') return item.id;

    const { data: rows, error: optionError } = await service
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
    const correct = rows.find((option) => option.is_correct);
    const wrong = rows.find((option) => !option.is_correct);
    if (!correct || !wrong) throw new Error('the inserted mcq has no key');
    options.set(item.id, { correct: correct.id, wrong: wrong.id });
    return item.id;
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true });
    student = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;

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

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        name: `served-denominator-${Date.now()}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(bankError.message);

    const stamp = Date.now();

    // A pool of six of which the attempt is served four: three closed items and the open one.
    const pool: string[] = [];
    for (const index of [0, 1, 2, 3, 4]) {
      pool.push(await insertItem(bank.id, 'mcq', `subset-mcq-${stamp}-${index}`));
    }
    subsetOpenItemId = await insertItem(bank.id, 'open', `subset-open-${stamp}`);

    // Two pool items are burnt for this student first: an item they have already answered is not
    // served again (R8), so the subset draw below is exactly the four items the test asserts on.
    const burnedIds = [
      requiredAt(pool, 3, 'the burnt item'),
      requiredAt(pool, 4, 'the burnt item'),
    ];
    const primerAnswers = new Map<string, string>();
    for (const id of burnedIds) {
      const choice = options.get(id);
      if (choice) primerAnswers.set(id, choice.wrong);
    }
    await takeAndSubmit(await publishAssignment(burnedIds), primerAnswers);

    subsetAssignmentId = await publishAssignment([...pool, subsetOpenItemId], 4);

    // Two right, one wrong: the served closed items earn 2 of their 3 points.
    const subsetAnswers = new Map<string, string>();
    pool.slice(0, 3).forEach((id, index) => {
      const choice = options.get(id);
      if (choice) subsetAnswers.set(id, index < 2 ? choice.correct : choice.wrong);
    });
    const subset = await takeAndSubmit(subsetAssignmentId, subsetAnswers);
    subsetAttemptId = subset.id;
    // The fixture's guarantee: the draw held the open item and three closed ones.
    expect(subset.questions.map((question) => question.id).toSorted()).toEqual(
      [
        requiredAt(pool, 0, 'mcq'),
        requiredAt(pool, 1, 'mcq'),
        requiredAt(pool, 2, 'mcq'),
        subsetOpenItemId,
      ].toSorted(),
    );
    await close(subsetAssignmentId);

    // The control: a pool of three served whole.
    const fullPool: string[] = [];
    for (const index of [0, 1]) {
      fullPool.push(await insertItem(bank.id, 'mcq', `full-mcq-${stamp}-${index}`));
    }
    fullOpenItemId = await insertItem(bank.id, 'open', `full-open-${stamp}`);
    fullAssignmentId = await publishAssignment([...fullPool, fullOpenItemId]);
    const fullAnswers = new Map<string, string>();
    fullPool.forEach((id, index) => {
      const choice = options.get(id);
      if (choice) fullAnswers.set(id, index === 0 ? choice.correct : choice.wrong);
    });
    const full = await takeAndSubmit(fullAssignmentId, fullAnswers);
    fullAttemptId = full.id;
    await close(fullAssignmentId);

    // A mixed sheet with two open items, served whole.
    const mixedMcq = await insertItem(bank.id, 'mcq', `mixed-mcq-${stamp}`);
    const firstOpen = await insertItem(bank.id, 'open', `mixed-open-a-${stamp}`);
    const secondOpen = await insertItem(bank.id, 'open', `mixed-open-b-${stamp}`);
    mixedOpenItemIds = [firstOpen, secondOpen];
    mixedAssignmentId = await publishAssignment([mixedMcq, firstOpen, secondOpen]);
    const mixedChoice = options.get(mixedMcq);
    const mixed = await takeAndSubmit(
      mixedAssignmentId,
      new Map(mixedChoice ? [[mixedMcq, mixedChoice.correct]] : []),
    );
    mixedAttemptId = mixed.id;
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id);
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('keeps the served denominator before a grade and widens it by the graded item only (#1298)', async () => {
    // Before the grade: three served closed items, the ungraded open one outside the denominator.
    expect(await storedAttempt(subsetAttemptId)).toEqual({
      score: 2,
      total_points: 3,
      total_questions: 4,
    });
    expect(await resultsRow(subsetAssignmentId, subsetAttemptId)).toMatchObject({
      score: 2,
      total_points: 3,
    });
    expect(await gradingHeader(subsetAssignmentId, subsetAttemptId)).toMatchObject({
      score: 2,
      total_points: 3,
    });
    const beforeGrade = await review(subsetAssignmentId);
    expect(beforeGrade.score).toEqual({ earned: 2, possible: 3 });

    await grade(subsetAssignmentId, subsetAttemptId, subsetOpenItemId, 1);

    // After: the graded open item joins the same served set — 4 of the 5 items the attempt held,
    // never the pool's 6.
    expect(await storedAttempt(subsetAttemptId)).toEqual({
      score: 3,
      total_points: 4,
      total_questions: 4,
    });

    const results = await resultsRow(subsetAssignmentId, subsetAttemptId);
    expect(results).toMatchObject({ score: 3, total_points: 4 });
    expect(await gradingHeader(subsetAssignmentId, subsetAttemptId)).toMatchObject({
      score: 3,
      total_points: 4,
    });
    expect(await studentCard(subsetAssignmentId)).toMatchObject({
      score: 3,
      total_points: 4,
    });

    const reviewed = await review(subsetAssignmentId);
    expect(reviewed.score).toEqual({ earned: 3, possible: 4 });
    expect(reviewed.attempts).toHaveLength(1);
    expect(reviewed.attempts[0]).toMatchObject({
      attemptId: subsetAttemptId,
      score: { earned: 3, possible: 4 },
    });
  });

  it('leaves a whole-pool attempt on its own denominator (#1298)', async () => {
    expect(await storedAttempt(fullAttemptId)).toEqual({
      score: 1,
      total_points: 2,
      total_questions: 3,
    });

    await grade(fullAssignmentId, fullAttemptId, fullOpenItemId, 1);

    expect(await storedAttempt(fullAttemptId)).toEqual({
      score: 2,
      total_points: 3,
      total_questions: 3,
    });
    expect(await resultsRow(fullAssignmentId, fullAttemptId)).toMatchObject({
      score: 2,
      total_points: 3,
    });
    expect((await review(fullAssignmentId)).score).toEqual({ earned: 2, possible: 3 });
  });

  it('keeps each ungraded open item outside the denominator until it is graded (#1298)', async () => {
    // One served closed item, two served open items: only the closed one is in the denominator.
    expect(await storedAttempt(mixedAttemptId)).toMatchObject({ score: 1, total_points: 1 });

    await grade(mixedAssignmentId, mixedAttemptId, requiredAt(mixedOpenItemIds, 0, 'open a'), 1);
    expect(await storedAttempt(mixedAttemptId)).toMatchObject({ score: 2, total_points: 2 });

    // The first open item must not be counted twice when the second one is graded.
    await grade(mixedAssignmentId, mixedAttemptId, requiredAt(mixedOpenItemIds, 1, 'open b'), 1);
    expect(await storedAttempt(mixedAttemptId)).toMatchObject({ score: 3, total_points: 3 });
  });
});
