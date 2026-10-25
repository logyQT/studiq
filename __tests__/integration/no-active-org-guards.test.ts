import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  type TestUserFixture,
  createTestUser,
} from '#test/helpers/test-user';
import {
  cleanupQuestions,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { PUT as questionPut } from '@/app/(backend)/api/v1/questions/[id]/route';
import { POST as randomizePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/randomize/route';
import { POST as quizCreatePost } from '@/app/(backend)/api/v1/teacher/quizzes/route';

/**
 * #148 — org-scoped services must not put `activeOrgId === null` into a PostgREST filter.
 *
 * Every request here runs **without** an `active_org_id` cookie (`withAuth` therefore leaves
 * `ctx.activeOrgId` null). Before the fix the `uuid` filter received the literal string `null`,
 * Postgres answered `22P02` and `toDbFailure` turned it into a 500 `INTERNAL_SERVER`.
 */
forEachCopy((copyId) => {
  describe(`No active org guards [${copyId}]`, () => {
    registerMock(copyId, null);

    let noOrgEducator!: BeforeResult;
    let noOrgStudent!: BeforeResult;
    let otherUser!: TestUserFixture;

    beforeAll(async () => {
      // No `org: true` → no organization, so no `active_org_id` cookie on any request below.
      noOrgEducator = await before({ role: 'educator', questions: 1, assignment: true });
      noOrgStudent = await before({ role: 'student', questions: 1 });
      otherUser = await createTestUser({ role: 'student' });
    });

    afterAll(async () => {
      await cleanupQuestions(noOrgEducator.user.id);
      await cleanupQuestions(noOrgStudent.user.id);
      await cleanupTeacherAssignments(noOrgEducator.user.id);
    });

    it('POST /api/v1/teacher/quizzes returns 403 (not 400/500) without an active org', async () => {
      mockUser(noOrgEducator.user);

      const req = createNextRequest('http://localhost/api/v1/teacher/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `no-org-quiz-${copyId}` }),
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
      const content = `no-org-question-updated-${copyId}`;

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

      const service = createServiceClient();
      const { data } = await service
        .from('questions')
        .select('content, organization_id')
        .eq('id', questionId)
        .single();
      expect(data?.content).toBe(content);
      expect(data?.organization_id).toBeNull();
    });

    it('PUT /api/v1/questions/{id} returns 403 (not 500) for a question the caller does not own', async () => {
      mockUser(otherUser);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${noOrgStudent.created.questions[0]}`,
        { id: noOrgStudent.created.questions[0] },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `nope-${copyId}` }),
        },
      );
      const res = await questionPut(request, { params });

      expect(res.status).toBe(403);
      if (res.status !== 403) return;

      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
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
});
