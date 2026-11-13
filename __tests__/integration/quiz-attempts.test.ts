import type { Database } from '@studiq/server/types/database';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import postgres from 'postgres';
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
/** `question_options` row that also carries the key, for tests that need a known-correct pick. */
interface CorrectableOptionRow extends AttemptOptionRow {
  is_correct: boolean;
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

/** The id of the `question_options` row the fixtures mark correct for `questionId`. */
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

/**
 * The optional direct connection the failure injection needs, gated like the
 * #1066 dedupe suite: without `SUPABASE_DB_URL` the cases below are skipped, not
 * failed. The app cannot express a failing answer insert, so it is injected at
 * the storage layer — the same class of failure as a constraint or a dropped
 * connection midway through `submit`.
 */
const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/** A trigger argument: the ids come from the API/DB, and DDL cannot bind them. */
const safeUuid = (value: string) => value.replaceAll(/[^0-9a-zA-Z-]/g, '');

/**
 * Makes `student_answers` inserts fail for one attempt — every row, or only the
 * row of `questionId` so a sheet fails midway through. Returns the cleanup that
 * drops the trigger and closes the connection.
 */
async function rejectAnswerInserts(
  attempt: string,
  questionId?: string,
): Promise<() => Promise<void>> {
  const sql = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
  const questionFilter = questionId ? `AND NEW.question_id = '${safeUuid(questionId)}'::uuid` : '';
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.test_reject_answer_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.attempt_id = '${safeUuid(attempt)}'::uuid ${questionFilter} THEN
        RAISE EXCEPTION 'test: forced student_answers insert failure'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS test_reject_answer_insert ON public.student_answers;
    CREATE TRIGGER test_reject_answer_insert
      BEFORE INSERT ON public.student_answers
      FOR EACH ROW EXECUTE FUNCTION public.test_reject_answer_insert();
  `);

  return async () => {
    await sql.unsafe(`
      DROP TRIGGER IF EXISTS test_reject_answer_insert ON public.student_answers;
      DROP FUNCTION IF EXISTS public.test_reject_answer_insert();
    `);
    await sql.end();
  };
}

/** Acts as the student's own client the way PostgREST does: role + JWT claims. */
async function actAsStudent(
  sql: Pick<ReturnType<typeof postgres>, 'unsafe'>,
  userId: string,
): Promise<void> {
  await sql.unsafe('SET LOCAL role authenticated');
  await sql.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
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

/** Error bodies only assert the envelope (plus the app error code where it matters). */
interface ApiErrorPayload {
  success: boolean;
  error?: string;
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

    it('refuses an option that belongs to another question and stores nothing (#1161)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { questionIds } = await loadAttemptAnswers();
      const answeredQuestionId = requiredAt(questionIds, 0, 'answered question');
      const otherQuestionId = requiredAt(questionIds, 1, 'other question');

      // The exploit: the other question's correct option scores for this one when
      // the correctness lookup only sees the option id.
      const otherCorrectOptionId = await loadCorrectOptionId(otherQuestionId);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: answeredQuestionId, selectedAnswerId: otherCorrectOptionId }],
          }),
        },
      );
      const response = await attemptPost(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await countStudentAnswers()).toBe(0);

      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('completed_at')
        .eq('id', attemptId)
        .single()
        .overrideTypes<{ completed_at: string | null }, { merge: false }>();
      expect(attempt?.completed_at).toBeNull();
    });

    it('refuses an option id sent for an open question and stores nothing (#1161)', async () => {
      mockUser(student.user);

      const openQuestionId = await addOpenQuestionToAttempt('seed-question-open-1161-option');
      const { options } = await loadAttemptAnswers();
      // Any option id is refused for an open question, even a real one from
      // another question of this attempt.
      const option = requiredAt(options, 0, 'attempt option');

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: openQuestionId, selectedAnswerId: option.id }],
          }),
        },
      );
      const response = await attemptPost(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await countStudentAnswers()).toBe(0);
    });

    it('refuses free text sent for a choice question and stores nothing (#1161)', async () => {
      mockUser(student.user);

      const { questionIds } = await loadAttemptAnswers();
      const choiceQuestionId = requiredAt(questionIds, 0, 'choice question');

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: choiceQuestionId, textAnswer: 'Wisła' }],
          }),
        },
      );
      const response = await attemptPost(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await countStudentAnswers()).toBe(0);
    });

    it('scores a correct choice and writes no row for an explicitly skipped question (#1161)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const { questionIds } = await loadAttemptAnswers();
      const answeredQuestionId = requiredAt(questionIds, 0, 'answered question');
      const skippedQuestionId = requiredAt(questionIds, 1, 'skipped question');
      const correctOptionId = await loadCorrectOptionId(answeredQuestionId);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              { questionId: answeredQuestionId, selectedAnswerId: correctOptionId },
              { questionId: skippedQuestionId, skipped: true },
            ],
          }),
        },
      );
      const response = await attemptPost(request, { params });
      const body = await json<SubmitPayload>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      // Two questions on the sheet, one answered: practice scoring counts it once.
      expect(body.data.score).toBe(1);

      const { data: stored } = await supabase
        .from('student_answers')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<{ question_id: string | null }[], { merge: false }>();

      expect(stored).toHaveLength(1);
      expect(requiredAt(dbRows(stored), 0, 'stored answer').question_id).toBe(answeredQuestionId);
      expect(await countStudentAnswers()).toBe(1);
    });

    it('persists an open answer as text and submits (#176)', async () => {
      mockUser(student.user);

      const supabase = createServiceClient();
      const openQuestionId = await addOpenQuestionToAttempt(
        'seed-question-open-176',
        'Rozbiory, słaba władza centralna, liberum veto.',
      );

      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .neq('question_id', openQuestionId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();

      const { data: options } = await supabase
        .from('question_options')
        .select('id, question_id, is_correct')
        .in(
          'question_id',
          attemptQuestions!.map((q) => q.question_id),
        )
        .overrideTypes<CorrectableOptionRow[], { merge: false }>();

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
      // Each choice question answered with its own known-correct option, so the
      // score below is the exact graded count and not whatever option PostgREST
      // happened to return first (#1161 keeps this scoring unchanged).
      for (const option of options ?? []) {
        if (option.is_correct) localAnswers[option.question_id] = option.id;
      }
      localAnswers[openQuestionId] = textAnswer;

      const submittedAnswers = toSaveAnswersPayload(
        [
          ...attemptQuestionIds.map((id) => {
            const type = typeById.get(id);
            if (!type) throw new Error(`Question ${id} not found for attempt ${attemptId}`);
            return { id, type };
          }),
          { id: openQuestionId, type: 'open' },
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
      const body = await json<SubmitPayload>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      // One point per auto-graded question; the open one is stored but scored 0 (#329).
      expect(body.data.score).toBe(attemptQuestionIds.length);

      const { data: storedAnswer } = await supabase
        .from('student_answers')
        .select('text_answer, selected_option_id, question_type, is_correct')
        .eq('attempt_id', attemptId)
        .eq('question_id', openQuestionId)
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

    it('completes an attempt once when two submits race (#1066)', async () => {
      mockUser(student.user);
      const { options } = await loadAttemptAnswers();
      const answers = oneAnswerPerQuestion(options);

      // Same sheet, sent together: the conditional completion write picks one
      // winner and the loser answers exactly like a later re-submit. The status
      // pair alone does not prove the interleaving (a serialized loser produces
      // the same one), but a winner that wrote a second sheet would.
      const submitOnce = () =>
        attemptPost(
          createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers }),
          }),
          { params: Promise.resolve({ attemptId }) },
        );

      const responses = await Promise.all([submitOnce(), submitOnce()]);
      const statuses = responses.map((response) => response.status).toSorted();

      expect(statuses).toEqual([200, 400]);
      const refused = responses.find((response) => response.status === 400);
      expect(await json<ApiErrorPayload>(refused!)).toMatchObject({ success: false });

      // One answer row per question, not one sheet per request.
      const supabase = createServiceClient();
      const { data: rows, error } = await supabase
        .from('student_answers')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<{ question_id: string | null }[], { merge: false }>();
      if (error) throw new Error(`Failed to read answers: ${error.message}`);
      const stored = dbRows(rows);
      expect(stored).toHaveLength(answers.length);
      expect(new Set(stored.map((row) => row.question_id)).size).toBe(answers.length);

      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('completed_at')
        .eq('id', attemptId)
        .single()
        .overrideTypes<{ completed_at: string | null }, { merge: false }>();
      expect(attempt?.completed_at).not.toBeNull();

      // A later submit is the ordinary re-submit refusal, not a third write.
      const later = await submitOnce();
      expect(later.status).toBe(400);
      expect(await countStudentAnswers()).toBe(answers.length);
    });

    it('answers a re-submit with 400 and stores no second sheet (#1066)', async () => {
      mockUser(student.user);
      const { options } = await loadAttemptAnswers();
      const answers = oneAnswerPerQuestion(options);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/quiz/${attemptId}`,
        { attemptId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        },
      );
      expect((await attemptPost(request, { params })).status).toBe(200);
      const storedAfterSubmit = await countStudentAnswers();

