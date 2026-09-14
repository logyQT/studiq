import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as attemptsGet } from '@/app/(backend)/api/v1/quiz/attempts/route';
import { POST as quizPost } from '@/app/(backend)/api/v1/quiz/new/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupQuestions,
  cleanupQuizAttempts,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

forEachCopy((copyId) => {
  describe(`Quiz Attempts Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let student!: BeforeResult;
    let other!: TestUserFixture;
    let attemptId: string;

    beforeAll(async () => {
      // Fresh student + 3 personal mcq questions (with answers) via the API.
      student = await before({ role: 'student', questions: 3 });
      // Another student for cross-user 404 checks.
      other = await createTestUser({ role: 'student' });
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      await cleanupQuizAttempts(student.user.id);

      mockUser(student.user);
      const quizReq = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 3,
        }),
      });
      const quizRes = await quizPost(quizReq);
      const quizBody = await quizRes.json();
      if (!quizBody.data?.id) throw new Error(`Failed to create quiz: ${JSON.stringify(quizBody)}`);
      attemptId = quizBody.data.id;
    });

    afterAll(async () => {
      await cleanupQuizAttempts(student.user.id);
      await cleanupQuestions(student.user.id, 'seed-question-');
    });

    describe('GET /api/v1/quiz/attempts', () => {
      it('lists attempts for user', async () => {
        mockUser(student.user);

        const req = createNextRequest('http://localhost/api/v1/quiz/attempts');
        const response = await attemptsGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBeGreaterThanOrEqual(1);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/quiz/attempts');
        const response = await attemptsGet(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/quiz/:attemptId', () => {
      it('returns attempt details with questions and answers', async () => {
        mockUser(student.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
        );
        const response = await attemptGet(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.id).toBe(attemptId);
        expect(body.data.questions).toBeDefined();
      });

      it('returns 404 for another user attempt', async () => {
        mockUser(other);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
        );
        const response = await attemptGet(request, { params });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
      });
    });

    describe('POST /api/v1/quiz/:attemptId', () => {
      it('submits attempt and returns score', async () => {
        mockUser(student.user);

        const supabase = createServiceClient();
        const { data: attemptQuestions } = await supabase
          .from('quiz_attempt_questions')
          .select('question_id')
          .eq('attempt_id', attemptId);

        const { data: answers } = await supabase
          .from('question_options')
          .select('id, question_id, is_correct')
          .in(
            'question_id',
            attemptQuestions!.map((q) => q.question_id),
          );

        const submittedAnswers = answers!.map((a) => ({
          questionId: a.question_id,
          selectedAnswerId: a.id,
        }));

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: submittedAnswers }),
          },
        );
        const response = await attemptPost(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.score).toBeDefined();
      });

      it('returns 400 when submitting already completed attempt', async () => {
        mockUser(student.user);

        const supabase = createServiceClient();
        const { data: attemptQuestions } = await supabase
          .from('quiz_attempt_questions')
          .select('question_id')
          .eq('attempt_id', attemptId);

        const { data: answers } = await supabase
          .from('question_options')
          .select('id, question_id')
          .in(
            'question_id',
            attemptQuestions!.map((q) => q.question_id),
          );

        const submittedAnswers = answers!.map((a) => ({
          questionId: a.question_id,
          selectedAnswerId: a.id,
        }));

        const submitReq = createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: submittedAnswers }),
        });
        await attemptPost(submitReq, { params: Promise.resolve({ attemptId }) });

        const resubmitReq = createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: submittedAnswers }),
        });
        const response = await attemptPost(resubmitReq, { params: Promise.resolve({ attemptId }) });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.success).toBe(false);
      });

      it('returns 404 for nonexistent attempt', async () => {
        mockUser(student.user);

        const fakeId = '00000000-0000-4000-8000-000000000099';
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${fakeId}`,
          { attemptId: fakeId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: [] }),
          },
        );
        const response = await attemptPost(request, { params });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
      });

      it('returns 422 when answers have invalid questionId', async () => {
        mockUser(student.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: [{ questionId: 'not-a-uuid' }] }),
          },
        );
        const response = await attemptPost(request, { params });
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: [] }),
          },
        );
        const response = await attemptPost(request, { params });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });
  });
});
