import { AccountType, type RequestContext } from '@studiq/authz';
import { TeacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
import { mockUser } from '#test/integration/helpers';
import { createNextRequestWithParams } from '#test/integration/test-utils';
import {
  cleanupOrganizationDeep,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';

// #1171 slice 1b-i / #1165: the frozen assessment snapshot is split into reader-safe `snapshot`
// and key material `snapshot_key`, and the assignment row that owns the snapshot can only be
// written by its author. These tests sign in REAL users with the anon key — the exact PostgREST
// path a hostile client uses — so a service-role mock cannot hide a grant or policy regression.

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
  let wrongOptionId: string;
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
    wrongOptionId = options.find((option) => !option.is_correct)!.id;

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
    await service.from('teacher_assignments').update({ show_results: true }).eq('id', assignmentId);
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

  it('serves the reader-safe snapshot through the server, not as a client-readable row', async () => {
    // Slice 1 froze the reader-safe snapshot and revoked only the key. Slice 2 closed the rest of
    // the column: the snapshot carries the stem and options, so a student's own live item set is no
    // longer client-readable either (R14). `assignment_questions` is staff-only; the attempt reads
    // it with the service role after proving ownership.
    const reader = await studentSession
      .from('assignment_questions')
      .select('question_id, order_index, snapshot, snapshot_version')
      .eq('assignment_id', assignmentId);
    expect(reader.error, 'filtered by the policy, not refused').toBeNull();
    expect(reader.data).toEqual([]);

    const staff = await teacherSession
      .from('assignment_questions')
      .select('snapshot, snapshot_version')
      .eq('assignment_id', assignmentId);
    expect(staff.error).toBeNull();
    expect(staff.data).toHaveLength(1);
    const row = staff.data![0]!;
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

    const { data: stored } = await service
      .from('assignment_questions')
      .select('snapshot_key')
      .eq('assignment_id', assignmentId)
      .single();
    expect(stored?.snapshot_key).toEqual({
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

  it('replays the forge chain: a student cannot claim the assignment and rewrite its key', async () => {
    // 1. Creating a self-owned assignment is refused (no self-owned rows to claim).
    const created = await studentSession
      .from('teacher_assignments')
      .insert({ organization_id: orgId, created_by: studentId, title: `forged-${tag}` })
      .select('id');
    expect(created.error?.code, 'a student cannot create an assignment').toBe('42501');

    // 2. Claiming an existing assignment (`created_by`) affects no row.
    const claim = await studentSession
      .from('teacher_assignments')
      .update({ created_by: studentId })
      .eq('id', assignmentId)
      .select('id');
    expect(claim.error).toBeNull();
    expect(claim.data).toEqual([]);

    // 3. `Prefer: return=minimal` (no `.select()`) is the form that does not need the revoked
    //    SELECT — the exact shape the reviewer's exploit used. It must still write no row.
    const minimal = await studentSession
      .from('assignment_questions')
      .update({
        snapshot: { id: questionId, content: 'FORGED', type: 'mcq', question_answers: [] },
        snapshot_key: { explanation: 'FORGED', correctOptionIds: [wrongOptionId] },
      })
      .eq('assignment_id', assignmentId)
      .eq('question_id', questionId);
    expect(minimal.error).toBeNull();

    // 4. Targets and links are not writable for an assignment the student does not own.
    const targetWrite = await studentSession
      .from('assignment_targets')
      .update({ student_id: studentId })
      .eq('assignment_id', assignmentId);
    expect(targetWrite.error).toBeNull();
    const linkInsert = await studentSession
      .from('assignment_questions')
      .insert({ assignment_id: assignmentId, question_id: questionId })
      .select('id');
    expect(['42501', '23505']).toContain(linkInsert.error?.code);

    const del = await studentSession
      .from('teacher_assignments')
      .delete()
      .eq('id', assignmentId)
      .select('id');
    expect(del.data).toEqual([]);

    // Nothing changed: the assignment still belongs to the teacher and the published key is
    // intact (read with the service role, the only reader of `snapshot_key`).
    const { data: stored } = await service
      .from('assignment_questions')
      .select('snapshot, snapshot_key')
      .eq('assignment_id', assignmentId)
      .single();
    const frozen = asJson<{
      snapshot_key: { correctOptionIds: string[] };
      snapshot: { content: string };
    }>(stored);
    expect(frozen.snapshot_key.correctOptionIds).toEqual([correctOptionId]);
    expect(frozen.snapshot.content).toBe(`snapshot-question-${tag}`);

    // 5. The forged key does not reach grading: the wrong option still scores 0.
    mockUser({ id: studentId, role: 'student' });
    const { request: startReq, params: startParams } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
    );
    const started = await assignmentStart(startReq, { params: startParams });
    expect(started.status).toBe(200);
    const attempt = (await json<{ data: { id: string } }>(started)).data;

    const { request: submitReq, params: submitParams } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [{ questionId, selectedAnswerId: wrongOptionId }],
        }),
      },
    );
    const submitted = await attemptSubmit(submitReq, { params: submitParams });
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    expect((await json<{ data: { score: number } }>(submitted)).data.score).toBe(0);
  });

  it('a teacher session can still author an assignment and its targets and items', async () => {
    const { data: own, error } = await teacherSession
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        title: `teacher-rls-${tag}`,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    if (!own) throw new Error('teacher could not create an assignment');

    const renamed = await teacherSession
      .from('teacher_assignments')
      .update({ title: `teacher-rls-renamed-${tag}` })
      .eq('id', own.id)
      .select('id');
    expect(renamed.data).toHaveLength(1);

    const target = await teacherSession
      .from('assignment_targets')
      .insert({ assignment_id: own.id, student_id: studentId })
      .select('id');
    expect(target.error).toBeNull();
    expect(target.data).toHaveLength(1);

    const link = await teacherSession
      .from('assignment_questions')
      .insert({ assignment_id: own.id, question_id: questionId })
      .select('id');
    expect(link.error).toBeNull();
    expect(link.data).toHaveLength(1);

    await service.from('teacher_assignments').delete().eq('id', own.id);
  });
});
