import type { Database } from '@studiq/server/types/database';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupQuestions,
  cleanupQuizAttempts,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
  requiredEntry,
} from '#test/integration/test-utils';
import { PUT as attemptAnswersPut } from '@/app/(backend)/api/v1/quiz/[attemptId]/answers/route';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as attemptsGet } from '@/app/(backend)/api/v1/quiz/attempts/route';
import { POST as quizPost } from '@/app/(backend)/api/v1/quiz/new/route';
import { toSaveAnswersPayload } from '@/lib/quiz-draft';

type QuizAttemptQuestionRow = Database['public']['Tables']['quiz_attempt_questions']['Row'];
/** Selected columns of `question_options` — rows these flows seed always carry a question. */
interface AttemptOptionRow {
  id: string;
  question_id: string;
}
type OpenQuestionRow = Pick<Database['public']['Tables']['questions']['Row'], 'id'>;

/** One answer per attempt question: `submit` refuses a repeated question id (#1065). */
function oneAnswerPerQuestion(options: AttemptOptionRow[]): {
  questionId: string;
  selectedAnswerId: string;
}[] {
  const firstOptionByQuestion = new Map<string, string>();
  for (const option of options) {
    if (!firstOptionByQuestion.has(option.question_id)) {
      firstOptionByQuestion.set(option.question_id, option.id);
    }
  }
  return [...firstOptionByQuestion].map(([questionId, selectedAnswerId]) => ({
    questionId,
    selectedAnswerId,
  }));
}

/** Fields of `GET /api/v1/quiz/[attemptId]` the assertions below read. */
interface QuizAnswerPayload {
  is_correct?: boolean;
  selected_answer_id?: string | null;
  text_answer?: string | null;
  teacher_points?: number | null;
  teacher_feedback?: string | null;
}

interface QuizQuestionPayload {
  explanation?: string | null;
  question_answers: { content?: string | null; is_correct?: boolean }[];
}

interface QuizAttemptPayload {
  id: string;
  completed_at: string | null;
  questions: QuizQuestionPayload[];
  answers: Record<string, QuizAnswerPayload>;
}

/** `GET /api/v1/quiz/[attemptId]` wraps the attempt in the API envelope. */
interface QuizAttemptDetailPayload {
  data: QuizAttemptPayload;
}

interface AttemptListPayload {
  data: {
    id: string;
    completed_at: string | null;
    score: number | null;
    total_questions: number;
    gradable_questions: number;
    assignment_id: string | null;
  }[];
}

/** Error bodies assert the envelope plus the field-level details where they matter. */
interface ApiErrorPayload {
  success: boolean;
  error?: string;
}

/** `toNextResponse` treeifies a 422's issues (see `seats.test.ts`). */
interface AnswerValueErrorPayload extends ApiErrorPayload {
  issues?: {
    properties?: {
      answers?: {
        items?: {
          properties?: Partial<Record<'selectedAnswerId' | 'textAnswer', { errors: string[] }>>;
        }[];
      };
    };
  };
}

interface QuizCreatePayload {
  data?: { id?: string };
}

interface SaveDraftPayload {
  success: boolean;
  data: { saved: number };
}

interface SubmitPayload extends ApiErrorPayload {
  data: { score: number };
}

/** The id of the option the fixtures mark correct for `questionId`. */
async function loadCorrectOptionId(questionId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data: option } = await supabase
    .from('question_options')
    .select('id')
    .eq('question_id', questionId)
    .eq('is_correct', true)
    .limit(1)
    .maybeSingle()
    .overrideTypes<{ id: string }, { merge: false }>();
  if (!option) throw new Error(`question ${questionId} has no correct option`);
  return option.id;
}

