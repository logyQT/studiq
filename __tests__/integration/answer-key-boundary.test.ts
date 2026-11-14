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

// #1165 / #1170: the answer key is closed at the DATABASE boundary, not in the API. These
// tests sign in REAL users with the anon key — the exact PostgREST path a browser (or a hostile
// client) uses — so a service-role mock cannot hide an RLS/column-grant regression.

const PASSWORD = 'AnswerKey1170!';
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

describe('Answer-key boundary (#1170)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let questionId: string;
  let otherOptionId: string;

  let teacherId: string;
  let studentId: string;

  let teacherSession: SupabaseClient<Database>;
  let studentSession: SupabaseClient<Database>;

  async function createUser(label: string, accountType: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email: `answer-key-${label}-${tag}@dev.local`,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    const seeded = asJson<SeededOrg>(await seedOrganization(`answer-key-${tag}`));
    orgId = seeded.org.id;

    teacherId = await createUser('teacher', 'educator');
    studentId = await createUser('student', 'student');
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherId,
      orgRoleId: seeded.teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentId,
      orgRoleId: seeded.memberRoleId,
    });

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        name: `answer-key-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`bank: ${bankError.message}`);

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        bank_id: bank.id,
        type: 'mcq',
        content: `answer-key-question-${tag}`,
        explanation: `answer-key-explanation-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError) throw new Error(`question: ${questionError.message}`);
    questionId = question.id;

    const { data: options, error: optionError } = await service
      .from('question_options')
      .insert([
        { question_id: questionId, content: 'correct', is_correct: true, order_index: 0 },
        { question_id: questionId, content: 'wrong', is_correct: false, order_index: 1 },
      ])
      .select('id, is_correct');
    if (optionError) throw new Error(`options: ${optionError.message}`);
    otherOptionId = options.find((option) => !option.is_correct)!.id;

    teacherSession = await signIn(`answer-key-teacher-${tag}@dev.local`);
    studentSession = await signIn(`answer-key-student-${tag}@dev.local`);
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId);
    for (const id of [teacherId, studentId]) {
      await service.auth.admin.deleteUser(id);
    }
  });

  it('a student session cannot select the answer key, by column or through *', async () => {
    const keyed = await studentSession
      .from('question_options')
      .select('id, content, is_correct')
      .eq('question_id', questionId);
    expect(keyed.error?.code, 'is_correct must not be selectable').toBe('42501');

    const star = await studentSession
      .from('question_options')
      .select('*')
      .eq('question_id', questionId);
    expect(star.error?.code, 'select(*) must not smuggle the key').toBe('42501');

    const reader = await studentSession
      .from('question_options')
      .select('id, content, order_index, match_group, match_side')
      .eq('question_id', questionId)
      .order('order_index');
    expect(reader.error).toBeNull();
    expect(reader.data?.map((option) => option.content)).toEqual(['correct', 'wrong']);
    expect(reader.data?.[0]).not.toHaveProperty('is_correct');
  });

  it('no user session reads the key, the teacher included: staff reads it through the server', async () => {
    const teacherRead = await teacherSession
      .from('question_options')
      .select('id, is_correct')
      .eq('question_id', questionId);
    expect(teacherRead.error?.code).toBe('42501');
  });

  it('a student cannot forge is_correct onto an option somebody else authored', async () => {
    const { error: insertError } = await studentSession.from('question_options').insert({
      question_id: questionId,
      content: 'forged',
      is_correct: true,
    });
    expect(insertError?.code, 'insert into a foreign question must be refused').toBe('42501');

    // An UPDATE that the policy filters out changes nothing and raises nothing.
    const { error: updateError } = await studentSession
      .from('question_options')
      .update({ is_correct: true })
      .eq('id', otherOptionId);
    expect(updateError).toBeNull();

    const { data: untouched } = await service
      .from('question_options')
      .select('id, is_correct')
      .eq('id', otherOptionId)
      .single();
    expect(untouched?.is_correct, 'the foreign option must keep its key').toBe(false);
  });

  it('an author still writes their own options', async () => {
    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: studentId,
        name: `answer-key-student-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`own bank: ${bankError.message}`);

    const { data: ownQuestion, error: ownError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: studentId,
        bank_id: bank.id,
        type: 'mcq',
        content: `own-question-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (ownError) throw new Error(`own question: ${ownError.message}`);

    const { data: ownOption, error: optionError } = await service
      .from('question_options')
      .insert({
        question_id: ownQuestion.id,
        content: 'own option',
        is_correct: false,
        order_index: 0,
      })
      .select('id')
      .single();
    if (optionError) throw new Error(`own option: ${optionError.message}`);

    const { error: updateError } = await studentSession
      .from('question_options')
      .update({ is_correct: true })
      .eq('id', ownOption.id);
    expect(updateError).toBeNull();

    const { data: flipped } = await service
      .from('question_options')
      .select('is_correct')
      .eq('id', ownOption.id)
      .single();
    expect(flipped?.is_correct).toBe(true);
  });
});
