import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BeforeResult,
  before,
  type TestUserFixture,
  createTestUser,
} from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { PUT as questionPut } from '@/app/(backend)/api/v1/questions/[id]/route';
import { POST as randomizePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/randomize/route';
import {
  GET as quizListGet,
  POST as quizCreatePost,
} from '@/app/(backend)/api/v1/teacher/quizzes/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/**
 * #148 — org-scoped services must not put `activeOrgId === null` into a PostgREST filter.
 *
 * Every request here runs **without** an `active_org_id` cookie (`withAuth` therefore leaves
 * `ctx.activeOrgId` null). Before the fix the `uuid` filter received the literal string `null`,
 * Postgres answered `22P02` and `toDbFailure` turned it into a 500 `INTERNAL_SERVER`.
 */
describe(`No active org guards`, () => {
  const service = createServiceClient();

  let noOrgEducator!: BeforeResult;
  let noOrgStudent!: BeforeResult;
  let noOrgManager!: TestUserFixture;
  let orgEducator!: BeforeResult;
  let otherUser!: TestUserFixture;

  beforeAll(async () => {
    // No `org: true` → no organization, so no `active_org_id` cookie on any request below.
    noOrgEducator = await before({ role: 'educator', questions: 1, assignment: true });
    noOrgStudent = await before({ role: 'student', questions: 1 });
    noOrgManager = await createTestUser({ role: 'manager' });
    // Org member: its seeded question carries a non-null organization_id, which pins the
    // `own` scope semantics when the same user calls the API without an active-org cookie.
    orgEducator = await before({
      role: 'educator',
      org: `no-org-guards-${suiteId}`,
      questions: 1,
    });
    otherUser = await createTestUser({ role: 'student' });
  });

  afterAll(async () => {
    await cleanupQuestions(noOrgEducator.user.id);
    await cleanupQuestions(noOrgStudent.user.id);
    await cleanupQuestions(orgEducator.user.id);
    await cleanupTeacherAssignments(noOrgEducator.user.id);
    if (orgEducator.orgId) await cleanupOrganizationDeep(orgEducator.orgId);

    for (const user of [
      noOrgEducator.user,
      noOrgStudent.user,
      noOrgManager,
      orgEducator.user,
      otherUser,
    ]) {
      if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('GET /api/v1/teacher/quizzes returns 403 (not 500) for a manager without an active org', async () => {
    mockUser(noOrgManager);

    const res = await quizListGet(
      createNextRequest('http://localhost/api/v1/teacher/quizzes', { method: 'GET' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(res.headers.get('x-error-code')).toBe('FORBIDDEN');
  });

  it('POST /api/v1/teacher/quizzes returns 403 (not 400/500) without an active org', async () => {
    mockUser(noOrgEducator.user);

    const req = createNextRequest('http://localhost/api/v1/teacher/quizzes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `no-org-quiz-${suiteId}` }),
    });
    const res = await quizCreatePost(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(res.headers.get('x-error-code')).toBe('FORBIDDEN');
  });

  it('PUT /api/v1/questions/{id} updates a personal (null-org) question', async () => {
    mockUser(noOrgStudent.user);
    const questionId = noOrgStudent.created.questions[0];
    const content = `no-org-question-updated-${suiteId}`;

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
    );
    const res = await questionPut(request, { params });

    expect(res.status).toBe(200);
    if (res.status !== 200) return;

    const { data } = await service
      .from('questions')
      .select('content, organization_id')
      .eq('id', questionId)
      .single();
    expect(data?.content).toBe(content);
    expect(data?.organization_id).toBeNull();
  });

  it('PUT /api/v1/questions/{id} updates the caller own org question without an active org', async () => {
    mockUser(orgEducator.user);
    const questionId = orgEducator.created.questions[0];
    const content = `own-org-question-updated-${suiteId}`;

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
    );
    const res = await questionPut(request, { params });

    // No active org drops only the tenant filter: ownership (created_by) is still the gate,
    // matching accessibleFilter's `own` scope, so the caller keeps access to their own row.
    expect(res.status).toBe(200);
    if (res.status !== 200) return;

    const { data } = await service
      .from('questions')
      .select('content, organization_id')
      .eq('id', questionId)
      .single();
    expect(data?.content).toBe(content);
    expect(data?.organization_id).toBe(orgEducator.orgId);
  });

  it('PUT /api/v1/questions/{id} returns 403 (not 500) for a question the caller does not own', async () => {
    mockUser(otherUser);

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${noOrgStudent.created.questions[0]}`,
      { id: noOrgStudent.created.questions[0] },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `nope-${suiteId}` }),
      },
    );
    const res = await questionPut(request, { params });

    expect(res.status).toBe(403);
    if (res.status !== 403) return;

    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(res.headers.get('x-error-code')).toBe('FORBIDDEN');
  });

  it('POST /api/v1/teacher/assignments/{id}/randomize draws from the caller own questions', async () => {
    mockUser(noOrgEducator.user);
    const assignmentId = noOrgEducator.created.assignmentId as string;
    expect(assignmentId).toBeTruthy();

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/randomize`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'all', count: 5 }),
      },
    );
    const res = await randomizePost(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ added: 1 });
  });
});
