import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { asJson, json } from '#test/helpers/json';
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
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as exportGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/export-answers/route';
import { GET as resultsGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/route';
import { GET as gradingGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/[studentId]/route';
import { PUT as gradePut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/[studentId]/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

/**
 * The CSV route resolves its labels through next-intl, which cannot run outside a Next request
 * scope (`getLocale` is the client-component build in this environment). The status→label mapping
 * is pinned by `__tests__/unit/api/assignment-export-route.test.ts`; the download is asserted here
 * with the same English table so the real route, service and CSV writer run end to end.
 */
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          student: 'Student',
          email: 'Email',
          score: 'Score',
          status: 'Status',
          completed_at: 'Completed',
          unknown: 'Unknown',
          graded: 'Graded',
          submitted: 'Submitted',
          in_progress: 'In progress',
        })[key] ?? key,
    ),
}));

/**
 * #1069: the displayed status is derived from the attempt's served items, never from `graded_at`.
 * `graded_at` is stamped only by a manual grade, so an all-auto-graded attempt stayed „Przesłane”
 * forever and a single grade flipped a half-graded attempt to „Ocenione”.
 *
 * Every surface is asserted against the same attempt: the results list, the grading header and
 * the CSV export must not disagree.
 */

type Route = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function future(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; type: string }>;
}

interface ResultsRow {
  id: string;
  graded: boolean;
  pending_grades: number;
}

interface GradingHeader {
  graded: boolean;
  pending_grades: number;
}

