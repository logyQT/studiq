import { AccountType, type RequestContext } from '@studiq/authz';
import { TeacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
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

// #1171 slice 1 / #1165: the frozen assessment snapshot is split into reader-safe `snapshot`
// and key material `snapshot_key`. These tests sign in REAL users with the anon key — the exact
// PostgREST path a hostile client uses — so a service-role mock cannot hide a grant regression.

const PASSWORD = 'Snapshot1171!';
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

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

describe('Assignment snapshot key boundary (#1171)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let assignmentId: string;
  let questionId: string;
  let correctOptionId: string;
  let teacherId: string;
  let studentId: string;
  let teacherSession: SupabaseClient<Database>;
  let studentSession: SupabaseClient<Database>;

  async function createUser(label: string, accountType: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email: `snapshot-${label}-${tag}@dev.local`,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  function teacherContext(): RequestContext {
    return {
      traceId: `snapshot-${tag}`,
      userId: teacherId,
      accountType: AccountType.EDUCATOR,
      activeOrgId: orgId,
      orgRoleId: null,
      url: '/api/v1/teacher/assignments',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };
  }

  beforeAll(async () => {
    const seeded = asJson<SeededOrg>(await seedOrganization(`snapshot-${tag}`));
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
        name: `snapshot-bank-${tag}`,
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
        content: `snapshot-question-${tag}`,
        explanation: `snapshot-explanation-${tag}`,
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
    correctOptionId = options.find((option) => option.is_correct)!.id;

    // Publish through the real service: the snapshot is written by the same code the route runs.
    const assignments = new TeacherAssignmentService(() => Promise.resolve(service));
    const ctx = teacherContext();

    const created = await assignments.create({ title: `snapshot-assignment-${tag}` }, ctx);
    if (!created.success) throw new Error(`create: ${created.error}`);
    assignmentId = asJson<{ id: string }>(created.data).id;

    const added = await assignments.addQuestions(assignmentId, { questionIds: [questionId] }, ctx);
    if (!added.success) throw new Error(`addQuestions: ${added.error}`);
    const targeted = await assignments.setTargets(assignmentId, { studentIds: [studentId] }, ctx);
    if (!targeted.success) throw new Error(`setTargets: ${targeted.error}`);
    const published = await assignments.publish(assignmentId, undefined, undefined, ctx);
    if (!published.success) throw new Error(`publish: ${published.error}`);

    teacherSession = await signIn(`snapshot-teacher-${tag}@dev.local`);
    studentSession = await signIn(`snapshot-student-${tag}@dev.local`);
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId);
    for (const id of [teacherId, studentId]) {
      await service.auth.admin.deleteUser(id);
    }
  });

  it('never exposes the published key to a student session, by column or through *', async () => {
    const star = await studentSession
      .from('assignment_questions')
      .select('*')
      .eq('assignment_id', assignmentId);
    expect(star.error?.code, 'select(*) must not smuggle the snapshot key').toBe('42501');

    const key = await studentSession
      .from('assignment_questions')
      .select('snapshot_key')
      .eq('assignment_id', assignmentId);
    expect(key.error?.code).toBe('42501');
  });

  it('serves the reader-safe snapshot without any key field', async () => {
    const reader = await studentSession
      .from('assignment_questions')
      .select('question_id, order_index, snapshot, snapshot_version')
      .eq('assignment_id', assignmentId);
    expect(reader.error).toBeNull();
    expect(reader.data).toHaveLength(1);

    const row = reader.data![0];
    expect(row.snapshot).toMatchObject({
      question_answers: [{ content: 'correct' }, { content: 'wrong' }],
    });
    expect(JSON.stringify(row.snapshot), 'no key material in the reader snapshot').not.toMatch(
      /is_correct|explanation/,
    );
    expect(row.snapshot_version).toBeGreaterThanOrEqual(1);
  });

  it('no user session reads the key, the teacher included: staff reads it through the server', async () => {
    const teacherRead = await teacherSession
      .from('assignment_questions')
      .select('snapshot_key')
      .eq('assignment_id', assignmentId);
    expect(teacherRead.error?.code).toBe('42501');

    const { readAssignmentSnapshotKeys } = await import('@studiq/server/lib/assignment-snapshot');
    const keys = await readAssignmentSnapshotKeys(assignmentId);
    expect(keys.get(questionId)).toEqual({
      explanation: `snapshot-explanation-${tag}`,
      correctOptionIds: [correctOptionId],
    });
  });

  it('refuses a student write to the snapshot or its key', async () => {
    const forged = {
      explanation: 'forged',
      correctOptionIds: [correctOptionId],
    };

    // An UPDATE the policy filters out changes nothing and raises nothing (phase-1 shape).
    const { error: keyError } = await studentSession
      .from('assignment_questions')
      .update({ snapshot_key: forged })
      .eq('assignment_id', assignmentId);
    expect(keyError).toBeNull();

    const { error: contentError } = await studentSession
      .from('assignment_questions')
      .update({ snapshot: { id: questionId } })
      .eq('assignment_id', assignmentId);
    expect(contentError).toBeNull();

    const { data: stored } = await service
      .from('assignment_questions')
      .select('snapshot_key, snapshot')
      .eq('assignment_id', assignmentId)
      .single();
    const row = asJson<{ snapshot_key: { explanation: string }; snapshot: { content?: string } }>(
      stored,
    );
    expect(row.snapshot_key.explanation, 'the key must keep its published value').toBe(
      `snapshot-explanation-${tag}`,
    );
    expect(row.snapshot.content).toBe(`snapshot-question-${tag}`);
  });
});
