import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson } from '#test/helpers/json';
import {
  cleanupOrganizationDeep,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

// #1165 follow-up / #1170: a classmate must not read another student's attempt, answers or
// attempt questions. These tests sign in REAL users with the anon key — the exact PostgREST
// path a hostile client uses — so the service-role mock other suites rely on cannot hide an
// RLS regression.

const PASSWORD = 'Attempts1170!';
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SeededOrg {
  org: { id: string; name: string };
  adminRoleId: string;
  teacherRoleId: string;
  memberRoleId: string;
  defaultGroupId: string;
}

function newClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Signs in with the anon key: the exact PostgREST access path a browser uses. */
async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

describe('Classmates cannot read each other’s attempts (#1170 part 2)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let questionId: string;

  let studentId: string;
  let classmateId: string;
  let ownAttemptId: string;
  let classmateAttemptId: string;

  let studentSession: SupabaseClient<Database>;
  let teacherSession: SupabaseClient<Database>;
  let managerSession: SupabaseClient<Database>;
  let outsiderSession: SupabaseClient<Database>;

  async function createUser(label: string, accountType: string, roleId?: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email: `attempts-${label}-${tag}@dev.local`,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    if (roleId) {
      await seedOrgMembership({ organizationId: orgId, userId: data.user.id, orgRoleId: roleId });
    }
    return data.user.id;
  }

  async function seedAttempt(
    userId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { data: attempt, error } = await service
      .from('quiz_attempts')
      .insert({
        user_id: userId,
        score: 1,
        total_questions: 1,
        completed_at: new Date().toISOString(),
        organization_id: orgId,
        ...overrides,
      })
      .select('id')
      .single();
    if (error) throw new Error(`attempt: ${error.message}`);

    const { error: linkError } = await service.from('quiz_attempt_questions').insert({
      attempt_id: attempt.id,
      question_id: questionId,
      order_index: 0,
    });
    if (linkError) throw new Error(`attempt question: ${linkError.message}`);

    const { error: answerError } = await service.from('student_answers').insert({
      attempt_id: attempt.id,
      question_id: questionId,
      is_correct: true,
      text_answer: 'classmate-secret',
    });
    if (answerError) throw new Error(`answer: ${answerError.message}`);
    return attempt.id;
  }

  beforeAll(async () => {
    const seeded = asJson<SeededOrg>(await seedOrganization(`attempts-${tag}`));
    orgId = seeded.org.id;

    studentId = await createUser('student', 'student', seeded.memberRoleId);
    classmateId = await createUser('classmate', 'student', seeded.memberRoleId);
    await createUser('teacher', 'educator', seeded.teacherRoleId);
    await createUser('manager', 'manager', seeded.adminRoleId);
    // A signed-in user who shares no organisation with the class: the tenant floor on its own.
    await createUser('outsider', 'student');

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: studentId,
        name: `attempts-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`bank: ${bankError.message}`);

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: studentId,
        bank_id: bank.id,
        type: 'mcq',
        content: `attempts-question-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError) throw new Error(`question: ${questionError.message}`);
    questionId = question.id;

    ownAttemptId = await seedAttempt(studentId);
    classmateAttemptId = await seedAttempt(classmateId);

    studentSession = await signIn(`attempts-student-${tag}@dev.local`);
    teacherSession = await signIn(`attempts-teacher-${tag}@dev.local`);
    managerSession = await signIn(`attempts-manager-${tag}@dev.local`);
    outsiderSession = await signIn(`attempts-outsider-${tag}@dev.local`);
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId);
  });

  it('a student still reads their own attempt, answers and attempt questions', async () => {
    const attempts = await studentSession
      .from('quiz_attempts')
      .select('id, user_id')
      .eq('id', ownAttemptId);
    expect(attempts.error).toBeNull();
    expect(attempts.data?.map((attempt) => attempt.user_id)).toEqual([studentId]);

    const answers = await studentSession
      .from('student_answers')
      .select('attempt_id, is_correct')
      .eq('attempt_id', ownAttemptId);
    expect(answers.error).toBeNull();
    expect(answers.data).toHaveLength(1);

    const attemptQuestions = await studentSession
      .from('quiz_attempt_questions')
      .select('attempt_id, question_id')
      .eq('attempt_id', ownAttemptId);
    expect(attemptQuestions.error).toBeNull();
    expect(attemptQuestions.data).toHaveLength(1);
  });

  it('a classmate reads none of another student’s attempt rows', async () => {
    const attempts = await studentSession
      .from('quiz_attempts')
      .select('id, user_id, score')
      .eq('id', classmateAttemptId);
    expect(attempts.error, 'the read is filtered, not refused').toBeNull();
    expect(attempts.data).toEqual([]);

    const answers = await studentSession
      .from('student_answers')
      .select('id, attempt_id, text_answer')
      .eq('attempt_id', classmateAttemptId);
    expect(answers.error).toBeNull();
    expect(answers.data).toEqual([]);

    const attemptQuestions = await studentSession
      .from('quiz_attempt_questions')
      .select('attempt_id, question_id')
      .eq('attempt_id', classmateAttemptId);
    expect(attemptQuestions.error).toBeNull();
    expect(attemptQuestions.data).toEqual([]);
  });

  it('a student cannot create or take over an attempt in another student name', async () => {
    const { error: insertError } = await studentSession.from('quiz_attempts').insert({
      user_id: classmateId,
      score: 10,
      total_questions: 1,
    });
    expect(insertError?.code).toBe('42501');

    const { data: updated } = await studentSession
      .from('quiz_attempts')
      .update({ score: 100 })
      .eq('id', classmateAttemptId)
      .select('id');
    expect(updated).toEqual([]);
  });

  it('the teacher and the manager keep the class view', async () => {
    for (const [label, session] of [
      ['teacher', teacherSession],
      ['manager', managerSession],
    ] as const) {
      const attempts = await session
        .from('quiz_attempts')
        .select('id, user_id')
        .eq('id', classmateAttemptId);
      expect(attempts.error, `${label} attempt read failed`).toBeNull();
      expect(attempts.data, `${label} cannot read a same-org student's attempt`).toHaveLength(1);

      const answers = await session
        .from('student_answers')
        .select('attempt_id, is_correct')
        .eq('attempt_id', classmateAttemptId);
      expect(answers.error, `${label} answer read failed`).toBeNull();
      expect(answers.data).toHaveLength(1);
    }
  });

  it('a signed-in user outside the organisation reads nothing', async () => {
    const attempts = await outsiderSession
      .from('quiz_attempts')
      .select('id')
      .eq('id', classmateAttemptId);
    expect(attempts.error).toBeNull();
    expect(attempts.data).toEqual([]);
  });
});
