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

// The rules the statistics rest on, proven with rows built here. Everything belongs to a
// throwaway student (created and deleted by this file), so the numbers are exact instead of a
// delta against the seed and nothing the file writes outlives it:
//  * mastery leaves out assignment attempts (a teacher may withhold their results), even after
//    the assignment is deleted, and open questions (an ungraded free-text answer is stored
//    `is_correct = false`);
//  * study time counts both flashcard sessions and quizzes, assignment quizzes included, and
//    caps every source at two hours;
//  * the weekday series is ISO (index 0 = Monday);
//  * the retention curve buckets the gap to the previous review of the same card and anchors
//    it to a review that may lie outside the window.
describe('get_student_insights rules (#657 review)', () => {
  const service = createServiceClient();
  const TEACHER_ID = '00000000-0000-4000-8001-000000000003';
  const ORG = '00000000-0000-4000-8000-000000000001';
  const MARK = `zz657-${Date.now()}`;
  const EMAIL = `${MARK}@dev.local`;
  const PASSWORD = 'zz657-pass';
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const now = new Date();
  // The most recent Monday at noon UTC; today when it is Monday and already past noon.
  const monday = new Date(now);
  monday.setUTCHours(12, 0, 0, 0);
  const weekday = (date: Date) => (date.getUTCDay() + 6) % 7;
  while (weekday(monday) !== 0 || monday > now) monday.setUTCDate(monday.getUTCDate() - 1);

  type Insights = {
    studyTime: {
      totalMs: number;
      activeDays: number;
      avgMsPerActiveDay: number;
      byDay: Array<{ date: string; ms: number }>;
      byWeekday: number[];
    };
    mastery: Array<{
      topicId: string;
      name: string;
      quizAnswers: number;
      quizAccuracy: number | null;
      flashcardReviews: number;
      flashcardAccuracy: number | null;
      accuracy: number;
    }>;
    retention: Array<{ bucket: string; reviews: number; accuracy: number | null }>;
  };

  let student: SupabaseClient;
  let studentId = '';
  let quizTopic = '';
  let cardTopic = '';

  const insights = async () => {
    const { data, error } = await student.rpc('get_student_insights', {
      p_user_id: studentId,
      p_days: 30,
    });
    expect(error).toBeNull();
    return data as Insights;
  };
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  beforeAll(async () => {
    const { data: created, error: userError } = await service.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: MARK, account_type: 'student' },
    });
    if (userError || !created.user) throw new Error(`createUser failed: ${userError?.message}`);
    studentId = created.user.id;

    student = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await student.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
    });
    if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);

    // Topics and questions owned by the student, so the RPC's SECURITY INVOKER reads see them.
    const { data: topics, error: topicError } = await service
      .from('topics')
      .insert([
        { name: `${MARK} quiz`, created_by: studentId, visibility: 'personal' },
        { name: `${MARK} cards`, created_by: studentId, visibility: 'personal' },
      ])
      .select('id, name');
    if (topicError) throw topicError;
    quizTopic = topics!.find((topic) => topic.name === `${MARK} quiz`)!.id;
    cardTopic = topics!.find((topic) => topic.name === `${MARK} cards`)!.id;

    const question = (type: 'mcq' | 'open') => ({
      type,
      content: `${MARK}-${type}`,
      created_by: studentId,
      visibility: 'personal',
    });
    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({ created_by: studentId, name: MARK, visibility: 'personal' })
      .select('id')
      .single();
    if (bankError) throw bankError;
    const { data: questions, error: qError } = await service
      .from('questions')
      .insert([
        { ...question('mcq'), bank_id: bank.id },
        { ...question('open'), bank_id: bank.id },
      ])
      .select('id, type');
    if (qError) throw qError;
    const mcq = questions!.find((q) => q.type === 'mcq')!.id;
    const open = questions!.find((q) => q.type === 'open')!.id;
    await service
      .from('question_topic_assignments')
      .insert([mcq, open].map((question_id) => ({ question_id, topic_id: quizTopic })));

    const { data: deck, error: deckError } = await service
      .from('flashcard_decks')
      .insert({ created_by: studentId, name: MARK, visibility: 'personal' })
      .select('id')
      .single();
    if (deckError) throw deckError;
    const card = (n: number) => ({
      created_by: studentId,
      deck_id: deck.id,
      front: `${MARK} ${n}`,
      back: `${MARK} ${n}`,
      visibility: 'personal',
    });
    const { data: cards, error: cardError } = await service
      .from('flashcards')
      .insert([card(1), card(2), card(3)])
      .select('id, front');
    if (cardError) throw cardError;
    const cardA = cards!.find((c) => c.front === `${MARK} 1`)!.id;
    const cardB = cards!.find((c) => c.front === `${MARK} 2`)!.id;
    const cardC = cards!.find((c) => c.front === `${MARK} 3`)!.id;
    await service.from('flashcard_topic_assignments').insert([
      { flashcard_id: cardA, topic_id: quizTopic },
      { flashcard_id: cardB, topic_id: cardTopic },
    ]);

    const createAssignment = async () => {
      const { data, error } = await service
        .from('teacher_assignments')
        .insert({ created_by: TEACHER_ID, organization_id: ORG, title: MARK })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    };
    const assignment = await createAssignment();
    // An assignment deleted after the attempt was taken: the FK nulls `assignment_id`, only
    // the durable marker keeps the attempt out of the mastery.
    const deletedAssignment = await createAssignment();

    const finished = (ms: number, extra: Record<string, unknown> = {}) => ({
      user_id: studentId,
      config: { marker: MARK },
      started_at: new Date(now.getTime() - ms).toISOString(),
      completed_at: now.toISOString(),
      ...extra,
    });
    const { data: attempts, error: tError } = await service
      .from('quiz_attempts')
      .insert([
        finished(60_000), // practice: 1 min
        finished(30_000, { assignment_id: assignment }),
        finished(20_000, { assignment_id: deletedAssignment }),
        // 8 h elapsed: the quiz half of the two-hour cap
        finished(8 * HOUR, { assignment_id: assignment }),
      ])
      .select('id, assignment_id, is_assignment_attempt');
    if (tError) throw tError;
    const practice = attempts!.find((a) => !a.is_assignment_attempt)!.id;
    const assignmentAttempt = attempts!.find((a) => a.assignment_id === assignment)!.id;
    const orphan = attempts!.find((a) => a.assignment_id === deletedAssignment)!.id;
    const { error: sError } = await service.from('student_answers').insert([
      { attempt_id: practice, question_id: mcq, is_correct: true },
      { attempt_id: practice, question_id: open, is_correct: true }, // open answers never count
      { attempt_id: assignmentAttempt, question_id: mcq, is_correct: true }, // assignments never
      { attempt_id: orphan, question_id: mcq, is_correct: true }, // not even after the delete
    ]);
    if (sError) throw sError;

    // Deleting the assignment nulls `assignment_id` on the finished attempt (ON DELETE SET NULL).
    const { error: delError } = await service
      .from('teacher_assignments')
      .delete()
      .eq('id', deletedAssignment);
    if (delError) throw delError;

    const session = (completed: Date, ms: number) => ({
      user_id: studentId,
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

    // cardA: a 31-day gap anchored on a review outside the window, then 1, 2, 4 and 8 days.
    // cardB: a single 15-day gap. cardC: one review only, so no gap at all.
    const review = (flashcard_id: string, days: number, was_correct: boolean) => ({
      user_id: studentId,
      flashcard_id,
      was_correct,
      practiced_at: daysAgo(days),
    });
    const { error: rError } = await service
      .from('flashcard_practice')
      .insert([
        review(cardA, 60, true),
        review(cardA, 29, true),
        review(cardA, 28, false),
        review(cardA, 26, true),
        review(cardA, 22, true),
        review(cardA, 14, false),
        review(cardB, 16, true),
        review(cardB, 1, true),
        review(cardC, 3, true),
      ]);
    if (rError) throw rError;
  });

  afterAll(async () => {
    await service.from('teacher_assignments').delete().eq('title', MARK);
    // Cascades the profile and everything the student owns: attempts, answers, sessions,
    // reviews, cards, decks, topics, questions and the daily-activity rows the triggers wrote.
    if (studentId) await service.auth.admin.deleteUser(studentId);
  });

  it('caps every study-time source at two hours and counts assignment quizzes', async () => {
    const data = await insights();

    // 8 h session -> 2 h, a 10 min session, a 1 min practice quiz, a 30 s and a 20 s
    // assignment quiz, and an 8 h assignment quiz -> 2 h
    const total = 15_110_000;
    expect(data.studyTime.totalMs).toBe(total);
    const activeDays = new Set([now.toISOString().slice(0, 10), monday.toISOString().slice(0, 10)])
      .size;
    expect(data.studyTime.activeDays).toBe(activeDays);
    expect(data.studyTime.avgMsPerActiveDay).toBe(Math.round(total / activeDays));
  });

  it('buckets the weekdays ISO style, Monday first', async () => {
    const data = await insights();
    const expected = [0, 0, 0, 0, 0, 0, 0];
    expected[weekday(now)] += 14_510_000;
    expected[weekday(monday)] += 600_000;

    expect(data.studyTime.byWeekday).toEqual(expected);
  });

  it('counts quiz answers and card reviews per topic, but no assignment or open answer', async () => {
    const data = await insights();

    expect(data.mastery).toEqual([
      {
        topicId: quizTopic,
        name: `${MARK} quiz`,
        // the one practice answer; the assignment and deleted-assignment answers add nothing
        quizAnswers: 1,
        quizAccuracy: 100,
        // cardA: five reviews in the window, three of them correct
        flashcardReviews: 5,
        flashcardAccuracy: 60,
        accuracy: 67,
      },
      {
        topicId: cardTopic,
        name: `${MARK} cards`,
        quizAnswers: 0,
        quizAccuracy: null,
        flashcardReviews: 2,
        flashcardAccuracy: 100,
        accuracy: 100,
      },
    ]);
  });

  it('keeps the assignment marker database-controlled, so a client cannot flip it', async () => {
    const select = () =>
      service
        .from('quiz_attempts')
        .select('id, assignment_id, is_assignment_attempt')
        .eq('config->>marker', MARK);
    const { data: rows, error } = await select();
    if (error) throw error;
    const practice = rows!.find((row) => !row.assignment_id && !row.is_assignment_attempt)!;
    const assignmentAttempt = rows!.find((row) => row.is_assignment_attempt)!;

    // The student can update their own attempt through PostgREST (RLS FOR ALL); the trigger
    // keeps the stored provenance.
    await student
      .from('quiz_attempts')
      .update({ is_assignment_attempt: true })
      .eq('id', practice.id);
    await student
      .from('quiz_attempts')
      .update({ is_assignment_attempt: false })
      .eq('id', assignmentAttempt.id);

    const { data: after } = await select();
    expect(after!.find((row) => row.id === practice.id)!.is_assignment_attempt).toBe(false);
    expect(after!.find((row) => row.id === assignmentAttempt.id)!.is_assignment_attempt).toBe(true);
  });

  it('buckets the retention curve by the gap to the previous review, and keeps empty buckets', async () => {
    const data = await insights();

    expect(data.retention).toEqual([
      { bucket: 'd0', reviews: 0, accuracy: null },
      // cardA, 28 days ago (one day after its 29-day review): wrong
      { bucket: 'd1', reviews: 1, accuracy: 0 },
      { bucket: 'd2_3', reviews: 1, accuracy: 100 },
      { bucket: 'd4_7', reviews: 1, accuracy: 100 },
      { bucket: 'd8_14', reviews: 1, accuracy: 0 },
      // cardB, yesterday (15 days after its first review)
      { bucket: 'd15_30', reviews: 1, accuracy: 100 },
      // cardA, 29 days ago: its previous review is 60 days old, outside the window
      { bucket: 'd31_plus', reviews: 1, accuracy: 100 },
    ]);
    // cardC was reviewed once, so it has no gap; cardA's first review is out of the window.
    expect(data.retention.reduce((sum, bucket) => sum + bucket.reviews, 0)).toBe(6);
  });
});