describe('Attempt status is derived from the served items (#1069)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let bankId!: string;

  /** Both option ids of every mcq, so the fixture can answer it right. */
  const options = new Map<string, string>();

  /** All auto-graded: submitted once, nothing for a teacher to do. */
  let autoAssignmentId!: string;
  let autoAttemptId!: string;

  /** Two open items: pending until the last one is graded. */
  let mixedAssignmentId!: string;
  let mixedAttemptId!: string;
  let mixedOpenItemIds!: string[];

  /** The student leaves the open item blank: nothing to grade, so the attempt is terminal. */
  let skippedAssignmentId!: string;
  let skippedAttemptId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function teacherCall<T>(
    route: Route,
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
  async function publishAssignment(itemIds: string[], label: string): Promise<string> {
    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `derived-status-${label}-${Date.now()}`,
            deadline: future(),
            showResults: true,
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
   * Takes the assignment and submits it. `choices` maps a closed item to the option it answers;
   * `openAnswers` names the open items the student writes an answer for. An open item in neither
   * is skipped — no answer row at all.
   */
  async function takeAndSubmit(
    id: string,
    choices: Map<string, string>,
    openAnswers: Set<string>,
  ): Promise<AttemptPayload> {
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
        return openAnswers.has(question.id)
          ? [{ questionId: question.id, textAnswer: 'Trzy przyczyny i krótkie uzasadnienie.' }]
          : [];
      }
      const choice = choices.get(question.id);
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

  /** The results-list row — the same payload the table renders. */
  async function resultsRow(assignmentId: string, attemptId: string): Promise<ResultsRow> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await resultsGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = await json<{ data: { attempts: ResultsRow[] } }>(response);
    const row = payload.data.attempts.find((attempt) => attempt.id === attemptId);
    if (!row) throw new Error('the results payload is missing the attempt');
    return row;
  }

  /** The grading header of one attempt (`GET …/results/:attemptId`). */
  async function gradingHeader(assignmentId: string, attemptId: string): Promise<GradingHeader> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results/${attemptId}`,
      { id: assignmentId, studentId: attemptId },
      {},
      cookie(),
    );
    const response = await gradingGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: GradingHeader }>(response)).data;
  }

  /** The status cell of the answers CSV, read the way the download renders it. */
  async function csvStatus(assignmentId: string): Promise<string> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/export-answers`,
      { id: assignmentId },
      {},
      { ...cookie(), NEXT_LOCALE: 'en' },
    );
    const response = await exportGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
    const rows = body.split('\n');
    const header = rows[0]?.split(',');
    const statusAt = header?.indexOf('Status') ?? -1;
    if (statusAt < 0) throw new Error(`the CSV has no status column: ${rows[0] ?? ''}`);
    const cells = rows[1]?.split(',');
    return cells?.[statusAt] ?? '';
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
  async function insertItem(type: 'open' | 'mcq', content: string): Promise<string> {
    const { data: item, error } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        bank_id: bankId,
        type,
        content,
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
    if (!correct) throw new Error('the inserted mcq has no key');
    options.set(item.id, correct.id);
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
        name: `derived-status-${Date.now()}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(bankError.message);
    bankId = bank.id;

    const stamp = Date.now();

    // All auto-graded: two closed items, no manual grade anywhere.
    const autoItems = [
      await insertItem('mcq', `auto-mcq-a-${stamp}`),
      await insertItem('mcq', `auto-mcq-b-${stamp}`),
    ];
    autoAssignmentId = await publishAssignment(autoItems, 'auto');
    autoAttemptId = (
      await takeAndSubmit(
        autoAssignmentId,
        new Map(autoItems.map((id) => [id, options.get(id) ?? ''])),
        new Set(),
      )
    ).id;

    // Mixed: one closed item and two open ones, all answered.
    const mixedItems = [await insertItem('mcq', `mixed-mcq-${stamp}`)];
    mixedOpenItemIds = [
      await insertItem('open', `mixed-open-a-${stamp}`),
      await insertItem('open', `mixed-open-b-${stamp}`),
    ];
    mixedAssignmentId = await publishAssignment([...mixedItems, ...mixedOpenItemIds], 'mixed');
    mixedAttemptId = (
      await takeAndSubmit(
        mixedAssignmentId,
        new Map(mixedItems.map((id) => [id, options.get(id) ?? ''])),
        new Set(mixedOpenItemIds),
      )
    ).id;

    // Skipped: the open item is served but never answered.
    const skippedMcq = await insertItem('mcq', `skipped-mcq-${stamp}`);
    const skippedOpen = await insertItem('open', `skipped-open-${stamp}`);
    skippedAssignmentId = await publishAssignment([skippedMcq, skippedOpen], 'skipped');
    skippedAttemptId = (
      await takeAndSubmit(
        skippedAssignmentId,
        new Map([[skippedMcq, options.get(skippedMcq) ?? '']]),
        new Set(),
      )
    ).id;
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id);
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('reads an all-auto-graded attempt as graded on submit (#1069)', async () => {
    expect(await resultsRow(autoAssignmentId, autoAttemptId)).toMatchObject({
      graded: true,
      pending_grades: 0,
    });
    expect(await gradingHeader(autoAssignmentId, autoAttemptId)).toMatchObject({
      graded: true,
      pending_grades: 0,
    });
    expect(await csvStatus(autoAssignmentId)).toBe('Graded');
  });

  it('stays submitted until the last open answer is graded (#1069)', async () => {
    expect(await resultsRow(mixedAssignmentId, mixedAttemptId)).toMatchObject({
      graded: false,
      pending_grades: 2,
    });
    expect(await gradingHeader(mixedAssignmentId, mixedAttemptId)).toMatchObject({
      graded: false,
      pending_grades: 2,
    });
    expect(await csvStatus(mixedAssignmentId)).toBe('Submitted');

    await grade(mixedAssignmentId, mixedAttemptId, requiredAt(mixedOpenItemIds, 0, 'open a'), 1);

    expect(await resultsRow(mixedAssignmentId, mixedAttemptId)).toMatchObject({
      graded: false,
      pending_grades: 1,
    });
    expect(await gradingHeader(mixedAssignmentId, mixedAttemptId)).toMatchObject({
      graded: false,
      pending_grades: 1,
    });
    expect(await csvStatus(mixedAssignmentId)).toBe('Submitted');

    await grade(mixedAssignmentId, mixedAttemptId, requiredAt(mixedOpenItemIds, 1, 'open b'), 1);

    expect(await resultsRow(mixedAssignmentId, mixedAttemptId)).toMatchObject({
      graded: true,
      pending_grades: 0,
    });
    expect(await gradingHeader(mixedAssignmentId, mixedAttemptId)).toMatchObject({
      graded: true,
      pending_grades: 0,
    });
    expect(await csvStatus(mixedAssignmentId)).toBe('Graded');
  });

  it('does not keep a skipped open item pending (#1069)', async () => {
    expect(await resultsRow(skippedAssignmentId, skippedAttemptId)).toMatchObject({
      graded: true,
      pending_grades: 0,
    });
    expect(await gradingHeader(skippedAssignmentId, skippedAttemptId)).toMatchObject({
      graded: true,
      pending_grades: 0,
    });
    expect(await csvStatus(skippedAssignmentId)).toBe('Graded');
  });
});
