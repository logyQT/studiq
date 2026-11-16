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
import { PUT as assignmentPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1174 phase 5: the attempt rules (R6/R7/R19). Attempts exist only inside the window (already
// enforced), the budget is a product state (`NO_ATTEMPTS_LEFT`, not a 429), and a retake draws a
// fresh sample by default — never a silent reuse — unless the teacher opted into same-item retakes.
// The seam is the real route → controller → service stack against local Supabase.

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string }>;
}

function FUTURE(hours = 48): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Assessment attempts: fresh-sample retakes and the budget (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let assignmentId!: string;
  /** Question ids in the order they were bound, so a draw can be checked against the pool. */
  let pool: string[] = [];

  const cookie = () => ({ active_org_id: orgId });

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

  /** Starts an attempt and submits it, returning the item ids it served. */
  async function sit(): Promise<string[]> {
    const started = await start();
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;
    expect((await submit(attempt.id)).status).toBe(200);
    return attempt.questions.map((question) => question.id);
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 6 });
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

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `retake-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            // Three attempts, two items each: the pool is three times one attempt, which is the
            // inventory a fresh sample needs.
            maxAttempts: 3,
            attemptItemCount: 2,
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestions = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: pool }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestions.request, { params: addQuestions.params });
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
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('serves one draw of the pool per attempt and never repeats an item (R7)', async () => {
    const first = await sit();
    expect(first.length, 'the draw is the configured attempt size').toBe(2);
    expect(
      first.every((id) => pool.includes(id)),
      'the draw comes from the pool',
    ).toBe(true);

    const second = await sit();
    expect(second.length).toBe(2);
    expect(
      second.filter((id) => first.includes(id)),
      'a fresh sample is disjoint from the earlier attempt',
    ).toEqual([]);

    const third = await sit();
    expect(third.length).toBe(2);
    expect(
      [...first, ...second].filter((id) => third.includes(id)),
      'the third attempt draws from what is left',
    ).toEqual([]);

    // Three disjoint draws of two out of six consume the pool exactly.
    expect(new Set([...first, ...second, ...third]).size).toBe(6);
  });

  it('answers NO_ATTEMPTS_LEFT, not a 429, once the budget is spent (R19)', async () => {
    const response = await start();
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('NO_ATTEMPTS_LEFT');
  });

  it('reopens the whole pool when the count is cleared (R7)', async () => {
    mockUser(teacher.user);
    const cleared = await assignmentPut(
      createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}`,
        { id: assignmentId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attemptItemCount: null }),
        },
        cookie(),
      ).request,
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(cleared.status, await cleared.clone().text()).toBe(200);

    // The composer's "Whole pool" is an explicit null, not an omission: an omitted key would leave
    // the old count in place and the field could never be reopened.
    const { data: row } = await service
      .from('teacher_assignments')
      .select('attempt_item_count')
      .eq('id', assignmentId)
      .single();
    expect(asJson<{ attempt_item_count: number | null }>(row).attempt_item_count).toBeNull();
  });
});

