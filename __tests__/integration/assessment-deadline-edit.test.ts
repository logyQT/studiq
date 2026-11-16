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
import { GET as questionGet } from '@/app/(backend)/api/v1/questions/[id]/route';
import { GET as reviewGet } from '@/app/(backend)/api/v1/assignments/[id]/review/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { PUT as assignmentPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';

// #1191 (R12/R20): a live run's deadline may move forward — a correction — but a close at or before
// `now` is refused, because ending the run early is the explicit Close: it records `closed_at`,
// expires running attempts and reveals deliberately. The seam is the real route → controller →
// service stack against local Supabase, so the field error, the seal and the close are observed as
// produced rather than restated.

interface RunRow {
  status: string;
  start_time: string | null;
  deadline: string | null;
  closed_at: string | null;
}

interface IssueBody {
  error?: string;
  issues?: { properties?: Record<string, { errors?: string[] } | undefined> };
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

describe("A live assessment's deadline may move, but not end the run (#1191)", () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let questionId!: string;
  let assignmentId!: string;
  let draftId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function run(id = assignmentId): Promise<RunRow> {
    const { data } = await service
      .from('teacher_assignments')
      .select('status, start_time, deadline, closed_at')
      .eq('id', id)
      .single();
    return asJson<RunRow>(data);
  }

  function edit(id: string, body: Record<string, unknown>): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${id}`,
      { id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      cookie(),
    );
    return assignmentPut(request, { params });
  }

  /** The sealed item's student read: 404 while held, 200 once the run releases it. */
  async function studentQuestion(): Promise<number> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      {},
      cookie(),
    );
    return (await questionGet(request, { params })).status;
  }

  async function studentReview(): Promise<number> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review`,
      { id: assignmentId },
      {},
      {},
    );
    return (await reviewGet(request, { params })).status;
  }

  /** A complete run: deadline, one targeted class, one item. */
  async function createRun(title: string): Promise<string> {
    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, deadline: inHours(48), showResults: true }),
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
        body: JSON.stringify({ questionIds: [questionId] }),
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

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
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

    questionId = requiredAt(teacher.created.questions, 0, 'the seeded question');
    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    await service
      .from('bank_groups')
      .insert({ bank_id: asJson<{ bank_id: string }>(questionRow).bank_id, group_id: groupId });

    assignmentId = await createRun(`deadline-live-${Date.now()}`);
    draftId = await createRun(`deadline-draft-${Date.now()}`);

    // A start two hours back is what makes the run live, and it leaves room for a *past* deadline
    // that is still after the start — the case the live rule decides, not the window rule.
    mockUser(teacher.user);
    const published = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: inHours(48), startTime: inHours(-2) }),
      },
      cookie(),
    );
    expect((await publishPost(published.request, { params: published.params })).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('refuses a past deadline on the live run, naming the field and pointing at Close', async () => {
    const initial = await run();

    const response = await edit(assignmentId, { deadline: inHours(-1) });
    expect(response.status, await response.clone().text()).toBe(422);
    const body = await json<IssueBody>(response);
    expect(body.error).toBe('UNPROCESSABLE_ENTITY');
    expect(Object.keys(body.issues?.properties ?? {}), 'the refusal names the field').toEqual([
      'deadline',
    ]);
    expect(
      body.issues?.properties?.deadline?.errors,
      'the copy the form renders under the field',
    ).toEqual(['VALIDATION_DEADLINE_END_IS_CLOSE']);

    const after = await run();
    expect(after.deadline, 'the refused edit wrote nothing').toBe(initial.deadline);
    expect(after.closed_at, 'a clock edit is not a close').toBeNull();
    expect(await studentQuestion(), 'the item stays sealed').toBe(404);
    expect(await studentReview(), 'the review stays locked').toBe(403);
  });

  it('accepts a shrink to a future instant and keeps the seal until it', async () => {
    const earlier = inHours(1);

    const response = await edit(assignmentId, { deadline: earlier });
    expect(response.status, await response.clone().text()).toBe(200);

    const after = await run();
    expect(new Date(after.deadline!).toISOString()).toBe(earlier);
    expect(after.closed_at, 'a shrink to the future does not close the run').toBeNull();
    expect(await studentQuestion(), 'the seal still covers the class').toBe(404);
    expect(await studentReview(), 'the review is still locked').toBe(403);
  });

  it('refuses a deadline that lands at or before the window start', async () => {
    const current = await run();
    const beforeStart = new Date(new Date(current.start_time!).getTime() - 60_000).toISOString();

    const response = await edit(assignmentId, { deadline: beforeStart });
    expect(response.status).toBe(422);
    const body = await json<IssueBody>(response);
    expect(Object.keys(body.issues?.properties ?? {})).toEqual(['deadline']);
    expect(body.issues?.properties?.deadline?.errors).toEqual(['VALIDATION_INVALID_INPUT']);
    expect((await run()).deadline).toBe(current.deadline);
  });

  it('lets a draft keep free deadline editing, past included', async () => {
    const response = await edit(draftId, { deadline: inHours(-1) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await run(draftId)).status).toBe('draft');
  });

  it('ends the run through Close, which expires attempts and reveals the cohort', async () => {
    mockUser(teacher.user);
    const closed = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(closed.request, { params: closed.params })).status).toBe(200);

    expect((await run()).closed_at, 'the close is what records the end').not.toBeNull();
    expect(await studentReview(), 'the cohort review reveals').toBe(200);
    expect(await studentQuestion(), 'the item is released').toBe(200);
  });

  it('keeps the closed run closed when its deadline is edited afterwards', async () => {
    const closedAt = (await run()).closed_at;

    const response = await edit(assignmentId, { deadline: inHours(24) });
    expect(response.status, await response.clone().text()).toBe(200);

    expect((await run()).closed_at, 'a clock edit cannot reopen the run').toBe(closedAt);
    expect(await studentReview(), 'and cannot re-lock the review').toBe(200);
  });

  it('settles a run whose clock ran out instead of letting an edit reopen it', async () => {
    // Published with a deadline already behind it and nobody has read it since: the close exists in
    // the clock but not yet in the column, and moving the deadline forward must not un-close it.
    const expiredId = await createRun(`deadline-expired-${Date.now()}`);
    mockUser(teacher.user);
    const published = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${expiredId}/publish`,
      { id: expiredId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: inHours(-1), startTime: inHours(-2) }),
      },
      cookie(),
    );
    expect((await publishPost(published.request, { params: published.params })).status).toBe(200);
    expect((await run(expiredId)).closed_at, 'not stamped by the publish itself').toBeNull();

    const response = await edit(expiredId, { deadline: inHours(24) });
    expect(response.status, await response.clone().text()).toBe(200);

    expect((await run(expiredId)).closed_at, 'the edit settled the close it found').not.toBeNull();
  });
});
