import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BeforeResult, before, createTestUser } from '#test/helpers/test-user';
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
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { GET as reviewGet } from '@/app/(backend)/api/v1/assignments/[id]/review/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import {
  GET as attemptGet,
  POST as attemptSubmit,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as lifecyclePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/[action]/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1174 phase 5: the lifecycle extras (R12/R19/R20). `cancel` is the ending that does not reveal,
// `extend` moves the close forward before it happens, and the manager override can move either bound
// but can never lift a live seal or un-reveal. The seam is the real route → controller → service
// stack against local Supabase, so the codes, the trigger and the seal are observed as produced.

interface AttemptPayload {
  id: string;
}

interface RunRow {
  status: string;
  deadline: string | null;
  start_time: string | null;
  closed_at: string | null;
}

function FUTURE(hours = 48): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function PAST(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Assessment lifecycle: cancel, extend, override (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let manager!: { id: string; role: string };
  let orgId!: string;
  let groupId!: string;
  let questionId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function run(): Promise<RunRow> {
    const { data } = await service
      .from('teacher_assignments')
      .select('status, deadline, start_time, closed_at')
      .eq('id', assignmentId)
      .single();
    return asJson<RunRow>(data);
  }

  function postAs(
    actor: { id: string; role: string },
    path: string,
    body?: unknown,
  ): Promise<Response> {
    mockUser(actor);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/${path}`,
      { id: assignmentId },
      {
        method: 'POST',
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      },
      cookie(),
    );
    if (path === 'close') return closePost(request, { params });
    if (path === 'publish') return publishPost(request, { params });
    // cancel/extend/override share the lifecycle route, keyed by the `action` segment.
    return lifecyclePost(request, { params: Promise.resolve({ id: assignmentId, action: path }) });
  }

  async function start(): Promise<Response> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    return assignmentStart(request, { params });
  }

  /** A student read of the run: 404 once the run is cancelled (it no longer exists for them). */
  async function studentDetail(): Promise<number> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      {},
    );
    return (await assignmentGet(request, { params })).status;
  }

  async function submit(attemptId: string): Promise<Response> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId, answers: [] }),
      },
      {},
    );
    return attemptSubmit(request, { params });
  }

  async function attemptGetFor(attemptId: string): Promise<Response> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {},
      {},
    );
    return attemptGet(request, { params });
  }

  async function studentReview(): Promise<Response> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review`,
      { id: assignmentId },
      {},
      {},
    );
    return reviewGet(request, { params });
  }

  /** The sealed item's student read: 404 while held, 200 once released. */
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

    // The override is a manager's authority: an admin org role is what gives it organisation-wide
    // `assignment.update`, so the ownership check passes on scope rather than authorship.
    const managerUser = await createTestUser({ role: 'manager' });
    const { data: adminRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    await seedOrgMembership({
      organizationId: orgId,
      userId: managerUser.id,
      orgRoleId: asJson<{ id: string }>(adminRole).id,
    });
    // The override proves ownership by organisation scope, which is what the admin role grants once
    // an org admin has configured it.
    await service.from('org_role_permissions').insert({
      org_role_id: asJson<{ id: string }>(adminRole).id,
      permission_name: 'assignment.update',
      scope: 'organization',
    });
    manager = { id: managerUser.id, role: 'manager' };

    questionId = requiredAt(teacher.created.questions, 0, 'the seeded question');
    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    await service
      .from('bank_groups')
      .insert({ bank_id: asJson<{ bank_id: string }>(questionRow).bank_id, group_id: groupId });

    mockUser(teacher.user);
    const createdResponse = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `lifecycle-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            maxAttempts: 2,
          }),
        },
        cookie(),
      ),
    );
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(createdResponse)).data.id;

    const addQuestion = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [questionId] }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestion.request, { params: addQuestion.params });

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

    const published = await postAs(teacher.user, 'publish', { deadline: FUTURE() });
    expect(published.status, await published.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('extends the window forward while live, and keeps the review locked (R12)', async () => {
    expect(await studentQuestion(), 'the item is held while the window is open').toBe(404);
    const initial = await run();
    const later = new Date(new Date(initial.deadline!).getTime() + 3_600_000).toISOString();

    const response = await postAs(teacher.user, 'extend', { closesAt: later });
    expect(response.status, await response.clone().text()).toBe(200);

    const after = await run();
    expect(new Date(after.deadline!).toISOString()).toBe(later);
    expect(after.closed_at, 'extending is not a close').toBeNull();
    expect((await studentReview()).status, 'the review is still locked').toBe(403);
    expect(await studentQuestion(), 'the item is still held').toBe(404);
  });

  it('refuses an extension that would shrink the window (R12/R19)', async () => {
    const current = await run();
    const earlier = new Date(new Date(current.deadline!).getTime() - 3_600_000).toISOString();

    const response = await postAs(teacher.user, 'extend', { closesAt: earlier });
    expect(response.status).toBe(422);
    const body = await json<{ issues?: { properties?: Record<string, unknown> } }>(response);
    expect(Object.keys(body.issues?.properties ?? {}), 'the refusal names the field').toEqual([
      'closesAt',
    ]);
    expect((await run()).deadline).toBe(current.deadline);
  });

  it('refuses an override that ends a live seal now, but allows a shrink to a future instant (R20)', async () => {
    const now = await postAs(manager, 'override', { closesAt: PAST() });
    expect(now.status, 'an override cannot lift a live seal').toBe(409);
    expect(await errorOf(now)).toBe('ASSESSMENT_LIVE');
    expect((await run()).closed_at).toBeNull();
    expect(await studentQuestion()).toBe(404);

    const earlier = new Date(Date.now() + 3_600_000).toISOString();
    const shrink = await postAs(manager, 'override', { closesAt: earlier });
    expect(shrink.status, await shrink.clone().text()).toBe(200);
    expect(new Date((await run()).deadline!).toISOString()).toBe(earlier);
    expect(await studentQuestion(), 'a shrink does not release the items').toBe(404);
  });

  it('refuses an override that moves a live start into the future (R20)', async () => {
    // A well-formed window whose start is ahead of `now`: the run would stop being live, releasing
    // items the class is still being assessed on. That is the unseal R20 forbids.
    const response = await postAs(manager, 'override', {
      opensAt: FUTURE(2),
      closesAt: FUTURE(48),
    });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ASSESSMENT_LIVE');
  });

  it('refuses an override window whose start is after its close (R20)', async () => {
    const response = await postAs(manager, 'override', {
      opensAt: FUTURE(72),
      closesAt: FUTURE(24),
    });
    expect(response.status).toBe(422);
    const body = await json<{ issues?: { properties?: Record<string, unknown> } }>(response);
    expect(Object.keys(body.issues?.properties ?? {}), 'the refusal names the field').toEqual([
      'opensAt',
    ]);
  });

  it('refuses the override to a teacher — moving a window is a manager decision (R20)', async () => {
    mockUser(teacher.user);
    const { request } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/override`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closesAt: FUTURE() }),
      },
      cookie(),
    );
    const response = await lifecyclePost(request, {
      params: Promise.resolve({ id: assignmentId, action: 'override' }),
    });
    expect(response.status).toBe(403);
  });

  it('cancels a live run: attempts expire, the seal lifts and there is no review (R12/R19)', async () => {
    // A submitted attempt and a running one: the cancel must expire the running one, and the
    // submitted one must not become a review of a cancelled run (that would be a reveal).
    const first = await start();
    expect(first.status, await first.clone().text()).toBe(200);
    const firstId = (await json<{ data: AttemptPayload }>(first)).data.id;
    const submitted = await submit(firstId);
    expect(submitted.status, await submitted.clone().text()).toBe(200);

    const second = await start();
    expect(second.status, await second.clone().text()).toBe(200);
    const runningId = (await json<{ data: AttemptPayload }>(second)).data.id;

    const response = await postAs(teacher.user, 'cancel');
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await json<{ data: { status: string; expired_attempts: number } }>(response))
      .data;
    expect(body.status).toBe('cancelled');
    expect(body.expired_attempts, 'the running attempt is the one the cancel ended').toBe(1);

    const { data: attemptRow } = await service
      .from('quiz_attempts')
      .select('expired_at, completed_at')
      .eq('id', runningId)
      .single();
    const attempt = asJson<{ expired_at: string | null; completed_at: string | null }>(attemptRow);
    expect(attempt.expired_at, 'the running attempt expired with the cancel').not.toBeNull();
    expect(attempt.completed_at).toBeNull();

    expect(await studentQuestion(), 'a cancelled run releases its items (R2)').toBe(200);
    expect(await studentDetail(), 'a cancelled run does not exist for the student').toBe(404);
    const review = await studentReview();
    expect(review.status, 'a cancelled run has no review at all').toBe(404);

    // The submitted attempt is not a back door to the key: the cancel ended the run without a
    // reveal, so its review stays closed.
    const submittedReview = await attemptGetFor(firstId);
    expect(submittedReview.status, 'a cancelled run never renders its key').toBe(403);
    expect(await start(), 'no attempt after the cancel').toHaveProperty('status', 404);
  });

  it('refuses a second cancel and a close on the cancelled run (R19)', async () => {
    const again = await postAs(teacher.user, 'cancel');
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe('ASSESSMENT_CANCELLED');

    const close = await postAs(teacher.user, 'close');
    expect(close.status).toBe(409);
    expect(await errorOf(close)).toBe('ASSESSMENT_CANCELLED');
  });

  it('refuses publishing after the cancel (R19)', async () => {
    const response = await postAs(teacher.user, 'publish', { deadline: FUTURE() });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ASSESSMENT_CANCELLED');
    expect((await run()).status).toBe('cancelled');
  });

  it('keeps the cancel durable at the database boundary (R12)', async () => {
    const { error } = await service
      .from('teacher_assignments')
      .update({ status: 'published' })
      .eq('id', assignmentId);
    expect(error?.code, 'the terminal-status trigger refuses a revival').toBe('23514');
    expect((await run()).status).toBe('cancelled');
  });
});

