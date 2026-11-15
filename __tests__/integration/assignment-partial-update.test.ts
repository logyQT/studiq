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
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import {
  GET as assignmentGet,
  PUT as assignmentPut,
} from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';

// #1222: the assessment edit is a partial update by contract. A deadline-only PUT must leave
// show_results / max_attempts / shuffle_* alone, because turning show_results off 404s the
// cohort review on a closed run — a deadline edit is also the documented repair path in #1191.
// The seam is the real route → controller → service stack against local Supabase.

interface AssignmentRow {
  deadline: string;
  show_results: boolean;
  max_attempts: number;
  shuffle_questions: boolean;
  shuffle_answers: boolean;
  passing_score: number | null;
}

const RULES = {
  showResults: true,
  maxAttempts: 3,
  shuffleQuestions: false,
  shuffleAnswers: false,
  passingScore: 60,
} as const;

function as(user: BeforeResult['user']): void {
  mockUser(user);
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

describe('A partial assessment edit keeps the run rules (#1222)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function edit(body: Record<string, unknown>): Promise<Response> {
    as(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      cookie(),
    );
    return assignmentPut(request, { params });
  }

  async function read(): Promise<AssignmentRow> {
    as(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await assignmentGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: AssignmentRow }>(response)).data;
  }

  async function review(): Promise<Response> {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review`,
      { id: assignmentId },
      {},
      cookie(),
    );
    return reviewGet(request, { params });
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 2 });
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

    const ids = teacher.created.questions.slice(0, 2);
    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', requiredAt(ids, 0, 'first item'))
      .single();
    await service
      .from('bank_groups')
      .insert({ bank_id: asJson<{ bank_id: string }>(questionRow).bank_id, group_id: groupId });

    as(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `partial-update-${Date.now()}`,
            deadline: FUTURE(),
            ...RULES,
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
        body: JSON.stringify({ deadline: FUTURE() }),
      },
      cookie(),
    );
    expect((await publishPost(publish.request, { params: publish.params })).status).toBe(200);

    // The impact in #1222 only shows on a closed run: the reveal is what the reset switched off.
    const close = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(close.request, { params: close.params })).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('stores the rules the create sent', async () => {
    expect(await read()).toMatchObject({
      show_results: true,
      max_attempts: 3,
      shuffle_questions: false,
      shuffle_answers: false,
      passing_score: 60,
    });
  });

  it('changes only the deadline on a deadline-only edit', async () => {
    const deadline = new Date(Date.now() + 9 * 86_400_000).toISOString();
    const response = await edit({ deadline });
    expect(response.status, await response.clone().text()).toBe(200);

    const row = await read();
    expect(new Date(row.deadline).toISOString()).toBe(deadline);
    expect(row).toMatchObject({
      show_results: true,
      max_attempts: 3,
      shuffle_questions: false,
      shuffle_answers: false,
      passing_score: 60,
    });
  });

  it('keeps the cohort review readable after the deadline edit', async () => {
    const response = await review();
    expect(response.status, await response.clone().text()).toBe(200);
    const { data } = await json<{ data: { items: unknown[] } }>(response);
    expect(data.items.length).toBeGreaterThan(0);
  });

  it('still applies the fields an edit does send', async () => {
    const response = await edit({ maxAttempts: 5, shuffleQuestions: true, showResults: true });
    expect(response.status, await response.clone().text()).toBe(200);

    expect(await read()).toMatchObject({
      max_attempts: 5,
      shuffle_questions: true,
      shuffle_answers: false,
      show_results: true,
    });
  });
});
