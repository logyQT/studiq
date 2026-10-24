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
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as attemptsGet } from '@/app/(backend)/api/v1/quiz/attempts/route';
import { POST as quizPost } from '@/app/(backend)/api/v1/quiz/new/route';

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

      it('never returns the answer key while the attempt is in progress (#331)', async () => {
        mockUser(student.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
        );
        const response = await attemptGet(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.completed_at).toBeNull();
        expect(body.data.questions.length).toBeGreaterThan(0);
        expect(body.data.answers).toEqual({});

        for (const question of body.data.questions) {
          expect(question).not.toHaveProperty('explanation');
          expect(question).not.toHaveProperty('search_vector');
          expect(question.question_answers.length).toBeGreaterThan(0);
          for (const option of question.question_answers) {
            expect(option).not.toHaveProperty('is_correct');
            expect(option.content).toBeDefined();
          }
        }
      });

      it('reveals the answer key once the attempt is submitted (#331)', async () => {
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

        const { request: submitRequest, params: submitParams } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: submittedAnswers }),
          },
        );
        const submitResponse = await attemptPost(submitRequest, { params: submitParams });
        expect(submitResponse.status).toBe(200);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/quiz/${attemptId}`,
          { attemptId },
        );
        const response = await attemptGet(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.completed_at).not.toBeNull();
        for (const question of body.data.questions) {
          expect(question).toHaveProperty('explanation');
          for (const option of question.question_answers) {
            expect(typeof option.is_correct).toBe('boolean');
          }
        }
        for (const answer of Object.values(body.data.answers) as Array<Record<string, unknown>>) {
          expect(typeof answer.is_correct).toBe('boolean');
        }
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

      it('persists an open answer as text and submits (#176)', async () => {
        mockUser(student.user);

        const supabase = createServiceClient();
        const { data: bank } = await supabase
          .from('question_banks')
          .select('id')
          .eq('created_by', student.user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!bank) throw new Error('seed question bank not found');

        const { data: openQuestion, error: openQuestionError } = await supabase
          .from('questions')
          .insert({
            bank_id: bank.id,
            created_by: student.user.id,
            type: 'open',
            content: 'seed-question-open-176',
            explanation: 'Rozbiory, słaba władza centralna, liberum veto.',
          })
          .select('id')
          .single();
        if (openQuestionError || !openQuestion) {
          throw new Error(`Failed to seed open question: ${openQuestionError?.message}`);
        }

        await supabase.from('quiz_attempt_questions').insert({
          attempt_id: attemptId,
          question_id: openQuestion.id,
          order_index: 3,
        });

        const { data: attemptQuestions } = await supabase
          .from('quiz_attempt_questions')
          .select('question_id')
          .eq('attempt_id', attemptId)
          .neq('question_id', openQuestion.id);

        const { data: options } = await supabase
          .from('question_options')
          .select('id, question_id')
          .in(
            'question_id',
            attemptQuestions!.map((q) => q.question_id),
          );

        const textAnswer = 'Rozbiory, słaba władza centralna, liberum veto.';
        const submittedAnswers = [
          ...options!.map((a) => ({ questionId: a.question_id, selectedAnswerId: a.id })),
          { questionId: openQuestion.id, textAnswer },
        ];

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

        const { data: storedAnswer } = await supabase
          .from('student_answers')
          .select('text_answer, selected_option_id, question_type, is_correct')
          .eq('attempt_id', attemptId)
          .eq('question_id', openQuestion.id)
          .single();

        expect(storedAnswer?.text_answer).toBe(textAnswer);
        expect(storedAnswer?.selected_option_id).toBeNull();
        expect(storedAnswer?.question_type).toBe('open');
        expect(storedAnswer?.is_correct).toBe(false);

        const { data: attempt } = await supabase
          .from('quiz_attempts')
          .select('completed_at')
          .eq('id', attemptId)
          .single();
        expect(attempt?.completed_at).not.toBeNull();
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
