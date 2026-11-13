import type { Database } from '@studiq/server/types/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  cleanupQuestions,
  cleanupQuizAttempts,
  mockUser,
  useRealSupabase,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  createTypedServiceClient,
} from '#test/integration/test-utils';
import { POST as attemptPost } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as quizPost } from '@/app/(backend)/api/v1/quiz/new/route';

type QuizAttemptRow = Database['public']['Tables']['quiz_attempts']['Row'];
type DailyActivityRow = Database['public']['Tables']['user_daily_activity']['Row'];

interface QuizCreateBody {
  data?: { id: string; questions: { id: string }[] };
}

interface ActivityQuery {
  data: DailyActivityRow[] | null;
  error: { message: string } | null;
}

/** UTC because `completed_at::date` is evaluated in the database timezone. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const service = createTypedServiceClient();

async function startAttempt(questionCount = 1): Promise<{ id: string; questionIds: string[] }> {
  const response = await quizPost(
    createNextRequest('http://localhost/api/v1/quiz/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionTypes: ['mcq'], questionCount }),
    }),
  );
  const body = await json<QuizCreateBody>(response);
  if (response.status !== 201 || !body.data) {
    throw new Error(`Failed to start quiz: ${response.status} ${JSON.stringify(body)}`);
  }
  return { id: body.data.id, questionIds: body.data.questions.map((q) => q.id) };
}

async function submitCorrect(attempt: { id: string; questionIds: string[] }): Promise<number> {
  const { data: correctOptions, error } = await service
    .from('question_options')
    .select('id, question_id')
    .in('question_id', attempt.questionIds)
    .eq('is_correct', true);
  if (error) throw new Error(`Failed to read answer key: ${error.message}`);

  const { request, params } = createNextRequestWithParams(
    `http://localhost/api/v1/quiz/${attempt.id}`,
    { attemptId: attempt.id },
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: correctOptions.map((o) => ({
          questionId: o.question_id,
          selectedAnswerId: o.id,
        })),
      }),
    },
  );
  const response = await attemptPost(request, { params: await params });
  const body = await json<{ data?: { score: number | null } }>(response);
  if (response.status !== 200 || body.data?.score == null) {
    throw new Error(`Failed to submit quiz: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data.score;
}

async function readAttempt(id: string): Promise<QuizAttemptRow> {
  const { data, error } = await service.from('quiz_attempts').select('*').eq('id', id).single();
  if (error) throw new Error(`Failed to read attempt: ${error.message}`);
  return data;
}

describe('user_daily_activity quiz counters (#1082)', () => {
  let student!: BeforeResult;

  beforeAll(async () => {
    student = await before({ role: 'student', questions: 2 });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    mockUser(student.user);
    await cleanupQuizAttempts(student.user.id);
    const { error } = await service
      .from('user_daily_activity')
      .delete()
      .eq('user_id', student.user.id);
    if (error) throw new Error(`Failed to clear activity: ${error.message}`);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await service.from('user_daily_activity').delete().eq('user_id', student.user.id);
    await cleanupQuestions(student.user.id, 'seed-question-');
  });

  async function readActivity(): Promise<DailyActivityRow[]> {
    const result = (await service
      .from('user_daily_activity')
      .select('*')
      .eq('user_id', student.user.id)
      .order('date', { ascending: true })) as ActivityQuery;
    if (result.error) throw new Error(`Failed to read activity: ${result.error.message}`);
    return result.data ?? [];
  }

  it('books a submitted attempt once, with its real score, on the completion date', async () => {
    const attempt = await startAttempt(2);

    // The start alone is not a completion.
    expect(await readActivity()).toHaveLength(0);

    const score = await submitCorrect(attempt);
    expect(score).toBe(2);

    const activity = await readActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      date: todayUtc(),
      quizzes_count: 1,
      quizzes_score: score,
      quizzes_total: 2,
    });
  });

  it('does not book an abandoned attempt', async () => {
    await startAttempt(2);

    expect(await readActivity()).toHaveLength(0);
  });

  it('applies a regrade as a score delta without touching count or total', async () => {
    const attempt = await startAttempt(2);
    await submitCorrect(attempt);
    const completed = await readAttempt(attempt.id);

    const { error: upError } = await service
      .from('quiz_attempts')
      .update({ score: completed.score + 3 })
      .eq('id', attempt.id);
    if (upError) throw new Error(`Failed to regrade up: ${upError.message}`);

    let activity = await readActivity();
    expect(activity[0]).toMatchObject({
      quizzes_count: 1,
      quizzes_score: completed.score + 3,
      quizzes_total: 2,
    });

    const { error: downError } = await service
      .from('quiz_attempts')
      .update({ score: 1 })
      .eq('id', attempt.id);
    if (downError) throw new Error(`Failed to regrade down: ${downError.message}`);

    activity = await readActivity();
    expect(activity[0]).toMatchObject({
      quizzes_count: 1,
      quizzes_score: 1,
      quizzes_total: 2,
    });

    // A write that leaves the score alone (graded_at) must not double-count.
    const { error: stampError } = await service
      .from('quiz_attempts')
      .update({ graded_at: new Date().toISOString() })
      .eq('id', attempt.id);
    if (stampError) throw new Error(`Failed to stamp grade: ${stampError.message}`);

    activity = await readActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      quizzes_count: 1,
      quizzes_score: 1,
      quizzes_total: 2,
    });
  });

  it('attributes a completion to completed_at, not started_at', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: inserted, error: insertError } = await service
      .from('quiz_attempts')
      .insert({
        user_id: student.user.id,
        score: 0,
        total_questions: 1,
        started_at: yesterday,
        completed_at: null,
      })
      .select('id')
      .single();
    if (insertError) throw new Error(`Failed to insert attempt: ${insertError.message}`);

    expect(await readActivity()).toHaveLength(0);

    const { error: completeError } = await service
      .from('quiz_attempts')
      .update({ score: 1, completed_at: new Date().toISOString() })
      .eq('id', inserted.id);
    if (completeError) throw new Error(`Failed to complete attempt: ${completeError.message}`);

    const activity = await readActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      date: todayUtc(),
      quizzes_count: 1,
      quizzes_score: 1,
      quizzes_total: 1,
    });
  });
});
