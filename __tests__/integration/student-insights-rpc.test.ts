import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #657: get_student_insights is SECURITY INVOKER and refuses to run for another user. A real seed
// student signs in with the anon key, the path a browser takes.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const STUDENT_ID = '00000000-0000-4000-8001-000000000005'; // student1@dev.local
const OTHER_USER_ID = '00000000-0000-4000-8001-000000000003';

describe('get_student_insights (#657)', () => {
  let student: SupabaseClient;

  beforeAll(async () => {
    student = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await student.auth.signInWithPassword({
      email: 'student1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  it('answers the three blocks for the caller', async () => {
    const { data, error } = await student.rpc('get_student_insights', {
      p_user_id: STUDENT_ID,
      p_days: 30,
    });

    expect(error).toBeNull();
    expect(data.days).toBe(30);
    expect(Array.isArray(data.mastery)).toBe(true);
    expect(data.studyTime.byWeekday).toHaveLength(7);
    expect(data.retention.map((b: { bucket: string }) => b.bucket)).toEqual([
      'd0',
      'd1',
      'd2_3',
      'd4_7',
      'd8_14',
      'd15_30',
      'd31_plus',
    ]);
  });

  it('keeps the window between 1 and 365 days', async () => {
    const wide = await student.rpc('get_student_insights', { p_user_id: STUDENT_ID, p_days: 9999 });
    const narrow = await student.rpc('get_student_insights', { p_user_id: STUDENT_ID, p_days: 0 });

    expect(wide.data.days).toBe(365);
    expect(narrow.data.days).toBe(1);
  });

  it('refuses to run for another user (42501)', async () => {
    const { error } = await student.rpc('get_student_insights', {
      p_user_id: OTHER_USER_ID,
      p_days: 30,
    });

    expect(error?.code).toBe('42501');
  });
});

// The rules the statistics rest on, proven with rows built here (nothing depends on the seed):
//  * mastery leaves out assignment attempts (a teacher may withhold their results), even after
//    the assignment is deleted, and open questions (an ungraded free-text answer is stored
//    `is_correct = false`);
//  * study time counts both flashcard sessions and quizzes, assignment quizzes included, and
//    caps every source at two hours;
//  * the weekday series is ISO (index 0 = Monday).
describe('get_student_insights rules (#657 review)', () => {
  const service = createServiceClient();
  const TEACHER_ID = '00000000-0000-4000-8001-000000000003';
  const ORG = '00000000-0000-4000-8000-000000000001';
  const BANK = '00000000-0000-4000-8020-000000000001';
  const TOPIC = '00000000-0000-4000-8010-000000000001';
  const MARK = `zz657-${Date.now()}`;
  const HOUR = 3_600_000;
  let student: SupabaseClient;

  type Insights = {
    studyTime: { totalMs: number; byWeekday: number[] };
    mastery: Array<{ topicId: string; quizAnswers: number }>;
  };
  const insights = async () => {
    const { data, error } = await student.rpc('get_student_insights', {
      p_user_id: STUDENT_ID,
      p_days: 30,
    });
    expect(error).toBeNull();
    return data as Insights;
  };
  const answers = (data: Insights) =>
    data.mastery.find((m) => m.topicId === TOPIC)?.quizAnswers ?? 0;
  /** 0 = Monday, like the series. */
  const weekday = (date: Date) => (date.getUTCDay() + 6) % 7;

  let before: Insights;
  const now = new Date();
  // The most recent Monday at noon UTC; today when it is Monday and already past noon.
  const monday = new Date(now);
  monday.setUTCHours(12, 0, 0, 0);
  while (weekday(monday) !== 0 || monday > now) monday.setUTCDate(monday.getUTCDate() - 1);

  beforeAll(async () => {
    student = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await student.auth.signInWithPassword({
      email: 'student1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
    before = await insights();

    const question = (type: 'mcq' | 'open') => ({
      type,
      content: `${MARK}-${type}`,
      created_by: TEACHER_ID,
      organization_id: ORG,
      visibility: 'personal',
      bank_id: BANK,
    });
    const { data: questions, error: qError } = await service
      .from('questions')
      .insert([question('mcq'), question('open')])
      .select('id, type');
    if (qError) throw qError;
    const mcq = questions!.find((q) => q.type === 'mcq')!.id;
    const open = questions!.find((q) => q.type === 'open')!.id;
    await service
      .from('question_topic_assignments')
      .insert([mcq, open].map((question_id) => ({ question_id, topic_id: TOPIC })));

    const { data: assignment, error: aError } = await service
      .from('teacher_assignments')
      .insert({ created_by: TEACHER_ID, organization_id: ORG, title: MARK })
      .select('id')
      .single();
    if (aError) throw aError;

    // An assignment that is deleted after the attempt was taken: the FK nulls `assignment_id`,
    // only the durable marker keeps the attempt out of the mastery (#657 review).
    const { data: deletedAssignment, error: dError } = await service
      .from('teacher_assignments')
      .insert({ created_by: TEACHER_ID, organization_id: ORG, title: MARK })
      .select('id')
      .single();
    if (dError) throw dError;

    const finished = (started: Date, ms: number, extra: Record<string, unknown> = {}) => ({
      user_id: STUDENT_ID,
      config: { marker: MARK },
      // Every row of a multi-row insert needs the column: PostgREST fills a key missing from
      // one object with NULL instead of the column default.
      is_assignment_attempt: false,
      started_at: started.toISOString(),
      completed_at: new Date(started.getTime() + ms).toISOString(),
      ...extra,
    });
    const { data: attempts, error: tError } = await service
      .from('quiz_attempts')
      .insert([
        finished(new Date(now.getTime() - 60_000), 60_000), // practice: 1 min
        finished(new Date(now.getTime() - 30_000), 30_000, {
          assignment_id: assignment.id,
          is_assignment_attempt: true,
        }),
        finished(new Date(now.getTime() - 20_000), 20_000, {
          assignment_id: deletedAssignment.id,
          is_assignment_attempt: true,
        }),
      ])
      .select('id, assignment_id, is_assignment_attempt');
    if (tError) throw tError;
    const practice = attempts!.find((a) => !a.is_assignment_attempt)!.id;
    const asg = attempts!.find((a) => a.assignment_id === assignment.id)!.id;
    const orphan = attempts!.find((a) => a.assignment_id === deletedAssignment.id)!.id;
    const { error: sError } = await service.from('student_answers').insert([
      { attempt_id: practice, question_id: mcq, is_correct: true },
      { attempt_id: practice, question_id: open, is_correct: true }, // open answers never count
      { attempt_id: asg, question_id: mcq, is_correct: true }, // assignment answers never count
      { attempt_id: orphan, question_id: mcq, is_correct: true }, // not even after the delete
    ]);
    if (sError) throw sError;

    // Deleting the assignment nulls `assignment_id` on the finished attempts (ON DELETE SET NULL).
    const { error: delError } = await service
      .from('teacher_assignments')
      .delete()
      .eq('id', deletedAssignment.id);
    if (delError) throw delError;

    const session = (completed: Date, ms: number) => ({
      user_id: STUDENT_ID,
      started_at: new Date(completed.getTime() - ms).toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: ms,
      cards_studied: 657,
      mode: 'review',
    });
    const { error: fError } = await service
      .from('flashcard_study_sessions')
      .insert([session(now, 8 * HOUR), session(monday, 600_000)]);
    if (fError) throw fError;
  });

  afterAll(async () => {
    await service.from('quiz_attempts').delete().eq('config->>marker', MARK);
    await service.from('flashcard_study_sessions').delete().eq('cards_studied', 657);
    await service.from('teacher_assignments').delete().eq('title', MARK);
    await service.from('questions').delete().like('content', `${MARK}-%`);
  });

  it('counts the practice answer to a closed question and nothing else for mastery', async () => {
    const after = await insights();

    // the open answer, the assignment answer and the answer of a deleted assignment are all
    // stored as correct, yet add nothing
    expect(answers(after) - answers(before)).toBe(1);
  });

  it('caps every study-time source at two hours and counts assignment quizzes', async () => {
    const after = await insights();

    // 8 h session -> 2 h, a 10 min session, a 1 min practice quiz, a 30 s assignment quiz and
    // a 20 s quiz whose assignment was deleted
    expect(after.studyTime.totalMs - before.studyTime.totalMs).toBe(
      2 * HOUR + 600_000 + 60_000 + 30_000 + 20_000,
    );
  });

  it('buckets the weekdays ISO style, Monday first', async () => {
    const after = await insights();
    const expected = [0, 0, 0, 0, 0, 0, 0];
    expected[weekday(now)] += 2 * HOUR + 60_000 + 30_000 + 20_000;
    expected[weekday(monday)] += 600_000;

    const delta = after.studyTime.byWeekday.map((ms, i) => ms - before.studyTime.byWeekday[i]);
    expect(delta).toEqual(expected);
  });
});
