import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequestWithParams } from '#test/integration/test-utils';
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptPost } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

forEachCopy((copyId) => {
  describe(`Assignment Attempts Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let student!: BeforeResult;
    let other!: TestUserFixture;
    let assignmentId: string;

    async function startAs(
      user: { id: string; role: string } | null,
    ): Promise<{ status: number; body: any }> {
      mockUser(user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/assignments/${assignmentId}/start`,
        { id: assignmentId },
        { method: 'POST' },
      );
      const response = await assignmentStart(request, { params });
      return { status: response.status, body: await response.json() };
    }

    async function openAttemptCount(): Promise<number> {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from('quiz_attempts')
        .select('id')
        .eq('assignment_id', assignmentId)
        .eq('user_id', student.user.id)
        .is('completed_at', null);
      if (error) throw new Error(`Failed to count open attempts: ${error.message}`);
      return (data ?? []).length;
    }

    beforeAll(async () => {
      teacher = await before({ role: 'educator', questions: 2, assignment: true });
      student = await before({ role: 'student' });
      other = await createTestUser({ role: 'student' });

      assignmentId = teacher.created.assignmentId as string;
      if (!assignmentId) throw new Error('Assignment was not seeded');

      mockUser(teacher.user);

      // Two seeded questions + the student as the only target, then publish.
      const { request: questionsReq, params: questionsParams } = createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
        { id: assignmentId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionIds: teacher.created.questions }),
        },
      );
      const questionsRes = await addQuestionsPost(questionsReq, { params: questionsParams });
      if (!questionsRes.ok) {
        throw new Error(`Failed to add questions: ${await questionsRes.text()}`);
      }

      const { request: targetsReq, params: targetsParams } = createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
        { id: assignmentId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: [student.user.id] }),
        },
      );
      const targetsRes = await targetsPut(targetsReq, { params: targetsParams });
      if (!targetsRes.ok) {
        throw new Error(`Failed to set targets: ${await targetsRes.text()}`);
      }

      const { request: publishReq, params: publishParams } = createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
        { id: assignmentId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const publishRes = await publishPost(publishReq, { params: publishParams });
      if (!publishRes.ok) {
        throw new Error(`Failed to publish: ${await publishRes.text()}`);
      }
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      await cleanupQuizAttempts(student.user.id);
      await cleanupQuizAttempts(other.id);
    });

    afterAll(async () => {
      await cleanupQuizAttempts(student.user.id);
      await cleanupQuizAttempts(other.id);
      await cleanupTeacherAssignments(teacher.user.id);
      await cleanupQuestions(teacher.user.id, 'seed-question-');
    });

    it('two rapid starts resume one unfinished attempt (#369)', async () => {
      mockUser(student.user);

      const first = await startAs(student.user);
      const second = await startAs(student.user);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.data.id).toBe(second.body.data.id);
      expect(await openAttemptCount()).toBe(1);
    });

    it('concurrent starts never produce a second open attempt (#369)', async () => {
      mockUser(student.user);

      const [first, second] = await Promise.all([startAs(student.user), startAs(student.user)]);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(first.body.data.id).toBe(second.body.data.id);
      expect(await openAttemptCount()).toBe(1);
    });

    it('resumes with the same attempt id and its question snapshot, never the answer key (#369, #331)', async () => {
      const started = await startAs(student.user);
      expect(started.status).toBe(200);

      const resumed = await startAs(student.user);
      expect(resumed.status).toBe(200);
      expect(resumed.body.data.id).toBe(started.body.data.id);
      expect(resumed.body.data.questions).toHaveLength(2);
      expect(resumed.body.data).not.toHaveProperty('draft_answers');
      for (const question of resumed.body.data.questions) {
        expect(question).not.toHaveProperty('explanation');
        expect(question).not.toHaveProperty('search_vector');
        for (const option of question.question_answers ?? []) {
          expect(option).not.toHaveProperty('is_correct');
        }
      }
    });

    it('the detail endpoint reports the running attempt after a quit (#369)', async () => {
      const started = await startAs(student.user);

      mockUser(student.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/assignments/${assignmentId}`,
        { id: assignmentId },
      );
      const response = await assignmentGet(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.attempt?.id).toBe(started.body.data.id);
      expect(body.data.attempt?.completed_at).toBeNull();
    });

    it('a submitted attempt cannot start again when max_attempts is 1 (#369)', async () => {
      const started = await startAs(student.user);
      const attemptId = started.body.data.id as string;
      const [firstQuestion] = started.body.data.questions as Array<{
        id: string;
        question_answers?: Array<{ id: string }>;
      }>;

      mockUser(student.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId,
            answers: [
              {
                questionId: firstQuestion.id,
                selectedAnswerId: firstQuestion.question_answers?.[0]?.id,
              },
            ],
          }),
        },
      );
      const submitRes = await attemptPost(request, { params });
      expect(submitRes.status).toBe(200);

      const restart = await startAs(student.user);
      expect(restart.status).toBe(429);
      expect(await openAttemptCount()).toBe(0);
    });

    it('returns 404 for a student who is not targeted (#369)', async () => {
      const result = await startAs(other);
      expect(result.status).toBe(404);
      expect(await openAttemptCount()).toBe(0);
    });
  });
});
