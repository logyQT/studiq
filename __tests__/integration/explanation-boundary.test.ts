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

// #1180 / #1172 slice A: the explanation is key-bearing, so it is closed at the DATABASE boundary
// with `is_correct`. These tests sign in REAL users with the anon key — the exact PostgREST path a
// browser (or a hostile client) uses — so a service-role mock cannot hide a column-grant regression.
// The generated `search_vector` indexes the explanation, so it is part of the same boundary.

const PASSWORD = 'Explanation1180!';
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SeededOrg {
  org: { id: string };
  teacherRoleId: string;
  memberRoleId: string;
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

describe('Explanation boundary (#1180)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let questionId: string;
  let explanation: string;

  let teacherId: string;
  let studentId: string;

  let teacherSession: SupabaseClient<Database>;
  let studentSession: SupabaseClient<Database>;

  async function createUser(label: string, accountType: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email: `explanation-${label}-${tag}@dev.local`,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    const seeded = asJson<SeededOrg>(await seedOrganization(`explanation-${tag}`));
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
        name: `explanation-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`bank: ${bankError.message}`);

    explanation = `explanation-secret-${tag}`;
    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        bank_id: bank.id,
        type: 'mcq',
        content: `explanation-question-${tag}`,
        explanation,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError) throw new Error(`question: ${questionError.message}`);
    questionId = question.id;

    const { error: optionError } = await service.from('question_options').insert([
      { question_id: questionId, content: 'correct', is_correct: true, order_index: 0 },
      { question_id: questionId, content: 'wrong', is_correct: false, order_index: 1 },
    ]);
    if (optionError) throw new Error(`options: ${optionError.message}`);

    teacherSession = await signIn(`explanation-teacher-${tag}@dev.local`);
    studentSession = await signIn(`explanation-student-${tag}@dev.local`);
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId);
    for (const id of [teacherId, studentId]) {
      await service.auth.admin.deleteUser(id);
    }
  });

  it('a student session cannot select the explanation, by column or through *', async () => {
    const keyed = await studentSession
      .from('questions')
      .select('id, content, explanation')
      .eq('id', questionId);
    expect(keyed.error?.code, 'explanation must not be selectable').toBe('42501');

    const star = await studentSession.from('questions').select('*').eq('id', questionId);
    expect(star.error?.code, 'select(*) must not smuggle the explanation').toBe('42501');

    const reader = await studentSession
      .from('questions')
      .select('id, content, type, status, visibility, bank_id, version, created_at, updated_at')
      .eq('id', questionId)
      .single();
    expect(reader.error).toBeNull();
    expect(reader.data?.content).toBe(`explanation-question-${tag}`);
    expect(reader.data).not.toHaveProperty('explanation');
    expect(reader.data).not.toHaveProperty('model_answer');
    expect(reader.data).not.toHaveProperty('search_vector');
  });

  it('the generated search vector is closed with it: it indexes the explanation', async () => {
    const vector = await studentSession
      .from('questions')
      .select('id, search_vector')
      .eq('id', questionId);
    expect(vector.error?.code, 'search_vector echoes the explanation').toBe('42501');
  });

  it('no user session reads the explanation, the teacher included: staff read it server-side', async () => {
    const teacherRead = await teacherSession
      .from('questions')
      .select('id, explanation')
      .eq('id', questionId);
    expect(teacherRead.error?.code).toBe('42501');
  });

  it('the server key reader still returns it for the ids it is given', async () => {
    const { data, error } = await service
      .from('questions')
      .select('id, explanation')
      .eq('id', questionId)
      .single();
    expect(error).toBeNull();
    expect(data?.explanation).toBe(explanation);
  });

  it('an author still writes their own explanation', async () => {
    const { data: ownBank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        name: `explanation-own-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`own bank: ${bankError.message}`);

    const { data: own, error: ownError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        bank_id: ownBank.id,
        type: 'mcq',
        content: `explanation-own-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (ownError) throw new Error(`own question: ${ownError.message}`);

    const { error: updateError } = await teacherSession
      .from('questions')
      .update({ explanation: `rewritten-${tag}` })
      .eq('id', own.id);
    expect(updateError).toBeNull();

    const { data: stored } = await service
      .from('questions')
      .select('explanation')
      .eq('id', own.id)
      .single();
    expect(stored?.explanation).toBe(`rewritten-${tag}`);
  });
});
