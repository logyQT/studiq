import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
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
import { GET as studentAnswersGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/[studentId]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1240: the grading view renders the published item and its published key. A post-publish edit to
// the live row must never reach the teacher's grading screen — the student was graded against the
// frozen `assignment_questions.snapshot` / `snapshot_key` (R11).

const PUBLISHED_EXPLANATION =
  'Opublikowane wyjaśnienie: Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku.';
const LIVE_EXPLANATION =
  'Wyjaśnienie zmienione po publikacji: tego tekstu nauczyciel nie może zobaczyć w ocenianiu.';
const PUBLISHED_OPTION = 'opublikowana-odpowiedz';
const LIVE_OPTION = 'odpowiedz-zmieniona-po-publikacji';

type AssignmentRoute = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

function future(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

interface AttemptPayload {
  id: string;
  questions: Array<{
    id: string;
    question_answers?: Array<{ id: string; content: string }>;
  }>;
}

interface GradingQuestion {
  question_id: string;
  question: {
    id: string;
    content: string;
    explanation: string | null;
    model_answer: string | null;
    question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
  } | null;
}

interface GradingPayload {
  id: string;
  quiz_attempt_questions: GradingQuestion[];
}

describe('Grading view reads the published key, not the live item (#1240)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let assignmentId!: string;
  let attemptId!: string;
  let itemId!: string;
  let correctOptionId!: string;

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

  async function gradingView(): Promise<GradingPayload> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results/${attemptId}`,
      { id: assignmentId, studentId: attemptId },
      {},
      cookie(),
    );
    const response = await studentAnswersGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: GradingPayload }>(response)).data;
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
        name: `grading-snapshot-${Date.now()}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(bankError.message);

    const { data: item, error: itemError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacher.user.id,
        bank_id: bank.id,
        type: 'mcq',
        content: `grading-snapshot-${Date.now()}`,
        explanation: PUBLISHED_EXPLANATION,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (itemError) throw new Error(itemError.message);
    itemId = item.id;

    const { data: options, error: optionError } = await service
      .from('question_options')
      .insert([
        { question_id: itemId, content: PUBLISHED_OPTION, is_correct: true, order_index: 0 },
        { question_id: itemId, content: 'dystraktor', is_correct: false, order_index: 1 },
      ])
      .select('id, is_correct');
    if (optionError) throw new Error(optionError.message);
    correctOptionId = requiredAt(
      options.filter((option) => option.is_correct),
      0,
      'the keyed option',
    ).id;

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `grading-snapshot-${Date.now()}`, deadline: future() }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;
    await teacherCall(
      addQuestionsPost,
      `/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      'POST',
      { questionIds: [itemId] },
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

    mockUser(student.user);
    const started = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const startResponse = await assignmentStart(started.request, { params: started.params });
    expect(startResponse.status, await startResponse.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(startResponse)).data;
    attemptId = attempt.id;

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [{ questionId: itemId, selectedAnswerId: correctOptionId }],
        }),
      },
      cookie(),
    );
    const submitResponse = await attemptSubmit(submitted.request, { params: submitted.params });
    expect(submitResponse.status, await submitResponse.clone().text()).toBe(200);

    // The author edits the live item after publish: the explanation and the keyed option's text.
    const { error: explanationError } = await service
      .from('questions')
      .update({ explanation: LIVE_EXPLANATION })
      .eq('id', itemId);
    if (explanationError) throw new Error(explanationError.message);
    const { error: optionUpdateError } = await service
      .from('question_options')
      .update({ content: LIVE_OPTION })
      .eq('id', correctOptionId);
    if (optionUpdateError) throw new Error(optionUpdateError.message);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id);
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('serves the published explanation and option text after a post-publish edit (#1240)', async () => {
    const view = await gradingView();
    const graded = requiredAt(view.quiz_attempt_questions, 0, 'the graded question');
    expect(graded.question, 'the published item is rendered').not.toBeNull();

    expect(graded.question?.explanation, 'the frozen key, not the edited live row').toBe(
      PUBLISHED_EXPLANATION,
    );
    expect(graded.question?.explanation).not.toBe(LIVE_EXPLANATION);

    const options = graded.question?.question_answers ?? [];
    expect(
      options.map((option) => option.content),
      'the option text is the one published with the run',
    ).toEqual([PUBLISHED_OPTION, 'dystraktor']);
    expect(options.find((option) => option.content === LIVE_OPTION)).toBeUndefined();
    // The key still points at the option the student was graded against.
    expect(options.find((option) => option.is_correct)?.content).toBe(PUBLISHED_OPTION);
  });
});