describe('Assessment lifecycle: cancel a scheduled run (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let questionId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');
    questionId = requiredAt(teacher.created.questions, 0, 'the seeded question');
    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    await service
      .from('bank_groups')
      .insert({ bank_id: asJson<{ bank_id: string }>(questionRow).bank_id, group_id: groupId });

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `scheduled-${Date.now()}`,
            deadline: FUTURE(72),
            showResults: true,
          }),
        },
        cookie(),
      ),
    );
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestion = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [questionId] }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestion.request, { params: addQuestion.params });
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

    // Scheduled: published, but the window has not opened yet.
    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE(72), startTime: FUTURE(24) }),
      },
      cookie(),
    );
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('cancels a scheduled run before it opens, and then refuses the publish (R12/R19)', async () => {
    const { request } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/cancel`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const response = await lifecyclePost(request, {
      params: Promise.resolve({ id: assignmentId, action: 'cancel' }),
    });
    expect(response.status, await response.clone().text()).toBe(200);

    const { data } = await service
      .from('teacher_assignments')
      .select('status, closed_at')
      .eq('id', assignmentId)
      .single();
    const row = asJson<{ status: string; closed_at: string | null }>(data);
    expect(row.status).toBe('cancelled');
    expect(row.closed_at, 'the run is closed durably, not merely labelled').not.toBeNull();

    mockUser(teacher.user);
    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE(72), startTime: FUTURE(24) }),
      },
      cookie(),
    );
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status).toBe(409);
    expect(await errorOf(published)).toBe('ASSESSMENT_CANCELLED');
  });
});

describe('Assessment lifecycle: closed runs cannot be extended or cancelled (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let manager!: { id: string; role: string };
  let orgId!: string;
  let questionId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    const groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const managerUser = await createTestUser({ role: 'manager' });
    const { data: adminRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    await seedOrgMembership({
      organizationId: orgId,
      userId: managerUser.id,
      orgRoleId: asJson<{ id: string }>(adminRole).id,
    });
    // The override proves ownership by organisation scope, which is what the admin role grants once
    // an org admin has configured it.
    await service.from('org_role_permissions').insert({
      org_role_id: asJson<{ id: string }>(adminRole).id,
      permission_name: 'assignment.update',
      scope: 'organization',
    });
    manager = { id: managerUser.id, role: 'manager' };
    questionId = requiredAt(teacher.created.questions, 0, 'the seeded question');

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `closed-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
          }),
        },
        cookie(),
      ),
    );
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestion = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [questionId] }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestion.request, { params: addQuestion.params });
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
    await publishPost(publish.request, { params: publish.params });
  });

  afterAll(async () => {
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('refuses extend, cancel and override once the run is closed (R12/R19/R20)', async () => {
    mockUser(teacher.user);
    const closed = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(closed.request, { params: closed.params })).status).toBe(200);

    const extend = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/extend`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closesAt: FUTURE() }),
      },
      cookie(),
    );
    const extended = await lifecyclePost(extend.request, {
      params: Promise.resolve({ id: assignmentId, action: 'extend' }),
    });
    expect(extended.status).toBe(409);
    expect(await errorOf(extended), 'reopening after close is impossible').toBe(
      'ASSESSMENT_CLOSED',
    );

    const cancel = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/cancel`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const cancelled = await lifecyclePost(cancel.request, {
      params: Promise.resolve({ id: assignmentId, action: 'cancel' }),
    });
    expect(cancelled.status).toBe(409);
    expect(await errorOf(cancelled)).toBe('ASSESSMENT_CLOSED');

    mockUser(manager);
    const override = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/override`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closesAt: FUTURE() }),
      },
      cookie(),
    );
    const overridden = await lifecyclePost(override.request, {
      params: Promise.resolve({ id: assignmentId, action: 'override' }),
    });
    expect(overridden.status, 'a manager cannot un-reveal').toBe(409);
    expect(await errorOf(overridden)).toBe('ASSESSMENT_CLOSED');
  });
});
