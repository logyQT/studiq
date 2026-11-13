import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { type BeforeResult, before, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
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

/** The aggregate row(s) of one user, read with the service role so RLS cannot hide the result. */
async function readDailyActivity(userId: string): Promise<DailyActivityRow[]> {
  const result = (await service
    .from('user_daily_activity')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })) as ActivityQuery;
  if (result.error) throw new Error(`Failed to read activity: ${result.error.message}`);
  return result.data ?? [];
}

/**
 * A client that carries a real access token for `email`, the way a browser does:
 * requests then run under that user's RLS policies instead of the service role.
 */
async function signIn(
  email: string,
  password: string | undefined,
): Promise<SupabaseClient<Database>> {
  if (!password) throw new Error(`No password for ${email}`);
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
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

  it('books a submitted attempt once, with its real score, on the completion date', async () => {
    const attempt = await startAttempt(2);

    // The start alone is not a completion.
    expect(await readDailyActivity(student.user.id)).toHaveLength(0);

    const score = await submitCorrect(attempt);
    expect(score).toBe(2);

    const activity = await readDailyActivity(student.user.id);
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

    expect(await readDailyActivity(student.user.id)).toHaveLength(0);
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

    let activity = await readDailyActivity(student.user.id);
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

    activity = await readDailyActivity(student.user.id);
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

    activity = await readDailyActivity(student.user.id);
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

    expect(await readDailyActivity(student.user.id)).toHaveLength(0);

    const { error: completeError } = await service
      .from('quiz_attempts')
      .update({ score: 1, completed_at: new Date().toISOString() })
      .eq('id', inserted.id);
    if (completeError) throw new Error(`Failed to complete attempt: ${completeError.message}`);

    const activity = await readDailyActivity(student.user.id);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      date: todayUtc(),
      quizzes_count: 1,
      quizzes_score: 1,
      quizzes_total: 1,
    });
  });
});

describe('user_daily_activity regrade under RLS (#1082)', () => {
  let teacher!: BeforeResult;
  let student!: TestUserFixture;
  let teacherSession!: SupabaseClient<Database>;
  let studentSession!: SupabaseClient<Database>;

  beforeAll(async () => {
    // The student is a member of the teacher's organisation, which is what the
    // same-org `quiz_attempts` policy requires for the teacher's write. The
    // activity row keeps its own-row-only write policy.
    teacher = await before({ role: 'educator', org: true, members: { count: 1 } });
    const [member] = teacher.memberUsers;
    if (!member) throw new Error('Seed created no member for the teacher organisation');
    student = member;

    teacherSession = await signIn(teacher.email, teacher.user.password);
    studentSession = await signIn(student.email, student.password);
  });

  beforeEach(async () => {
    await cleanupQuizAttempts(student.id);
    const { error } = await service.from('user_daily_activity').delete().eq('user_id', student.id);
    if (error) throw new Error(`Failed to clear activity: ${error.message}`);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.id);
    await service.from('user_daily_activity').delete().eq('user_id', student.id);
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
  });

  // The trigger is SECURITY DEFINER so that this write — a teacher's regrade of a
  // student's attempt — lands on the student's activity row. With INVOKER rights
  // the activity UPDATE matches 0 rows and the delta is lost silently, which is
  // exactly what the service-role regrade case above cannot see.
  it('applies the delta when a teacher regrades a student attempt through RLS', async () => {
    const { data: attempt, error: startError } = await studentSession
      .from('quiz_attempts')
      .insert({ user_id: student.id, score: 0, total_questions: 2 })
      .select('id')
      .single();
    if (startError) throw new Error(`Failed to start attempt: ${startError.message}`);

    const { error: completeError } = await studentSession
      .from('quiz_attempts')
      .update({ score: 1, completed_at: new Date().toISOString() })
      .eq('id', attempt.id);
    if (completeError) throw new Error(`Failed to complete attempt: ${completeError.message}`);

    let activity = await readDailyActivity(student.id);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ quizzes_count: 1, quizzes_score: 1, quizzes_total: 2 });

    // The update `TeacherAssignmentService.gradeAnswer` issues, carried by the
    // teacher's access token rather than the service role the unit mock returns.
    const { error: regradeError } = await teacherSession
      .from('quiz_attempts')
      .update({ score: 5, graded_at: new Date().toISOString() })
      .eq('id', attempt.id);
    if (regradeError) throw new Error(`Failed to regrade: ${regradeError.message}`);

    // The attempt itself moved under RLS, so a missing delta is the trigger's failure.
    expect((await readAttempt(attempt.id)).score).toBe(5);

    activity = await readDailyActivity(student.id);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      quizzes_count: 1,
      quizzes_score: 5,
      quizzes_total: 2,
    });
  });
});