describe('Assessment attempts: exhausted inventory (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 2 });
    student = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    const groupId = requiredAt(teacher.groups, 0, 'the seeded group');

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

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id);
    const questionIds = asJson<Array<{ id: string }>>(questionRows ?? []).map((row) => row.id);
    await service.from('bank_groups').insert({
      bank_id: asJson<{ bank_id: string }>(requiredAt(questionRows, 0, 'a seeded question'))
        .bank_id,
      group_id: groupId,
    });

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `exhausted-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            // Two attempts but the whole pool is served every time: the second has nothing fresh.
            maxAttempts: 2,
          }),
        },
        cookie(),
      ),
    );
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestions = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestions.request, { params: addQuestions.params });
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
    expect((await publishPost(publish.request, { params: publish.params })).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('refuses a retake with NO_UNSEEN_ITEMS instead of reusing seen items (R7/R19)', async () => {
    mockUser(student.user);
    const first = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    const started = await assignmentStart(first.request, { params: first.params });
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers: [] }),
      },
      {},
    );
    expect((await attemptSubmit(submitted.request, { params: submitted.params })).status).toBe(200);

    const retake = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    const response = await assignmentStart(retake.request, { params: retake.params });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('NO_UNSEEN_ITEMS');

    const { data: attempts } = await service
      .from('quiz_attempts')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('user_id', student.user.id);
    expect(asJson<unknown[]>(attempts ?? []).length, 'no attempt row was created').toBe(1);
  });
});

describe('Assessment attempts: the same-item retake flag (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 6 });
    student = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    const groupId = requiredAt(teacher.groups, 0, 'the seeded group');

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

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id);
    const questionIds = asJson<Array<{ id: string }>>(questionRows ?? []).map((row) => row.id);
    await service.from('bank_groups').insert({
      bank_id: asJson<{ bank_id: string }>(requiredAt(questionRows, 0, 'a seeded question'))
        .bank_id,
      group_id: groupId,
    });

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `same-item-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            // A six-item pool with a one-item attempt: a flagged retake must serve the same single
            // item, so a draw from the pool instead of from the served set is very unlikely to
            // coincide.
            maxAttempts: 3,
            attemptItemCount: 1,
          }),
        },
        cookie(),
      ),
    );
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestions = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestions.request, { params: addQuestions.params });
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
    expect((await publishPost(publish.request, { params: publish.params })).status).toBe(200);

    // The teacher turns the flag on for this assessment; it is off by default (R6).
    const updated = await assignmentPut(
      createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}`,
        { id: assignmentId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowSameItemRetake: true }),
        },
        cookie(),
      ).request,
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  /** Starts an attempt, submits it, and returns the items it served. */
  async function sitOnce(): Promise<string[]> {
    mockUser(student.user);
    const started = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    const response = await assignmentStart(started.request, { params: started.params });
    expect(response.status, await response.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(response)).data;
    const served = attempt.questions.map((question) => question.id);

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers: [] }),
      },
      {},
    );
    expect((await attemptSubmit(submitted.request, { params: submitted.params })).status).toBe(200);
    return served;
  }

  it('serves the same items again when the teacher allowed it (R6)', async () => {
    const first = await sitOnce();
    expect(first.length).toBe(1);
    // Both retakes inside the window serve the same item: the flag is the deliberate exception to
    // the fresh-sample rule, and it must not drift back into drawing from the pool.
    expect(await sitOnce()).toEqual(first);
    expect(await sitOnce()).toEqual(first);
  });
});

describe('Assessment attempts: the exposure ledger burns an item for retakes (#1174)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let assignmentId!: string;
  let pool: string[] = [];

  const cookie = () => ({ active_org_id: orgId });

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 4 });
    student = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    const groupId = requiredAt(teacher.groups, 0, 'the seeded group');

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

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id);
    pool = asJson<Array<{ id: string }>>(questionRows ?? []).map((row) => row.id);
    await service.from('bank_groups').insert({
      bank_id: asJson<{ bank_id: string }>(requiredAt(questionRows, 0, 'a seeded question'))
        .bank_id,
      group_id: groupId,
    });

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `ledger-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
            // Two of four items per attempt, so after attempt 1 exactly two items are left and one
            // of them is burnt below: a correct sample is one item, one that ignored the ledger is
            // two — the count alone decides the rule.
            maxAttempts: 2,
            attemptItemCount: 2,
            // The ledger arm is what this suite is about, so the run opts into unseen-only: on the
            // default it is information, and the burnt item would be served.
            unseenOnly: true,
          }),
        },
        cookie(),
      ),
    );
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const addQuestions = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: pool }),
      },
      cookie(),
    );
    await addQuestionsPost(addQuestions.request, { params: addQuestions.params });
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
    expect((await publishPost(publish.request, { params: publish.params })).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('keeps an item out of the retake when its key was already rendered (R8)', async () => {
    mockUser(student.user);
    const first = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    const started = await assignmentStart(first.request, { params: first.params });
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;
    const served = attempt.questions.map((question) => question.id);
    expect(served.length, 'the draw is the configured attempt size').toBe(2);

    const submitted = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers: [] }),
      },
      {},
    );
    expect((await attemptSubmit(submitted.request, { params: submitted.params })).status).toBe(200);

    // A key rendered elsewhere (practice, or another assessment's review) burns the item for this
    // student, so the retake must not draw it even though this assessment never served it.
    const remaining = pool.filter((id) => !served.includes(id));
    expect(remaining.length, 'two items were never served').toBe(2);
    const burnt = requiredAt(remaining, 0, 'an unserved item to burn');
    const fresh = requiredAt(remaining, 1, 'the only fresh item left');
    const { error } = await service.from('exposure_events').insert({
      student_id: student.user.id,
      question_id: burnt,
      organization_id: orgId,
      group_ids: [],
    });
    expect(error, 'the ledger row is what burns the item').toBeNull();

    const retake = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    const response = await assignmentStart(retake.request, { params: retake.params });
    expect(response.status, await response.clone().text()).toBe(200);
    const again = (await json<{ data: AttemptPayload }>(response)).data.questions.map(
      (question) => question.id,
    );
    expect(again, 'a key-rendered item is not fresh').toEqual([fresh]);
  });
});
