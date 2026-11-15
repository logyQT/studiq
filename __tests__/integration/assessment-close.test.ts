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
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import {
  POST as attemptSubmit,
  GET as attemptGet,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { PUT as attemptSaveAnswers } from '@/app/(backend)/api/v1/quiz/[attemptId]/answers/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1171 slice 3a: the durable close (R7/R12/R19). Natural expiry at the deadline and an explicit
// close both write `closed_at` — which the clock can no longer rewrite — and both end the attempts
// that were still running. The seam is the real route → controller → service stack against local
// Supabase, so the expiry, the codes and the seal are observed exactly as the server produces them.

interface AttemptPayload {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    question_answers?: Array<{ id: string; content: string }>;
  }>;
}

interface StudentDetail {
  review_unlocked: boolean;
  closed_at: string | null;
  attempts_used: number;
  attempt: { id: string; completed_at: string | null; expired_at: string | null } | null;
}

function as(user: BeforeResult['user']): void {
  mockUser(user);
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

function PAST(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

/** The `error` field of a failed response (`ERROR_*`). */
async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Durable assessment close (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let outsider!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let bankId!: string;
  let questionId!: string;
  let assignmentId!: string;
  let expiredAttemptId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function close(): Promise<Response> {
    as(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    return closePost(request, { params });
  }

  async function start(): Promise<Response> {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      {},
    );
    return assignmentStart(request, { params });
  }

  async function detail(): Promise<StudentDetail> {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      {},
    );
    const response = await assignmentGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: StudentDetail }>(response)).data;
  }

  async function studentQuestion(): Promise<number> {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      {},
      cookie(),
    );
    return (await questionGet(request, { params })).status;
  }

  async function closedAt(): Promise<string | null> {
    const { data } = await service
      .from('teacher_assignments')
      .select('closed_at')
      .eq('id', assignmentId)
      .single();
    return asJson<{ closed_at: string | null }>(data).closed_at;
  }

  beforeAll(async () => {
    // Two organisations: the run's owner and a teacher outside it, so the staff-only close is a
    // real refusal rather than a missing row.
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
    outsider = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
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
    bankId = asJson<{ bank_id: string }>(questionRow).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });

    as(teacher.user);
    const createRequest = createNextRequest(
      'http://localhost/api/v1/teacher/assignments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `close-${Date.now()}`, deadline: FUTURE() }),
      },
      cookie(),
    );
    const createdResponse = await createAssignmentPost(createRequest);
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
    expect(
      (await addQuestionsPost(addQuestion.request, { params: addQuestion.params })).status,
    ).toBe(200);

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
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
    if (outsider.orgId) await cleanupOrganizationDeep(outsider.orgId);
  });

  it('keeps an open window sealed and review locked', async () => {
    expect(await studentQuestion(), 'the item is held while the window is open').toBe(404);
    const initial = await detail();
    expect(initial.review_unlocked).toBe(false);
    expect(initial.closed_at).toBeNull();
  });

  it('refuses the close to a teacher who does not own the run', async () => {
    as(outsider.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      { active_org_id: outsider.orgId ?? '' },
    );
    const response = await closePost(request, { params });
    expect(response.status).toBe(404);
  });

  it('closes explicitly, expires the running attempt and ends the seal (R7/R12)', async () => {
    // A real running attempt: the close must end it, not leave a resumable row behind.
    const started = await start();
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;
    expiredAttemptId = attempt.id;

    const response = await close();
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await json<{ data: { closed_at: string; expired_attempts: number } }>(response))
      .data;
    expect(body.expired_attempts).toBe(1);
    expect(body.closed_at).not.toBeNull();

    const { data: attemptRow } = await service
      .from('quiz_attempts')
      .select('expired_at, completed_at')
      .eq('id', attempt.id)
      .single();
    const row = asJson<{ expired_at: string | null; completed_at: string | null }>(attemptRow);
    expect(row.expired_at, 'the in-progress attempt expired').not.toBeNull();
    expect(row.completed_at, 'it was not submitted').toBeNull();

    // Review unlocks for the cohort, and the expired attempt counts as consumed.
    const after = await detail();
    expect(after.review_unlocked).toBe(true);
    expect(after.attempts_used).toBe(1);
    expect(after.attempt?.expired_at).not.toBeNull();

    // The reservation ended with the close, so the item is practiceable again (R2).
    expect(await studentQuestion()).toBe(200);
  });

  it('is idempotent: a second close is ASSESSMENT_CLOSED and moves nothing', async () => {
    const first = await closedAt();
    const response = await close();
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ASSESSMENT_CLOSED');
    expect(await closedAt()).toBe(first);
  });

  it('refuses starting after the close without hiding the run (R7/R19)', async () => {
    const response = await start();
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ATTEMPTS_CLOSED');
  });

  it('refuses submitting an attempt that the close expired (R7/R19)', async () => {
    const { data: attemptRow } = await service
      .from('quiz_attempts')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('user_id', student.user.id)
      .single();
    const attemptId = asJson<{ id: string }>(attemptRow).id;

    as(student.user);
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
    const response = await attemptSubmit(request, { params });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ATTEMPT_EXPIRED');
  });

  it('refuses an autosave into an expired attempt (R7/R19)', async () => {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${expiredAttemptId}/answers`,
      { attemptId: expiredAttemptId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: [{ questionId, selectedAnswerId: crypto.randomUUID() }],
        }),
      },
      {},
    );
    const response = await attemptSaveAnswers(request, { params });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ATTEMPT_EXPIRED');

    const { data: attemptRow } = await service
      .from('quiz_attempts')
      .select('draft_answers')
      .eq('id', expiredAttemptId)
      .single();
    expect(
      asJson<{ draft_answers: Record<string, unknown> }>(attemptRow).draft_answers,
      'a refused autosave writes nothing',
    ).toEqual({});
  });

  it('keeps closed_at durable when the deadline moves (R12)', async () => {
    const first = await closedAt();
    // The edit path a teacher still has today (#1191): moving the deadline must not reopen it.
    await service.from('teacher_assignments').update({ deadline: FUTURE() }).eq('id', assignmentId);

    expect(await closedAt(), 'the close is not rewritten by a later clock edit').toBe(first);
    expect((await detail()).review_unlocked).toBe(true);
    const restarted = await start();
    expect(restarted.status, 'a moved deadline does not reopen attempts').toBe(409);
    expect(await errorOf(restarted)).toBe('ATTEMPTS_CLOSED');
  });

  it('refuses to clear a closed run at the database boundary (R12)', async () => {
    const { error } = await service
      .from('teacher_assignments')
      .update({ closed_at: null })
      .eq('id', assignmentId);
    expect(error?.code, 'the once-only trigger refuses a reopen').toBe('23514');
    expect(await closedAt()).not.toBeNull();
  });
});

describe('Natural expiry and close preconditions (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let questionId!: string;
  let assignmentId!: string;
  let naturalAttemptId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function detail(): Promise<StudentDetail> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      {},
    );
    const response = await assignmentGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: StudentDetail }>(response)).data;
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

  async function closeAsTeacher(): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    return closePost(request, { params });
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, questions: 1 });
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

    questionId = requiredAt(teacher.created.questions, 0, 'the seeded question');
    mockUser(teacher.user);
    const createRequest = createNextRequest(
      'http://localhost/api/v1/teacher/assignments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `natural-${Date.now()}`, deadline: FUTURE() }),
      },
      cookie(),
    );
    const createdResponse = await createAssignmentPost(createRequest);
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
        body: JSON.stringify({ studentIds: [student.user.id] }),
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

  it('refuses closing a run that never opened (R19)', async () => {
    await service
      .from('teacher_assignments')
      .update({ start_time: FUTURE() })
      .eq('id', assignmentId);
    const response = await closeAsTeacher();
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ASSESSMENT_NOT_LIVE');
    await service.from('teacher_assignments').update({ start_time: null }).eq('id', assignmentId);
  });

  it('records the natural expiry as a durable closed_at, and refuses the late submit (R7/R12)', async () => {
    // A running attempt must be expired by the natural close too, not only by the explicit one.
    const started = await start();
    expect(started.status, await started.clone().text()).toBe(200);
    const attemptId = (await json<{ data: AttemptPayload }>(started)).data.id;
    naturalAttemptId = attemptId;

    const deadline = PAST();
    await service.from('teacher_assignments').update({ deadline }).eq('id', assignmentId);

    // This submit is the first write after the deadline: it must settle the close itself and then
    // refuse the attempt it just expired.
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
    const late = await attemptSubmit(request, { params });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe('ATTEMPT_EXPIRED');

    const closed = await detail();
    expect(closed.review_unlocked).toBe(true);

    const { data: assignmentRow } = await service
      .from('teacher_assignments')
      .select('closed_at')
      .eq('id', assignmentId)
      .single();
    expect(
      new Date(asJson<{ closed_at: string }>(assignmentRow).closed_at).toISOString(),
      'the close is recorded at the deadline',
    ).toBe(new Date(deadline).toISOString());

    const { data: attemptRow } = await service
      .from('quiz_attempts')
      .select('expired_at, completed_at')
      .eq('id', attemptId)
      .single();
    const row = asJson<{ expired_at: string | null; completed_at: string | null }>(attemptRow);
    expect(row.expired_at, 'the late submit did not complete the attempt').not.toBeNull();
    expect(row.completed_at).toBeNull();
  });

  it('refuses resuming an expired attempt through the take route (R7)', async () => {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${naturalAttemptId}`,
      { attemptId: naturalAttemptId },
      {},
      {},
    );
    const response = await attemptGet(request, { params });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ATTEMPT_EXPIRED');
  });

  it('stays closed after the deadline moves back into the future (R12)', async () => {
    await service.from('teacher_assignments').update({ deadline: FUTURE() }).eq('id', assignmentId);

    const started = await start();
    expect(started.status).toBe(409);
    expect(await errorOf(started)).toBe('ATTEMPTS_CLOSED');
  });

  it('refuses closing a draft (R19)', async () => {
    const draft = await before({ role: 'educator', org: true, questions: 1 });
    if (!draft.orgId) throw new Error('the draft fixture has no organisation');
    mockUser(draft.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `draft-${Date.now()}` }),
        },
        { active_org_id: draft.orgId },
      ),
    );
    const draftId = (await json<{ data: { id: string } }>(created)).data.id;

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${draftId}/close`,
      { id: draftId },
      { method: 'POST' },
      { active_org_id: draft.orgId },
    );
    const response = await closePost(request, { params });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ASSESSMENT_NOT_PUBLISHED');

    await cleanupTeacherAssignments(draft.user.id);
    await cleanupQuestions(draft.user.id, 'seed-question-');
    await cleanupOrganizationDeep(draft.orgId);
  });
});
