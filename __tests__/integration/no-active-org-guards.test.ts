import { AccountType, type RequestContext } from '@studiq/authz';
import { CreateQuizSchema } from '@studiq/server/models/quiz.model';
import { CreateTeacherAssignmentSchema } from '@studiq/server/models/teacher-assignment.model';
import { quizTeacherService } from '@studiq/server/services/quiz-teacher.service';
import { teacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import { createSeedDb } from '#test/helpers/tenant-seed';
import {
  type BeforeResult,
  before,
  type TestUserFixture,
  createTestUser,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupTeacherAssignments,
  mockUser,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { POST as deckCreatePost } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { PUT as questionPut } from '@/app/(backend)/api/v1/questions/[id]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as randomizePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/randomize/route';
import {
  GET as quizListGet,
  POST as quizCreatePost,
} from '@/app/(backend)/api/v1/teacher/quizzes/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/** Forbidden envelope returned by the guards under test. */
type ForbiddenBody = { success: boolean; error?: string };

/** `POST /teacher/assignments/:id/randomize` payload — the field read below. */
type RandomizeBody = { data: { added: number } };

/**
 * #148 — org-scoped services must not put `activeOrgId === null` into a PostgREST filter.
 *
 * Every request here runs **without** an `active_org_id` cookie (`withAuth` therefore leaves
 * `ctx.activeOrgId` null). Before the fix the `uuid` filter received the literal string `null`,
 * Postgres answered `22P02` and `toDbFailure` turned it into a 500 `INTERNAL_SERVER`.
 */
describe(`No active org guards`, () => {
  const service = createSeedDb();

  let noOrgEducator!: BeforeResult;
  let noOrgStudent!: BeforeResult;
  let noOrgManager!: TestUserFixture;
  let orgEducator!: BeforeResult;
  let otherUser!: TestUserFixture;

  beforeAll(async () => {
    // No `org: true` → no organization, so no `active_org_id` cookie on any request below.
    noOrgEducator = await before({ role: 'educator', questions: 1 });
    // 5e-1 refuses assignment creation without an active org (pinned below), so the
    // randomize fixture is seeded in the legacy personal shape (organization_id NULL)
    // through the service role, which bypasses the INSERT policy a real caller hits.
    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: null,
        created_by: noOrgEducator.user.id,
        title: `no-org-assignment-${suiteId}`,
        status: 'draft',
      })
      .select('id')
      .single();
    if (assignmentError) {
      throw new Error(`Failed to seed the null-org assignment: ${assignmentError.message}`);
    }
    noOrgEducator.created.assignmentId = assignment.id;
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
    await cleanupFlashcardDecks(noOrgManager.id);
    await cleanupTeacherAssignments(noOrgEducator.user.id);
    if (orgEducator.orgId) await cleanupOrganizationDeep(orgEducator.orgId);

    for (const user of [
      noOrgEducator.user,
      noOrgStudent.user,
      noOrgManager,
      orgEducator.user,
      otherUser,
    ]) {
      await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('GET /api/v1/teacher/quizzes returns 403 (not 500) for a manager without an active org', async () => {
    mockUser(noOrgManager);

    const res = await quizListGet(
      createNextRequest('http://localhost/api/v1/teacher/quizzes', { method: 'GET' }),
    );
    const body = await json<ForbiddenBody>(res);

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
    const body = await json<ForbiddenBody>(res);

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(res.headers.get('x-error-code')).toBe('FORBIDDEN');
  });

  it('POST /api/v1/teacher/assignments returns 403 (not 400/500) without an active org', async () => {
    mockUser(noOrgEducator.user);

    const req = createNextRequest('http://localhost/api/v1/teacher/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `no-org-assignment-create-${suiteId}` }),
    });
    const res = await createAssignmentPost(req);
    const body = await json<ForbiddenBody>(res);

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(res.headers.get('x-error-code')).toBe('FORBIDDEN');
  });

  // D35 (register row 3): persona decides nothing, so a manager with no org
  // resolves the personal-content set like a student does. Served through the
  // real route so the context under test is withAuth's (no `active_org_id`
  // cookie), not a hand-built one.
  //
  // A manager holds no personal plan (ADR-0007), so the route authorizes the
  // call and then refuses it at the zero quota: 429, never 403.
  it('authorizes a manager with no active org on the content route and refuses at the zero quota', async () => {
    mockUser(noOrgManager);
    const name = `no-org-manager-deck-${suiteId}`;

    const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const res = await deckCreatePost(req);
    const body = await json<ForbiddenBody>(res);

    expect(res.status).toBe(429);
    expect(body).toEqual({ success: false, error: 'USAGE_LIMIT_EXCEEDED' });
    expect(res.headers.get('x-error-code')).toBe('USAGE_LIMIT_EXCEEDED');

    const { data } = await service.from('flashcard_decks').select('id').eq('name', name);
    expect(data ?? []).toEqual([]);
  });

  // `quiz.*` and assignment creation stay out of the personal set because their
  // services refuse a no-org call: a context that HOLDS both keys still cannot
  // create one, so the refusal is the service's org guard, not a missing
  // permission.
  it('refuses quiz and assignment creation at the service for a no-org key holder', async () => {
    mockUser(noOrgManager);
    const ctx: RequestContext = {
      userId: noOrgManager.id,
      accountType: AccountType.MANAGER,
      traceId: 'no-org-service-probe',
      url: '',
      method: 'POST',
      activeOrgId: null,
      orgRoleId: null,
      groupIds: [],
      permissionScopes: { 'quiz.create': 'own', 'assignment.create': 'own' },
    };

    const quiz = await quizTeacherService.create(
      CreateQuizSchema.parse({ name: `no-org-service-quiz-${suiteId}` }),
      ctx,
    );
    expect(quiz).toEqual({ success: false, error: 'FORBIDDEN' });

    const assignment = await teacherAssignmentService.create(
      CreateTeacherAssignmentSchema.parse({ title: `no-org-service-assignment-${suiteId}` }),
      ctx,
    );
    expect(assignment).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('PUT /api/v1/questions/{id} updates a personal (null-org) question', async () => {
    mockUser(noOrgStudent.user);
    const questionId = requiredAt(noOrgStudent.created.questions, 0, 'seeded question');
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
    const questionId = requiredAt(orgEducator.created.questions, 0, 'seeded question');
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
      `http://localhost/api/v1/questions/${requiredAt(noOrgStudent.created.questions, 0, 'seeded question')}`,
      { id: requiredAt(noOrgStudent.created.questions, 0, 'seeded question') },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `nope-${suiteId}` }),
      },
    );
    const res = await questionPut(request, { params });

    expect(res.status).toBe(403);
    if (res.status !== 403) return;

    const body = await json<ForbiddenBody>(res);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(res.headers.get('x-error-code')).toBe('FORBIDDEN');
  });

  it('POST /api/v1/teacher/assignments/{id}/randomize draws from the caller own questions', async () => {
    mockUser(noOrgEducator.user);
    const assignmentId = noOrgEducator.created.assignmentId!;
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
    const body = await json<RandomizeBody>(res);

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ added: 1 });
  });
});
