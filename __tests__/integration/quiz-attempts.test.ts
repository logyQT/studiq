import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as attemptsGet } from '@/app/(backend)/api/v1/quiz/attempts/route';
import { POST as quizPost } from '@/app/(backend)/api/v1/quiz/new/route';
import {
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupSubjects,
  createServiceClient,
  mockUser,
  seedQuestion,
  TEST_USERS,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

describe('Quiz Attempts Integration', () => {
  let attemptId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupQuizAttempts(user.id);
      await cleanupQuestions(user.id, 'qa-');
      await cleanupSubjects(user.id, 'quiz-attempt-');
    }

    const supabase = createServiceClient();

    for (let i = 0; i < 3; i++) {
      const question = await seedQuestion({
        type: 'mcq',
        content: `qa-Question ${i}`,
        created_by: TEST_USERS.STUDENT.id,
      });

      await supabase.from('question_answers').insert({
        question_id: question.id,
        content: 'Correct Answer',
        is_correct: true,
        order_index: 0,
      });
    }

    mockUser(TEST_USERS.STUDENT);
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

  describe('GET /api/v1/quiz/attempts', () => {
    it('lists attempts for user', async () => {
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.STUDENT3);

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
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.STUDENT);

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
