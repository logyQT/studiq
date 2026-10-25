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
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { GET as assignmentsList } from '@/app/(backend)/api/v1/assignments/route';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as studentStatsGet } from '@/app/(backend)/api/v1/stats/student/route';
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

    async function setMaxAttempts(maxAttempts: number): Promise<void> {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from('teacher_assignments')
        .update({ max_attempts: maxAttempts })
        .eq('id', assignmentId);
      if (error) throw new Error(`Failed to update max_attempts: ${error.message}`);
    }

    async function setShowResults(showResults: boolean): Promise<void> {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from('teacher_assignments')
        .update({ show_results: showResults })
        .eq('id', assignmentId);
      if (error) throw new Error(`Failed to update show_results: ${error.message}`);
    }

    async function submitAttempt(attemptBody: any): Promise<any> {
      const attemptId = attemptBody.data.id as string;
      const [firstQuestion] = attemptBody.data.questions as Array<{
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
      return submitRes.json();
    }

    async function detail(): Promise<{ status: number; body: any }> {
      mockUser(student.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/assignments/${assignmentId}`,
        { id: assignmentId },
      );
      const response = await assignmentGet(request, { params });
      return { status: response.status, body: await response.json() };
    }

    async function listRow(): Promise<any> {
      mockUser(student.user);
      const request = createNextRequest('http://localhost/api/v1/assignments');
      const response = await assignmentsList(request);
      const body = await response.json();
      expect(response.status).toBe(200);
      return (body.data as any[]).find((row) => row.id === assignmentId);
    }

    async function review(attemptId: string): Promise<{ status: number; body: any }> {
      mockUser(student.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
      );
      const response = await attemptGet(request, { params });
      return { status: response.status, body: await response.json() };
    }

    async function studentStats(): Promise<any> {
      mockUser(student.user);
      const response = await studentStatsGet(
        createNextRequest('http://localhost/api/v1/stats/student'),
      );
      expect(response.status).toBe(200);
      return (await response.json()).data;
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
      // Keep the #369 cases (max_attempts = 1) independent of the retake cases
      // below, which raise the budget on the shared seeded assignment.
      await setMaxAttempts(1);
      // The seed default is `false`; pin it so the #374 cases stay isolated.
      await setShowResults(false);
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

    it('exposes the remaining budget after the first of two attempts (#372)', async () => {
      await setMaxAttempts(2);
      mockUser(student.user);

      const started = await startAs(student.user);
      expect(started.status).toBe(200);
      const attempt1 = started.body.data.id as string;

      await submitAttempt(started.body);

      const detailResult = await detail();
      expect(detailResult.status).toBe(200);
      expect(detailResult.body.data.max_attempts).toBe(2);
      expect(detailResult.body.data.attempts_used).toBe(1);
      expect(detailResult.body.data.attempt.id).toBe(attempt1);
      expect(detailResult.body.data.attempt.completed_at).not.toBeNull();
      expect(detailResult.body.data.last_completed_attempt.id).toBe(attempt1);
      expect(detailResult.body.data.attempt).not.toHaveProperty('draft_answers');

      const row = await listRow();
      expect(row).toBeDefined();
      expect(row.max_attempts).toBe(2);
      expect(row.attempts_used).toBe(1);
      expect(row.last_completed_attempt.id).toBe(attempt1);
    });

    it('the detail last completed attempt resolves to the review payload (#175)', async () => {
      await setMaxAttempts(2);
      // The review payload is only served when the teacher shares results.
      await setShowResults(true);
      mockUser(student.user);

      const started = await startAs(student.user);
      expect(started.status).toBe(200);
      const submittedAttemptId = started.body.data.id as string;
      await submitAttempt(started.body);

      // The review page without ?attemptId falls back to this row.
      const detailResult = await detail();
      expect(detailResult.status).toBe(200);
      expect(detailResult.body.data.last_completed_attempt.id).toBe(submittedAttemptId);

      mockUser(student.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${submittedAttemptId}`,
        { attemptId: submittedAttemptId },
      );
      const response = await attemptGet(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.assignment_id).toBe(assignmentId);
      expect(body.data.completed_at).not.toBeNull();
      expect(body.data.questions).toHaveLength(2);
      expect(Object.keys(body.data.answers).length).toBeGreaterThan(0);
      for (const question of body.data.questions) {
        expect(question.question_answers.length).toBeGreaterThan(0);
        for (const option of question.question_answers) {
          expect(typeof option.is_correct).toBe('boolean');
        }
      }
    });

    it('starts the second attempt once the first is submitted (#372)', async () => {
      await setMaxAttempts(2);
      mockUser(student.user);

      const started1 = await startAs(student.user);
      const attempt1 = started1.body.data.id as string;
      await submitAttempt(started1.body);

      const started2 = await startAs(student.user);
      expect(started2.status).toBe(200);
      const attempt2 = started2.body.data.id as string;
      expect(attempt2).not.toBe(attempt1);
      expect(await openAttemptCount()).toBe(1);

      const detailResult = await detail();
      expect(detailResult.status).toBe(200);
      expect(detailResult.body.data.attempts_used).toBe(1);
      expect(detailResult.body.data.attempt.id).toBe(attempt2);
      expect(detailResult.body.data.attempt.completed_at).toBeNull();
      expect(detailResult.body.data.last_completed_attempt.id).toBe(attempt1);
    });

    it('refuses another start once max_attempts is exhausted (#372)', async () => {
      await setMaxAttempts(2);
      mockUser(student.user);

      const started1 = await startAs(student.user);
      await submitAttempt(started1.body);
      const started2 = await startAs(student.user);
      await submitAttempt(started2.body);

      const start3 = await startAs(student.user);
      expect(start3.status).toBe(429);
      expect(await openAttemptCount()).toBe(0);

      const detailResult = await detail();
      expect(detailResult.status).toBe(200);
      expect(detailResult.body.data.attempts_used).toBe(2);
      expect(detailResult.body.data.attempt.id).toBe(started2.body.data.id);
      expect(detailResult.body.data.attempt.completed_at).not.toBeNull();
      expect(detailResult.body.data.last_completed_attempt.id).toBe(started2.body.data.id);

      const row = await listRow();
      expect(row.attempts_used).toBe(2);
    });

    it('hides the score, review and stats while show_results is off (#374)', async () => {
      await setShowResults(false);
      mockUser(student.user);

      const started = await startAs(student.user);
      expect(started.status).toBe(200);
      const attemptId = started.body.data.id as string;

      const submitted = await submitAttempt(started.body);
      expect(submitted.data.score).toBeNull();

      const detailResult = await detail();
      expect(detailResult.status).toBe(200);
      expect(detailResult.body.data.show_results).toBe(false);
      // Completion metadata stays, only the result is withheld.
      expect(detailResult.body.data.last_completed_attempt.id).toBe(attemptId);
      expect(detailResult.body.data.last_completed_attempt.score).toBeNull();

      const row = await listRow();
      expect(row.last_completed_attempt.id).toBe(attemptId);
      expect(row.last_completed_attempt.score).toBeNull();

      const hiddenReview = await review(attemptId);
      expect(hiddenReview.status).toBe(403);

      const stats = await studentStats();
      expect(stats.totalQuizzes).toBe(1);
      expect(stats.avgScore).toBe(0);
      expect(stats.bestScore).toBe(0);
      expect(stats.attemptsOverTime).toEqual([]);
    });

    it('reveals the score and review once show_results is on (#374)', async () => {
      await setShowResults(false);
      mockUser(student.user);

      const started = await startAs(student.user);
      const attemptId = started.body.data.id as string;
      await submitAttempt(started.body);

      await setShowResults(true);

      const detailResult = await detail();
      expect(detailResult.status).toBe(200);
      expect(detailResult.body.data.show_results).toBe(true);
      expect(typeof detailResult.body.data.last_completed_attempt.score).toBe('number');

      const visibleReview = await review(attemptId);
      expect(visibleReview.status).toBe(200);
      expect(visibleReview.body.data.assignment_id).toBe(assignmentId);
      expect(visibleReview.body.data.completed_at).not.toBeNull();

      const stats = await studentStats();
      expect(stats.totalQuizzes).toBe(1);
      expect(stats.attemptsOverTime).toHaveLength(1);
    });
  });
});