describe(`Quiz Attempts Integration`, () => {
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
    useRealSupabase();
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
    const quizBody = await json<QuizCreatePayload>(quizRes);
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
      const body = await json<AttemptListPayload>(response);

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('lists a completed attempt with the review fields', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { error: completeError } = await supabase
        .from('quiz_attempts')
        .update({ completed_at: new Date().toISOString(), score: 2 })
        .eq('id', attemptId);
      if (completeError) throw new Error(`Failed to complete attempt: ${completeError.message}`);

      const req = createNextRequest('http://localhost/api/v1/quiz/attempts');
      const response = await attemptsGet(req);
      const body = await json<AttemptListPayload>(response);

      const row = body.data.find((a: { id: string }) => a.id === attemptId);

      expect(row).toBeTruthy();
      expect(row!.completed_at).toBeTruthy();
      expect(row!.score).toBe(2);
      expect(row!.total_questions).toBe(3);
      // #329 — the history badge divides by the auto-gradable questions only.
      expect(row!.gradable_questions).toBe(3);
      expect(row!.assignment_id).toBeNull();
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/quiz/attempts');
      const response = await attemptsGet(req);
      const body = await json<ApiErrorPayload>(response);

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
      const body = await json<QuizAttemptDetailPayload>(response);

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
      const body = await json<ApiErrorPayload>(response);

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
      const body = await json<QuizAttemptDetailPayload>(response);

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
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const { data: answers } = await supabase
        .from('question_options')
        .select('id, question_id')
        .in(
          'question_id',
          attemptQuestions!.map((q) => q.question_id),
        )
        .overrideTypes<AttemptOptionRow[], { merge: false }>();

      const submittedAnswers = oneAnswerPerQuestion(answers!);

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
      const body = await json<QuizAttemptDetailPayload>(response);

      expect(response.status).toBe(200);
      expect(body.data.completed_at).not.toBeNull();
      for (const question of body.data.questions) {
        expect(question).toHaveProperty('explanation');
        for (const option of question.question_answers) {
          expect(typeof option.is_correct).toBe('boolean');
        }
      }
      for (const answer of Object.values(body.data.answers)) {
        expect(typeof answer.is_correct).toBe('boolean');
      }
    });

    it('serves the review payload the assignment review page consumes (#175)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const questionIds = (attemptQuestions ?? []).map((q) => q.question_id);

      const { data: options } = await supabase
        .from('question_options')
        .select('id, question_id')
        .in('question_id', questionIds)
        .overrideTypes<AttemptOptionRow[], { merge: false }>();

      const submitReq = createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: oneAnswerPerQuestion(options ?? []),
        }),
      });
      const submitRes = await attemptPost(submitReq, { params: Promise.resolve({ attemptId }) });
      expect(submitRes.status).toBe(200);

      // A teacher grades one answer after submission.
      const gradedQuestionId = requiredAt(questionIds, 0, 'attempt question id');
      const { error: gradeError } = await supabase
        .from('student_answers')
        .update({ teacher_points: 2, teacher_feedback: 'Dobrze, ale brakuje liberum veto.' })
        .eq('attempt_id', attemptId)
        .eq('question_id', gradedQuestionId);
      if (gradeError) throw new Error(`Failed to grade answer: ${gradeError.message}`);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
      );
      const response = await attemptGet(request, { params });
      const body = await json<QuizAttemptDetailPayload>(response);

      expect(response.status).toBe(200);
      expect(body.data.completed_at).not.toBeNull();
      expect(body.data.questions).toHaveLength(questionIds.length);
      expect(Object.keys(body.data.answers).toSorted()).toEqual([...questionIds].toSorted());
      const gradedAnswer = requiredEntry(body.data.answers, gradedQuestionId, 'graded answer');
      expect(gradedAnswer.teacher_points).toBe(2);
      expect(gradedAnswer.teacher_feedback).toBe('Dobrze, ale brakuje liberum veto.');
      for (const question of body.data.questions) {
        expect(question).toHaveProperty('question_answers');
        expect(question).toHaveProperty('explanation');
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
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const { data: answers } = await supabase
        .from('question_options')
        .select('id, question_id, is_correct')
        .in(
          'question_id',
          attemptQuestions!.map((q) => q.question_id),
        )
        .overrideTypes<AttemptOptionRow[], { merge: false }>();

      const submittedAnswers = oneAnswerPerQuestion(answers!);

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
      const body = await json<SubmitPayload>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.score).toBeDefined();
    });

    it('refuses an answer for a question outside the attempt and stores nothing (#1065)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { data: bank } = await supabase
        .from('question_banks')
        .select('id')
        .eq('created_by', student.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .overrideTypes<
          Pick<Database['public']['Tables']['question_banks']['Row'], 'id'>,
          { merge: false }
        >();
      if (!bank) throw new Error('seed question bank not found');

      const { data: outside, error: outsideError } = await supabase
        .from('questions')
        .insert({
          bank_id: bank.id,
          created_by: student.user.id,
          type: 'mcq',
          content: 'seed-question-outside-1065',
        })
        .select('id')
        .single()
        .overrideTypes<OpenQuestionRow, { merge: false }>();
      if (outsideError)
        throw new Error(`Failed to seed the outside question: ${outsideError.message}`);

      const { data: outsideOption, error: optionError } = await supabase
        .from('question_options')
        .insert({ question_id: outside.id, content: 'Tak', is_correct: true, order_index: 0 })
        .select('id')
        .single()
        .overrideTypes<{ id: string }, { merge: false }>();
      if (optionError) throw new Error(`Failed to seed the outside option: ${optionError.message}`);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: outside.id, selectedAnswerId: outsideOption.id }],
          }),
        },
      );
      const response = await attemptPost(request, { params });
      expect(response.status).toBe(422);

      const { data: stored } = await supabase
        .from('student_answers')
        .select('id')
        .eq('attempt_id', attemptId);
      expect(stored).toHaveLength(0);

      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('completed_at')
        .eq('id', attemptId)
        .single()
        .overrideTypes<{ completed_at: string | null }, { merge: false }>();
      expect(attempt?.completed_at).toBeNull();
    });

    it('refuses a payload longer than the attempt, not a fixed cap (#1065)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const { data: options } = await supabase
        .from('question_options')
        .select('id, question_id')
        .in(
          'question_id',
          (attemptQuestions ?? []).map((q) => q.question_id),
        )
        .overrideTypes<AttemptOptionRow[], { merge: false }>();

      // Every attempt question plus one stranger: four entries for a three-question
      // attempt, refused by the attempt's own size before any scoring.
      const answers = [
        ...oneAnswerPerQuestion(options ?? []),
        { questionId: crypto.randomUUID(), selectedAnswerId: crypto.randomUUID() },
      ];

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        },
      );
      const response = await attemptPost(request, { params });
      const body = await json<
        ApiErrorPayload & { issues?: { properties?: { answers?: { errors: string[] } } } }
      >(response);

      expect(response.status).toBe(422);
      expect(body.issues?.properties?.answers?.errors).toEqual(['VALIDATION_INVALID_TOO_MANY']);

      const { data: stored } = await supabase
        .from('student_answers')
        .select('id')
        .eq('attempt_id', attemptId);
      expect(stored).toHaveLength(0);
    });

    it('refuses the same answer twice in one payload (#1065)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();
      const questionId = requiredAt(attemptQuestions ?? [], 0, 'attempt question').question_id;

      const { data: options } = await supabase
        .from('question_options')
        .select('id, question_id')
        .eq('question_id', questionId)
        .overrideTypes<AttemptOptionRow[], { merge: false }>();
      const option = requiredAt(options ?? [], 0, 'attempt option');

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              { questionId, selectedAnswerId: option.id },
              { questionId, selectedAnswerId: option.id },
            ],
          }),
        },
      );
      const response = await attemptPost(request, { params });
      expect(response.status).toBe(422);

      const { data: stored } = await supabase
        .from('student_answers')
        .select('id')
        .eq('attempt_id', attemptId);
      expect(stored).toHaveLength(0);
    });

    it('refuses an option that belongs to another question and writes nothing (#1161)', async () => {
      mockUser(student.user);

      const { questionIds } = await loadAttemptAnswers();
      const answeredQuestionId = requiredAt(questionIds, 0, 'answered question');
      const otherQuestionId = requiredAt(questionIds, 1, 'other question');
      // The exploit: the other question's correct option used to be scored for
      // this one because correctness was looked up by option id alone.
      const otherCorrectOptionId = await loadCorrectOptionId(otherQuestionId);

      const { request, params } = submitSheet([
        { questionId: answeredQuestionId, selectedAnswerId: otherCorrectOptionId },
      ]);
      const response = await attemptPost(request, { params });
      const body = await json<AnswerValueErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(
        body.issues?.properties?.answers?.items?.[0]?.properties?.selectedAnswerId?.errors,
      ).toEqual(['VALIDATION_INVALID_INPUT']);
      expect(await countStudentAnswers()).toBe(0);

      const supabase = createServiceClient();
      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('completed_at, score')
        .eq('id', attemptId)
        .single()
        .overrideTypes<{ completed_at: string | null; score: number }, { merge: false }>();
      expect(attempt?.completed_at).toBeNull();
      expect(attempt?.score).toBe(0);
    });

    it('refuses free text sent for a choice question (#1161)', async () => {
      mockUser(student.user);

      const { questionIds } = await loadAttemptAnswers();
      const choiceQuestionId = requiredAt(questionIds, 0, 'choice question');

      const { request, params } = submitSheet([
        { questionId: choiceQuestionId, textAnswer: 'Wisła' },
      ]);
      const response = await attemptPost(request, { params });
      const body = await json<AnswerValueErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(body.issues?.properties?.answers?.items?.[0]?.properties?.textAnswer?.errors).toEqual([
        'VALIDATION_INVALID_INPUT',
      ]);
      expect(await countStudentAnswers()).toBe(0);
    });

    it('refuses an option id sent for an open question (#1161)', async () => {
      mockUser(student.user);

      const open = await addQuestionToAttempt('open');
      const { options } = await loadAttemptAnswers();
      const option = requiredAt(options, 0, 'attempt option');

      const { request, params } = submitSheet([
        { questionId: open.id, selectedAnswerId: option.id },
      ]);
      const response = await attemptPost(request, { params });
      const body = await json<AnswerValueErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(
        body.issues?.properties?.answers?.items?.[0]?.properties?.selectedAnswerId?.errors,
      ).toEqual(['VALIDATION_INVALID_INPUT']);
      expect(await countStudentAnswers()).toBe(0);
    });

    it('scores a legitimate mcq/true_false/open sheet exactly once per correct answer (#1161)', async () => {
      mockUser(student.user);

      const trueFalse = await addQuestionToAttempt('true_false', [
        { content: 'Prawda', isCorrect: true },
        { content: 'Fałsz', isCorrect: false },
      ]);
      const open = await addQuestionToAttempt('open');
      const { questionIds, options } = await loadAttemptAnswers();

      const firstId = requiredAt(questionIds, 0, 'first mcq');
      const secondId = requiredAt(questionIds, 1, 'second mcq');
      const thirdId = requiredAt(questionIds, 2, 'third mcq');
      const secondCorrectId = await loadCorrectOptionId(secondId);
      const secondWrong = requiredAt(
        options.filter(
          (option) => option.question_id === secondId && option.id !== secondCorrectId,
        ),
        0,
        'wrong option of the second mcq',
      );
      const trueOption = requiredAt(trueFalse.optionIds, 0, 'true_false correct option');

      const { request, params } = submitSheet([
        { questionId: firstId, selectedAnswerId: await loadCorrectOptionId(firstId) },
        { questionId: secondId, selectedAnswerId: secondWrong.id },
        { questionId: thirdId, selectedAnswerId: await loadCorrectOptionId(thirdId) },
        { questionId: trueFalse.id, selectedAnswerId: trueOption },
        { questionId: open.id, textAnswer: '  Rozbiory i liberum veto.  ' },
      ]);
      const response = await attemptPost(request, { params });
      const body = await json<SubmitPayload>(response);

      expect(response.status).toBe(200);
      // The second mcq is wrong and the open answer is never auto-scored; the
      // other three questions score exactly one point each (#176, #329).
      expect(body.data.score).toBe(3);

      const supabase = createServiceClient();
      const { data: stored } = await supabase
        .from('student_answers')
        .select('question_id, question_type, selected_option_id, text_answer, is_correct')
        .eq('attempt_id', attemptId)
        .overrideTypes<
          Pick<
            Database['public']['Tables']['student_answers']['Row'],
            'question_id' | 'question_type' | 'selected_option_id' | 'text_answer' | 'is_correct'
          >[],
          { merge: false }
        >();

      expect(stored).toHaveLength(5);
      const byQuestion = new Map(dbRows(stored).map((row) => [row.question_id, row] as const));
      expect(byQuestion.get(firstId)?.is_correct).toBe(true);
      expect(byQuestion.get(secondId)?.is_correct).toBe(false);
      expect(byQuestion.get(thirdId)?.is_correct).toBe(true);
      expect(byQuestion.get(trueFalse.id)?.is_correct).toBe(true);
      expect(byQuestion.get(open.id)).toMatchObject({
        question_type: 'open',
        selected_option_id: null,
        text_answer: 'Rozbiory i liberum veto.',
        is_correct: false,
      });
    });

    it('persists an open answer as text and submits (#176)', async () => {
      mockUser(student.user);
      const openQuestion = await addQuestionToAttempt('open');

      const supabase = createServiceClient();
      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .neq('question_id', openQuestion.id)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const { data: options } = await supabase
        .from('question_options')
        .select('id, question_id')
        .in(
          'question_id',
          attemptQuestions!.map((q) => q.question_id),
        )
        .overrideTypes<AttemptOptionRow[], { merge: false }>();

      const attemptQuestionIds = attemptQuestions!.map((q) => q.question_id);
      const { data: attemptQuestionRows, error: typesError } = await supabase
        .from('questions')
        .select('id, type')
        .in('id', attemptQuestionIds)
        .overrideTypes<
          Pick<Database['public']['Tables']['questions']['Row'], 'id' | 'type'>[],
          {
            merge: false;
          }
        >();
      if (typesError) throw new Error(`Failed to load question types: ${typesError.message}`);

      const typeById = new Map(dbRows(attemptQuestionRows).map((q) => [q.id, q.type] as const));

      const textAnswer = 'Rozbiory, słaba władza centralna, liberum veto.';
      // Go through the same client helper the take pages use, so a regression
      // that puts open text into `selectedAnswerId` fails here too (#320).
      const localAnswers: Record<string, string> = {};
      // One option per question is exactly the helper's single-value contract;
      // `multi_select` is outside it and not covered here.
      for (const option of options ?? []) localAnswers[option.question_id] ??= option.id;
      localAnswers[openQuestion.id] = textAnswer;

      const submittedAnswers = toSaveAnswersPayload(
        [
          ...attemptQuestionIds.map((id) => {
            const type = typeById.get(id);
            if (!type) throw new Error(`Question ${id} not found for attempt ${attemptId}`);
            return { id, type };
          }),
          { id: openQuestion.id, type: 'open' },
        ],
        localAnswers,
      );

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
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      const { data: storedAnswer } = await supabase
        .from('student_answers')
        .select('text_answer, selected_option_id, question_type, is_correct')
        .eq('attempt_id', attemptId)
        .eq('question_id', openQuestion.id)
        .single()
        .overrideTypes<
          Pick<
            Database['public']['Tables']['student_answers']['Row'],
            'text_answer' | 'selected_option_id' | 'question_type' | 'is_correct'
          >,
          { merge: false }
        >();

      expect(storedAnswer?.text_answer).toBe(textAnswer);
      expect(storedAnswer?.selected_option_id).toBeNull();
      expect(storedAnswer?.question_type).toBe('open');
      expect(storedAnswer?.is_correct).toBe(false);

      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('completed_at')
        .eq('id', attemptId)
        .single()
        .overrideTypes<{ completed_at: string | null }, { merge: false }>();
      expect(attempt?.completed_at).not.toBeNull();
    });

    it('returns 400 when submitting already completed attempt', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const { data: answers } = await supabase
        .from('question_options')
        .select('id, question_id')
        .in(
          'question_id',
          attemptQuestions!.map((q) => q.question_id),
        )
        .overrideTypes<AttemptOptionRow[], { merge: false }>();

      const submittedAnswers = oneAnswerPerQuestion(answers!);

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
      const body = await json<ApiErrorPayload>(response);

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
      const body = await json<ApiErrorPayload>(response);

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
      const body = await json<ApiErrorPayload>(response);

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
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  async function loadAttemptAnswers() {
    const supabase = createServiceClient();
    const { data: attemptQuestions } = await supabase
      .from('quiz_attempt_questions')
      .select('question_id')
      .eq('attempt_id', attemptId)
      .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();
    const questionIds = (attemptQuestions ?? []).map((q) => q.question_id);

    const { data: options } = await supabase
      .from('question_options')
      .select('id, question_id')
      .in('question_id', questionIds)
      .overrideTypes<AttemptOptionRow[], { merge: false }>();

    return { questionIds, options: options ?? [] };
  }

  /**
   * Seeds a question of `type` in the student's bank and adds it to this
   * attempt, the way a bank question would arrive on the sheet.
   */
  async function addQuestionToAttempt(
    type: Database['public']['Enums']['question_type'],
    answers: { content: string; isCorrect: boolean }[] = [],
  ): Promise<{ id: string; optionIds: string[] }> {
    const supabase = createServiceClient();
    const { data: bank } = await supabase
      .from('question_banks')
      .select('id')
      .eq('created_by', student.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .overrideTypes<{ id: string }, { merge: false }>();
    if (!bank) throw new Error('seed question bank not found');

    const { data: question, error } = await supabase
      .from('questions')
      .insert({
        bank_id: bank.id,
        created_by: student.user.id,
        type,
        content: `seed-question-${type}-${crypto.randomUUID()}`,
      })
      .select('id')
      .single()
      .overrideTypes<OpenQuestionRow, { merge: false }>();
    if (error) throw new Error(`Failed to seed ${type} question: ${error.message}`);

    let optionIds: string[] = [];
    if (answers.length > 0) {
      const { data: options, error: optionsError } = await supabase
        .from('question_options')
        .insert(
          answers.map((answer, orderIndex) => ({
            question_id: question.id,
            content: answer.content,
            is_correct: answer.isCorrect,
            order_index: orderIndex,
          })),
        )
        .select('id')
        .overrideTypes<{ id: string }[], { merge: false }>();
      if (optionsError) throw new Error(`Failed to seed options: ${optionsError.message}`);
      optionIds = dbRows(options).map((option) => option.id);
    }

    const { data: last } = await supabase
      .from('quiz_attempt_questions')
      .select('order_index')
      .eq('attempt_id', attemptId)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()
      .overrideTypes<{ order_index: number }, { merge: false }>();

    const { error: linkError } = await supabase.from('quiz_attempt_questions').insert({
      attempt_id: attemptId,
      question_id: question.id,
      order_index: (last?.order_index ?? -1) + 1,
    });
    if (linkError) throw new Error(`Failed to add the question: ${linkError.message}`);

    return { id: question.id, optionIds };
  }

  function submitSheet(answers: unknown[]) {
    return createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      },
    );
  }

  function draftRequest(answers: unknown[]) {
    return createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}/answers`,
      { attemptId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      },
    );
  }

  async function getAttempt() {
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
    );
    const response = await attemptGet(request, { params });
    return { response, body: await json<QuizAttemptDetailPayload>(response) };
  }

  async function countStudentAnswers() {
    const supabase = createServiceClient();
    const { count } = await supabase
      .from('student_answers')
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', attemptId);
    return count ?? 0;
  }

  describe('PUT /api/v1/quiz/:attemptId/answers (#349)', () => {
    it('saves a draft and serves it back on resume without grading it', async () => {
      mockUser(student.user);
      const { options } = await loadAttemptAnswers();
      const first = requiredAt(options, 0, 'attempt option');

      const { request, params } = draftRequest([
        { questionId: first.question_id, selectedAnswerId: first.id },
      ]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<SaveDraftPayload>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.saved).toBe(1);

      // A resume goes through GET and must show the saved selection.
      const { response: getResponse, body: getBody } = await getAttempt();
      expect(getResponse.status).toBe(200);
      expect(getBody.data.completed_at).toBeNull();
      expect(getBody.data.answers).toEqual({
        [first.question_id]: { selected_answer_id: first.id, text_answer: null },
      });
      // Progress must not be graded: nothing lands in student_answers yet.
      expect(await countStudentAnswers()).toBe(0);
    });

    it('returns 404 for another user attempt', async () => {
      mockUser(other);

      const { request, params } = draftRequest([]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = draftRequest([]);
      const response = await attemptAnswersPut(request, { params });

      expect(response.status).toBe(401);
    });

    it('returns 400 once the attempt is submitted', async () => {
      mockUser(student.user);
      const { options } = await loadAttemptAnswers();

      const submitReq = createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: oneAnswerPerQuestion(options),
        }),
      });
      const submitRes = await attemptPost(submitReq, { params: Promise.resolve({ attemptId }) });
      expect(submitRes.status).toBe(200);

      const { request, params } = draftRequest([]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('returns 422 for a question outside the attempt', async () => {
      mockUser(student.user);

      const { request, params } = draftRequest([
        {
          questionId: '00000000-0000-4000-8000-000000000099',
          selectedAnswerId: '00000000-0000-4000-8000-000000000098',
        },
      ]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('refuses a draft option that belongs to another question (#1161)', async () => {
      mockUser(student.user);

      const { questionIds, options } = await loadAttemptAnswers();
      const answeredQuestionId = requiredAt(questionIds, 0, 'answered question');
      const otherQuestionId = requiredAt(questionIds, 1, 'other question');
      const otherOptionId = requiredAt(
        options.filter((option) => option.question_id === otherQuestionId),
        0,
        'option of the other question',
      ).id;

      const { request, params } = draftRequest([
        { questionId: answeredQuestionId, selectedAnswerId: otherOptionId },
      ]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<AnswerValueErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(
        body.issues?.properties?.answers?.items?.[0]?.properties?.selectedAnswerId?.errors,
      ).toEqual(['VALIDATION_INVALID_INPUT']);

      // A draft that submit would refuse must never reach the column.
      const { body: resume } = await getAttempt();
      expect(resume.data.answers).toEqual({});
      expect(await countStudentAnswers()).toBe(0);
    });

    it('still never exposes the answer key after a draft save (#331)', async () => {
      mockUser(student.user);
      const { options } = await loadAttemptAnswers();
      const first = requiredAt(options, 0, 'attempt option');

      const { request, params } = draftRequest([
        { questionId: first.question_id, selectedAnswerId: first.id },
      ]);
      await attemptAnswersPut(request, { params });

      const { body } = await getAttempt();

      expect(
        requiredEntry(body.data.answers, first.question_id, 'draft answer'),
      ).not.toHaveProperty('is_correct');
      for (const question of body.data.questions) {
        expect(question).not.toHaveProperty('explanation');
        expect(question).not.toHaveProperty('search_vector');
        for (const option of question.question_answers) {
          expect(option).not.toHaveProperty('is_correct');
        }
      }
    });

    it('submits a resumed draft and stores one graded row per answered question', async () => {
      mockUser(student.user);
      const { questionIds, options } = await loadAttemptAnswers();
      const perQuestion = new Map<string, string>();
      for (const option of options) {
        if (!perQuestion.has(option.question_id)) {
          perQuestion.set(option.question_id, option.id);
        }
      }

      const drafted = questionIds.map((questionId) => ({
        questionId,
        selectedAnswerId: perQuestion.get(questionId),
      }));

      const { request, params } = draftRequest(drafted);
      expect((await attemptAnswersPut(request, { params })).status).toBe(200);

      const { body: getBody } = await getAttempt();
      expect(Object.keys(getBody.data.answers).toSorted()).toEqual([...questionIds].toSorted());

      // The review/submit payload is built from the resumed answers.
      const submitAnswers = questionIds.map((questionId) => ({
        questionId,
        selectedAnswerId: requiredEntry(getBody.data.answers, questionId, 'resumed answer')
          .selected_answer_id,
      }));

      const submitReq = createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: submitAnswers }),
      });
      const submitRes = await attemptPost(submitReq, { params: Promise.resolve({ attemptId }) });
      expect(submitRes.status).toBe(200);

      expect(await countStudentAnswers()).toBe(questionIds.length);

      const supabase = createServiceClient();
      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('completed_at, draft_answers')
        .eq('id', attemptId)
        .single()
        .overrideTypes<{ completed_at: string | null; draft_answers: unknown }, { merge: false }>();

      expect(attempt?.completed_at).not.toBeNull();
      // Submit clears the draft.
      expect(attempt?.draft_answers).toEqual({});

      const { body: reviewBody } = await getAttempt();
      for (const questionId of questionIds) {
        expect(
          requiredEntry(reviewBody.data.answers, questionId, 'review answer').selected_answer_id,
        ).toBe(perQuestion.get(questionId));
      }
    });
  });
});