      const repeat = () =>
        attemptPost(
          createNextRequest(`http://localhost/api/v1/quiz/${attemptId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers }),
          }),
          { params: Promise.resolve({ attemptId }) },
        );

      const refused = await repeat();
      expect(refused.status).toBe(400);
      expect(await json<ApiErrorPayload>(refused)).toMatchObject({ success: false });
      expect(await countStudentAnswers()).toBe(storedAfterSubmit);
    });

    it('refuses a duplicate answer row for the same question at the storage layer (#1066)', async () => {
      const supabase = createServiceClient();
      const { data: attemptQuestions } = await supabase
        .from('quiz_attempt_questions')
        .select('question_id')
        .eq('attempt_id', attemptId)
        .overrideTypes<QuizAttemptQuestionRow[], { merge: false }>();
      const questionId = requiredAt(attemptQuestions ?? [], 0, 'attempt question').question_id;

      const row = {
        attempt_id: attemptId,
        question_id: questionId,
        question_type: 'mcq' as const,
        is_correct: false,
      };

      const { error: duplicateError } = await supabase
        .from('student_answers')
        .insert([row, { ...row, is_correct: true }]);
      // The unique key is the storage enforcement of the one-row contract.
      expect(duplicateError?.code).toBe('23505');

      // The shape the service writes tolerates the repeat instead.
      const { error: upsertError } = await supabase
        .from('student_answers')
        .upsert([row], { onConflict: 'attempt_id,question_id', ignoreDuplicates: true });
      expect(upsertError).toBeNull();
    });

    it.skipIf(!localDatabaseUrl)(
      'keeps the attempt open, the draft intact and the sheet empty when the answer insert fails (#1064)',
      async () => {
        mockUser(student.user);
        const { options } = await loadAttemptAnswers();
        const answers = oneAnswerPerQuestion(options);

        // The draft is what the student comes back to after the failed submit.
        const { request: draft, params: draftParams } = draftRequest(answers);
        expect((await attemptAnswersPut(draft, { params: draftParams })).status).toBe(200);
        const draftBefore = await loadDraftAnswers();
        expect(Object.keys(draftBefore).length).toBeGreaterThan(0);

        const restore = await rejectAnswerInserts(attemptId);
        try {
          const { request, params } = submitPost(answers);
          const response = await attemptPost(request, { params });

          // The insert failed, so the submit did too...
          expect(response.status).toBe(400);
          // ...and it took the completion with it: the attempt is still open, the
          // draft is still there and no answer row exists. Before #1064 the
          // completion write had already committed here, so every retry was a
          // re-submit refusal and the sheet was lost.
          const attempt = await loadAttemptRow();
          expect(attempt.completed_at).toBeNull();
          expect(await loadDraftAnswers()).toEqual(draftBefore);
          expect(await countStudentAnswers()).toBe(0);
        } finally {
          await restore();
        }
      },
    );

    it.skipIf(!localDatabaseUrl)(
      'accepts the retry once the insert failure clears and stores the sheet (#1064)',
      async () => {
        mockUser(student.user);
        const { options } = await loadAttemptAnswers();
        const answers = oneAnswerPerQuestion(options);

        const restore = await rejectAnswerInserts(attemptId);
        const { request, params } = submitPost(answers);
        // The injected failure is transient: `finally` clears it for the retry.
        const failed = await attemptPost(request, { params }).finally(restore);
        expect(failed.status).toBe(400);

        const { request: retry, params: retryParams } = submitPost(answers);
        const retried = await attemptPost(retry, { params: retryParams });
        const body = await json<SubmitPayload>(retried);

        expect(retried.status).toBe(200);
        expect(body.success).toBe(true);

        const attempt = await loadAttemptRow();
        expect(attempt.completed_at).not.toBeNull();
        expect(attempt.score).toBe(body.data.score);
        expect(await countStudentAnswers()).toBe(answers.length);
        // The completion is the write that retires the draft (#349).
        expect(await loadDraftAnswers()).toEqual({});
      },
    );

    it.skipIf(!localDatabaseUrl)(
      'rolls back the rows the sheet already wrote when a later row fails (#1064)',
      async () => {
        mockUser(student.user);
        // A second question, so the sheet is written as several rows and the
        // failure lands on the last one: a non-transactional insert would leave
        // the earlier rows behind on an attempt that is still open.
        const openQuestionId = await addOpenQuestionToAttempt('seed-question-open-1064');
        const { options } = await loadAttemptAnswers();
        const answers = [
          ...oneAnswerPerQuestion(options),
          { questionId: openQuestionId, textAnswer: 'Odpowiedź otwarta.' },
        ];
        expect(answers.length).toBeGreaterThan(1);
        expect(answers.at(-1)?.questionId).toBe(openQuestionId);

        const restore = await rejectAnswerInserts(attemptId, openQuestionId);
        try {
          const { request, params } = submitPost(answers);
          expect((await attemptPost(request, { params })).status).toBe(400);

          expect(await countStudentAnswers()).toBe(0);
          expect((await loadAttemptRow()).completed_at).toBeNull();
        } finally {
          await restore();
        }
      },
    );

    it.skipIf(!localDatabaseUrl)(
      'completes nothing when a second call races the first inside the function (#1064)',
      async () => {
        const { options } = await loadAttemptAnswers();
        const sheet = oneAnswerPerQuestion(options).map((answer) => ({
          question_id: answer.questionId,
          question_type: 'mcq',
          selected_option_id: answer.selectedAnswerId,
          text_answer: null,
          is_correct: false,
        }));

        // The route gate refuses a re-submit long before the function runs, so
        // the function's own guard needs a caller that bypasses it — the same
        // direct call any student's JWT can make. Two connections act as that
        // caller the way PostgREST does (`role` + JWT claims), which lets the
        // first transaction stay open while the second call is in flight.
        const first = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
        const second = postgres(localDatabaseUrl!, {
          max: 1,
          onnotice: () => {},
          connection: { application_name: 'studiq_test_racer' },
        });
        const probe = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
        /** Blocks until the racing backend is waiting on a lock, so the commit cannot outrun it. */
        const waitForRacerToBlock = async () => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const [waiting] = await probe.unsafe(
              `SELECT 1 FROM pg_stat_activity
               WHERE application_name = 'studiq_test_racer' AND wait_event_type = 'Lock'`,
            );
            if (waiting) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error('the racing submit never blocked on a lock');
        };
        const submit = (sql: Pick<ReturnType<typeof postgres>, 'unsafe'>, score: number) =>
          sql.unsafe(
            'SELECT * FROM public.submit_quiz_attempt($1::uuid, $2::uuid, $3::int, $4::text::jsonb)',
            [attemptId, student.user.id, score, JSON.stringify(sheet)],
          );

        try {
          await first.unsafe('BEGIN');
          await actAsStudent(first, student.user.id);
          expect(await submit(first, 1)).toHaveLength(1);

          // Started while the first transaction still holds the attempt row:
          // it must wait for the lock, then read `completed_at` set and write
          // nothing. Without the lock it writes first and aborts on the
          // completion predicate (a 500 at the route), and without the guard it
          // completes a second time.
          const racer = second.begin(async (tx) => {
            await actAsStudent(tx, student.user.id);
            return submit(tx, 99);
          });
          await waitForRacerToBlock();
          await first.unsafe('COMMIT');

          expect(await racer).toHaveLength(0);
          // The losing call's score never lands, and the sheet stays the first one.
          expect((await loadAttemptRow()).score).toBe(1);
          expect(await countStudentAnswers()).toBe(sheet.length);
        } finally {
          await first.end();
          await second.end();
          await probe.end();
        }
      },
    );

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
      // Same refusal as a raced loser, and no second sheet (#1066).
      expect(await countStudentAnswers()).toBe(submittedAnswers.length);
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
          body: JSON.stringify({ answers: [{ questionId: 'not-a-uuid', skipped: true }] }),
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

  /** Adds a fresh `open` question to this attempt, the way a bank question would arrive. */
  async function addOpenQuestionToAttempt(content: string, explanation?: string): Promise<string> {
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

    const { data: question, error } = await supabase
      .from('questions')
      .insert({
        bank_id: bank.id,
        created_by: student.user.id,
        type: 'open',
        content,
        ...(explanation ? { explanation } : {}),
      })
      .select('id')
      .single()
      .overrideTypes<OpenQuestionRow, { merge: false }>();
    if (error) throw new Error(`Failed to seed open question: ${error.message}`);

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
    if (linkError) throw new Error(`Failed to add the open question: ${linkError.message}`);

    return question.id;
  }

  /** The attempt's stored `draft_answers` map, read back through the service client. */
  async function loadDraftAnswers() {
    const supabase = createServiceClient();
    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('draft_answers')
      .eq('id', attemptId)
      .single()
      .overrideTypes<{ draft_answers: Record<string, unknown> }, { merge: false }>();
    return attempt?.draft_answers;
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

  function submitPost(answers: unknown[]) {
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

  /** The attempt row's completion state and score, read back through the service client. */
  async function loadAttemptRow() {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('completed_at, score')
      .eq('id', attemptId)
      .single()
      .overrideTypes<{ completed_at: string | null; score: number }, { merge: false }>();
    if (error) throw new Error(`Failed to read the attempt: ${error.message}`);
    return data;
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

    it('refuses a draft option that belongs to another question and keeps the stored draft (#1161)', async () => {
      mockUser(student.user);
      const { questionIds, options } = await loadAttemptAnswers();
      const firstQuestionId = requiredAt(questionIds, 0, 'first attempt question');
      const otherQuestionId = requiredAt(questionIds, 1, 'second attempt question');
      const firstOption = requiredAt(
        options.filter((option) => option.question_id === firstQuestionId),
        0,
        'option of the first question',
      );
      const otherOption = requiredAt(
        options.filter((option) => option.question_id === otherQuestionId),
        0,
        'option of the second question',
      );

      // One valid answer first, so the refused autosave has a stored draft to leave alone.
      const { request: saveRequest, params: saveParams } = draftRequest([
        { questionId: firstQuestionId, selectedAnswerId: firstOption.id },
      ]);
      expect((await attemptAnswersPut(saveRequest, { params: saveParams })).status).toBe(200);

      const storedBefore = await loadDraftAnswers();
      expect(storedBefore).toEqual({
        [firstQuestionId]: { selected_answer_id: firstOption.id, text_answer: null },
      });

      // The autosave the exploit would use: the *other* question's option, which
      // the take page can only produce by tampering.
      const { request, params } = draftRequest([
        { questionId: firstQuestionId, selectedAnswerId: otherOption.id },
      ]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<ApiErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await loadDraftAnswers()).toEqual(storedBefore);
    });

    it('clears a saved draft value with an explicit skip (#1161)', async () => {
      mockUser(student.user);
      const { questionIds, options } = await loadAttemptAnswers();
      const clearedQuestionId = requiredAt(questionIds, 0, 'cleared question');
      const keptQuestionId = requiredAt(questionIds, 1, 'kept question');
      const clearedOption = requiredAt(
        options.filter((option) => option.question_id === clearedQuestionId),
        0,
        'option of the cleared question',
      );
      const keptOption = requiredAt(
        options.filter((option) => option.question_id === keptQuestionId),
        0,
        'option of the kept question',
      );

      // Both questions carry a value first.
      const { request: saveRequest, params: saveParams } = draftRequest([
        { questionId: clearedQuestionId, selectedAnswerId: clearedOption.id },
        { questionId: keptQuestionId, selectedAnswerId: keptOption.id },
      ]);
      expect((await attemptAnswersPut(saveRequest, { params: saveParams })).status).toBe(200);
      expect(await loadDraftAnswers()).toEqual({
        [clearedQuestionId]: { selected_answer_id: clearedOption.id, text_answer: null },
        [keptQuestionId]: { selected_answer_id: keptOption.id, text_answer: null },
      });

      // Full-state replace: the skip removes the key instead of storing the skip.
      const { request, params } = draftRequest([
        { questionId: clearedQuestionId, skipped: true },
        { questionId: keptQuestionId, selectedAnswerId: keptOption.id },
      ]);
      const response = await attemptAnswersPut(request, { params });
      const body = await json<SaveDraftPayload>(response);

      expect(response.status).toBe(200);
      expect(body.data.saved).toBe(1);

      const draft = await loadDraftAnswers();
      expect(draft).toEqual({
        [keptQuestionId]: { selected_answer_id: keptOption.id, text_answer: null },
      });
      expect(draft).not.toHaveProperty(clearedQuestionId);

      // A resume no longer serves the cleared answer.
      const { body: resumed } = await getAttempt();
      expect(resumed.data.answers).toEqual({
        [keptQuestionId]: { selected_answer_id: keptOption.id, text_answer: null },
      });
    });
  });
});
