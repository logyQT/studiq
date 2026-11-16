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
import { GET as resultsGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { PATCH as taughtPatch } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/[questionId]/flags/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1172 phase 3 (slice B2): the fairness flags (R9). Counts only, per student and per class; taught
// items are labelled and excluded, and a cell under five respondents is suppressed.

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; question_answers?: Array<{ id: string }> }>;
}

interface FairnessPayload {
  attempts: unknown[];
  fairness: {
    respondents: number;
    minRespondents: number;
    items: Array<{
      questionId: string;
      taughtItem: boolean;
      served: number | null;
      correct: number | null;
      ungraded: number | null;
    }>;
  };
}

function FUTURE(): string {
  return new Date(Date.now() + 48 * 3_600_000).toISOString();
}

describe('Exposure fairness (#1172)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  /** A full cohort: five respondents is the fairness threshold. */
  let cohort: BeforeResult[] = [];
  let orgId!: string;
  let groupId!: string;
  let pool: string[] = [];

  const cookie = () => ({ active_org_id: orgId });

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

  /** The option a student has to pick to be graded correct, read past RLS with the service role. */
  async function correctOptionId(questionId: string): Promise<string> {
    const { data } = await service
      .from('question_options')
      .select('id')
      .eq('question_id', questionId)
      .eq('is_correct', true)
      .maybeSingle();
    return asJson<{ id: string }>(data).id;
  }

  async function sit(
    user: BeforeResult['user'],
    assignmentId: string,
    answerCorrectly: string[] = [],
  ): Promise<string[]> {
    mockUser(user);
    const start = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const started = await assignmentStart(start.request, { params: start.params });
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;

    const answers: Array<{ questionId: string; selectedAnswerId: string }> = [];
    for (const questionId of answerCorrectly) {
      answers.push({ questionId, selectedAnswerId: await correctOptionId(questionId) });
    }

    const submit = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers }),
      },
      cookie(),
    );
    expect((await attemptSubmit(submit.request, { params: submit.params })).status).toBe(200);
    return attempt.questions.map((question) => question.id);
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 4 });
    cohort = [
      await before({ role: 'student' }),
      await before({ role: 'student' }),
      await before({ role: 'student' }),
      await before({ role: 'student' }),
      await before({ role: 'student' }),
    ];
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    for (const member of cohort) {
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
    const bankId = asJson<{ bank_id: string }>(
      requiredAt(questionRows, 0, 'a seeded question'),
    ).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });
  });

  afterAll(async () => {
    for (const member of cohort) await cleanupQuizAttempts(member.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('labels a taught item in fairness and suppresses a small cell (R9)', async () => {
    const taughtItem = requiredAt(pool, 0, 'first item');
    const countedItem = requiredAt(pool, 2, 'third item');
    const smallItem = requiredAt(pool, 3, 'fourth item');

    // Five students is exactly the threshold, so the counted cell is visible while the taught item
    // stays excluded for a reason that suppression cannot explain.
    const full = await createAssessment(`fairness-full-${Date.now()}`, [taughtItem, countedItem]);
    mockUser(teacher.user);
    const declare = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${full}/questions/${taughtItem}/flags`,
      { id: full, questionId: taughtItem },
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taught: true }),
      },
      cookie(),
    );
    expect((await taughtPatch(declare.request, { params: declare.params })).status).toBe(200);
    expect((await publish(full)).status).toBe(200);
    for (const member of cohort) {
      expect(await sit(member.user, full, [countedItem])).toContain(countedItem);
    }

    // A second run over one item, sat by two students: not a statistic.
    const small = await createAssessment(`fairness-small-${Date.now()}`, [smallItem]);
    expect((await publish(small)).status).toBe(200);
    for (const member of cohort.slice(0, 2)) await sit(member.user, small);

    mockUser(teacher.user);
    const fullCall = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${full}/results`,
      { id: full },
      {},
      cookie(),
    );
    const fullResponse = await resultsGet(fullCall.request, { params: fullCall.params });
    expect(fullResponse.status, await fullResponse.clone().text()).toBe(200);
    const { fairness } = (await json<{ data: FairnessPayload }>(fullResponse)).data;

    expect(fairness.respondents).toBe(5);
    expect(fairness.minRespondents).toBe(5);
    const taught = fairness.items.find((item) => item.questionId === taughtItem);
    const counted = fairness.items.find((item) => item.questionId === countedItem);
    expect(taught, 'a taught item is labelled and never counted').toMatchObject({
      taughtItem: true,
      served: null,
      correct: null,
      ungraded: null,
    });
    // Five correct answers: the cell is only a statistic if the answers are actually read, so a
    // broken read cannot hide behind a zero.
    expect(counted, 'five respondents make the cell a statistic').toMatchObject({
      taughtItem: false,
      served: 5,
      correct: 5,
      ungraded: 0,
    });

    const smallCall = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${small}/results`,
      { id: small },
      {},
      cookie(),
    );
    const smallResponse = await resultsGet(smallCall.request, { params: smallCall.params });
    const smallFairness = (await json<{ data: FairnessPayload }>(smallResponse)).data.fairness;
    expect(smallFairness.respondents).toBe(2);
    expect(smallFairness.items[0], 'two respondents are not a statistic').toMatchObject({
      taughtItem: false,
      served: null,
      correct: null,
      ungraded: null,
    });
    // Counts only: no option-level field ever leaves this endpoint.
    expect(JSON.stringify(fairness)).not.toMatch(/option|is_correct|selected/);
  });
});
