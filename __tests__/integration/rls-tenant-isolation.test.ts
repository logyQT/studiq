import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';

// Regression tests for issue #191 / SEC-13.
//
// The existing integration suites call `mockUser()`, which swaps the app's
// `createClient` for a SERVICE-ROLE client (helpers.ts) — they can never catch an
// RLS regression. This suite signs in REAL users with the anon key (the exact
// PostgREST access path a browser uses) and asserts:
//
//   * every public table has RLS enabled and anon has no writes,
//   * tenant isolation across two organizations (reads AND writes),
//   * the app's own legitimate cross-user reads still work (teacher dashboard),
//   * the hostile SECURITY DEFINER RPC surface is closed.
//
// Fixtures are created with the service-role client, which bypasses RLS.

const PASSWORD = 'Rls191Test!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PUBLIC_TABLES = ['plan_features', 'plan_limits', 'subscription_plans'];

const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function newClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

interface OrgBundle {
  orgId: string;
  adminRoleId: string;
  teacherRoleId: string;
  memberRoleId: string;
  bankId: string;
  questionId: string;
  quizId: string;
  assignmentId: string;
  deckId: string;
  flashcardId: string;
  attemptId: string;
  invitationToken: string;
}

describe('RLS tenant isolation (#191)', () => {
  const service = createServiceClient();

  let orgA: OrgBundle;
  let orgB: OrgBundle;

  let adminId: string;
  let teacherId: string;
  let studentId: string;
  let outsiderId: string;

  let teacherSession: SupabaseClient;
  let studentSession: SupabaseClient;
  let outsiderSession: SupabaseClient;

  async function createUser(email: string, accountType: string, label: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: label, account_type: accountType },
    });
    if (error || !data.user) throw new Error(`createUser ${label} failed: ${error?.message}`);
    return data.user.id;
  }

  /** One row in every tenant-scoped table for the org. */
  async function seedOrgBundle(data: {
    name: string;
    teacherId: string;
    studentId: string;
  }): Promise<OrgBundle> {
    const seeded = await seedOrganization(`${data.name}-${tag}`);

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: seeded.org.id,
        created_by: data.teacherId,
        name: `rls191-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError || !bank) throw new Error(`bank: ${bankError?.message}`);

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: seeded.org.id,
        created_by: data.teacherId,
        bank_id: bank.id,
        type: 'mcq',
        content: `rls191-question-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError || !question) throw new Error(`question: ${questionError?.message}`);

    const { data: quiz, error: quizError } = await service
      .from('quizzes')
      .insert({
        organization_id: seeded.org.id,
        created_by: data.teacherId,
        name: `rls191-quiz-${tag}`,
      })
      .select('id')
      .single();
    if (quizError || !quiz) throw new Error(`quiz: ${quizError?.message}`);

    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: seeded.org.id,
        created_by: data.teacherId,
        title: `rls191-assignment-${tag}`,
        status: 'published',
        question_count: 1,
        total_points: 1,
      })
      .select('id')
      .single();
    if (assignmentError || !assignment) throw new Error(`assignment: ${assignmentError?.message}`);

    await service.from('assignment_questions').insert({
      assignment_id: assignment.id,
      question_id: question.id,
      order_index: 0,
      points: 1,
    });

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert({ user_id: data.studentId, score: 1, total_questions: 1 })
      .select('id')
      .single();
    if (attemptError || !attempt) throw new Error(`attempt: ${attemptError?.message}`);

    await service.from('quiz_attempt_questions').insert({
      attempt_id: attempt.id,
      question_id: question.id,
      order_index: 0,
    });

    await service.from('student_answers').insert({
      attempt_id: attempt.id,
      question_id: question.id,
      is_correct: true,
    });

    await service.from('user_daily_activity').insert({
      user_id: data.studentId,
      date: '2026-10-20',
      reviews_count: 3,
      reviews_correct: 2,
    });

    const { data: deck, error: deckError } = await service
      .from('flashcard_decks')
      .insert({
        organization_id: seeded.org.id,
        created_by: data.teacherId,
        name: `rls191-deck-${tag}`,
      })
      .select('id')
      .single();
    if (deckError || !deck) throw new Error(`deck: ${deckError?.message}`);

    const { data: flashcard, error: flashcardError } = await service
      .from('flashcards')
      .insert({
        organization_id: seeded.org.id,
        created_by: data.teacherId,
        deck_id: deck.id,
        front: `rls191-front-${tag}`,
        back: `rls191-back-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (flashcardError || !flashcard) throw new Error(`flashcard: ${flashcardError?.message}`);

    await service.from('flashcard_practice').insert({
      user_id: data.studentId,
      flashcard_id: flashcard.id,
      was_correct: true,
    });

    const { data: report, error: reportError } = await service
      .from('question_reports')
      .insert({
        question_id: question.id,
        organization_id: seeded.org.id,
        reported_by: data.studentId,
        teacher_id: data.teacherId,
      })
      .select('id')
      .single();
    if (reportError || !report) throw new Error(`report: ${reportError?.message}`);

    await service.from('question_report_messages').insert({
      report_id: report.id,
      sender_id: data.studentId,
      body: 'rls191',
    });

    const { data: invitation, error: invitationError } = await service
      .from('invitations')
      .insert({
        email: `rls191-invitee-${tag}@dev.local`,
        organization_id: seeded.org.id,
        inviter_id: data.teacherId,
        target_org_role_id: seeded.memberRoleId,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('token')
      .single();
    if (invitationError || !invitation) throw new Error(`invitation: ${invitationError?.message}`);

    return {
      orgId: seeded.org.id,
      adminRoleId: seeded.adminRoleId,
      teacherRoleId: seeded.teacherRoleId,
      memberRoleId: seeded.memberRoleId,
      bankId: bank.id,
      questionId: question.id,
      quizId: quiz.id,
      assignmentId: assignment.id,
      deckId: deck.id,
      flashcardId: flashcard.id,
      attemptId: attempt.id,
      invitationToken: invitation.token,
    };
  }

  beforeAll(async () => {
    const managerEmail = `rls191-manager-${tag}@dev.local`;
    const teacherEmail = `rls191-teacher-${tag}@dev.local`;
    const studentEmail = `rls191-student-${tag}@dev.local`;
    const outsiderEmail = `rls191-outsider-${tag}@dev.local`;

    adminId = await createUser(managerEmail, 'manager', 'manager');
    teacherId = await createUser(teacherEmail, 'educator', 'teacher');
    studentId = await createUser(studentEmail, 'student', 'student');
    outsiderId = await createUser(outsiderEmail, 'manager', 'outsider');

    // Org A: manager (admin), teacher, student.
    orgA = await seedOrgBundle({ name: 'rls191-org-a', teacherId, studentId });
    await seedOrgMembership({
      organizationId: orgA.orgId,
      userId: adminId,
      orgRoleId: orgA.adminRoleId,
    });
    await seedOrgMembership({
      organizationId: orgA.orgId,
      userId: teacherId,
      orgRoleId: orgA.teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgA.orgId,
      userId: studentId,
      orgRoleId: orgA.memberRoleId,
    });

    // Org B: an unrelated manager + student, no shared membership with org A.
    orgB = await seedOrgBundle({
      name: 'rls191-org-b',
      teacherId: outsiderId,
      studentId: outsiderId,
    });
    await seedOrgMembership({
      organizationId: orgB.orgId,
      userId: outsiderId,
      orgRoleId: orgB.adminRoleId,
    });

    teacherSession = await signIn(teacherEmail);
    studentSession = await signIn(studentEmail);
    outsiderSession = await signIn(outsiderEmail);
  });

  afterAll(async () => {
    // question_banks/flashcards/questions reference organizations with NO ACTION,
    // so clear them before deleting the orgs.
    await service.from('questions').delete().eq('organization_id', orgA.orgId);
    await service.from('questions').delete().eq('organization_id', orgB.orgId);
    await service.from('question_banks').delete().eq('organization_id', orgA.orgId);
    await service.from('question_banks').delete().eq('organization_id', orgB.orgId);
    await service.from('flashcards').delete().eq('organization_id', orgA.orgId);
    await service.from('flashcards').delete().eq('organization_id', orgB.orgId);
    await service.from('flashcard_decks').delete().eq('organization_id', orgA.orgId);
    await service.from('flashcard_decks').delete().eq('organization_id', orgB.orgId);
    await cleanupOrganizationDeep(orgA.orgId).catch(() => {});
    await cleanupOrganizationDeep(orgB.orgId).catch(() => {});
    for (const id of [adminId, teacherId, studentId, outsiderId]) {
      if (id) await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  /**
   * PostgREST rebuilds its schema cache asynchronously after a migration
   * (`NOTIFY pgrst, 'reload schema'`), so right after a `db reset` the first RPC
   * call can briefly return PGRST202 "not found in the schema cache". Retry only
   * that error — anything else is a real failure.
   */
  async function rlsAudit() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await service.rpc('rls_audit');
      if (result.error?.code !== 'PGRST202') return result;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return service.rpc('rls_audit');
  }

  it('audits every public table: RLS on, anon read limited to pricing, no anon writes', async () => {
    const { data, error } = await rlsAudit();
    expect(error).toBeNull();

    const rows = (data ?? []) as Array<{
      table_name: string;
      rls_enabled: boolean;
      anon_select: boolean;
      anon_insert: boolean;
      authenticated_update: boolean;
      authenticated_truncate: boolean;
    }>;

    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.rls_enabled).map((r) => r.table_name)).toEqual([]);
    expect(rows.filter((r) => r.anon_insert).map((r) => r.table_name)).toEqual([]);
    expect(
      rows
        .filter((r) => r.anon_select)
        .map((r) => r.table_name)
        .sort(),
    ).toEqual(PUBLIC_TABLES);
    expect(rows.filter((r) => r.authenticated_truncate).map((r) => r.table_name)).toEqual([]);
  });

  it('positive control: org A members still read their own tenant rows', async () => {
    for (const table of [
      'question_banks',
      'groups',
      'org_roles',
      'quizzes',
      'teacher_assignments',
      'organizations',
    ]) {
      const { data, error } = await studentSession.from(table).select('id');
      expect(error, `${table} read failed`).toBeNull();
      expect(data?.length, `${table} returned no rows for a member`).toBeGreaterThan(0);
    }

    const { data: ownProfile, error: profileError } = await studentSession
      .from('profiles')
      .select('id')
      .eq('id', studentId);
    expect(profileError).toBeNull();
    expect(ownProfile).toHaveLength(1);

    // Catalog data is readable by any signed-in user.
    const { data: flags, error: flagsError } = await studentSession
      .from('feature_flags')
      .select('id');
    expect(flagsError).toBeNull();
    expect(flags?.length).toBeGreaterThan(0);
  });

  it('positive control: teacher reads same-org students (activity dashboard)', async () => {
    const checks: Array<[string, string, string]> = [
      ['profiles', 'id', studentId],
      ['user_daily_activity', 'user_id', studentId],
      ['flashcard_practice', 'user_id', studentId],
      ['quiz_attempts', 'user_id', studentId],
    ];

    for (const [table, column, value] of checks) {
      const { data, error } = await teacherSession.from(table).select('*').eq(column, value);
      expect(error, `${table} read failed`).toBeNull();
      expect(data?.length, `teacher cannot read ${table} of a same-org student`).toBeGreaterThan(0);
    }
  });

  it('cross-org reads return nothing', async () => {
    const reads: Array<[string, Record<string, string>]> = [
      ['organizations', { id: orgB.orgId }],
      ['groups', { organization_id: orgB.orgId }],
      ['org_roles', { organization_id: orgB.orgId }],
      ['question_banks', { organization_id: orgB.orgId }],
      ['quizzes', { organization_id: orgB.orgId }],
      ['teacher_assignments', { organization_id: orgB.orgId }],
      ['profiles', { id: outsiderId }],
      ['user_daily_activity', { user_id: outsiderId }],
      ['quiz_attempts', { user_id: outsiderId }],
      ['invitations', { organization_id: orgB.orgId }],
    ];

    for (const [table, filter] of reads) {
      let query = studentSession.from(table).select('*');
      for (const [column, value] of Object.entries(filter)) {
        query = query.eq(column, value);
      }
      const { data, error } = await query;
      expect(error, `${table} read errored instead of being filtered`).toBeNull();
      expect(data, `${table} leaked another organization's rows`).toEqual([]);
    }

    // A user outside both tenants sees neither.
    const { data: outsiderBanks, error: outsiderError } = await outsiderSession
      .from('question_banks')
      .select('id')
      .eq('organization_id', orgA.orgId);
    expect(outsiderError).toBeNull();
    expect(outsiderBanks).toEqual([]);
  });

  it('cross-org writes are rejected', async () => {
    // INSERT into another tenant => RLS WITH CHECK violation.
    const { error: insertError } = await studentSession.from('question_banks').insert({
      organization_id: orgB.orgId,
      created_by: outsiderId,
      name: `rls191-hostile-${tag}`,
      visibility: 'personal',
    });
    expect(insertError?.code).toBe('42501');

    // UPDATE / DELETE of another tenant's row => zero rows affected, row intact.
    const { data: updated, error: updateError } = await studentSession
      .from('question_banks')
      .update({ name: 'rls191-pwned' })
      .eq('id', orgB.bankId)
      .select('id');
    expect(updateError).toBeNull();
    expect(updated).toEqual([]);

    const { data: deleted, error: deleteError } = await studentSession
      .from('question_banks')
      .delete()
      .eq('id', orgB.bankId)
      .select('id');
    expect(deleteError).toBeNull();
    expect(deleted).toEqual([]);

    const { data: bankAfter } = await service
      .from('question_banks')
      .select('id, name')
      .eq('id', orgB.bankId)
      .single();
    expect(bankAfter?.name).toBe(`rls191-bank-${tag}`);
  });

  it('profiles stay write-locked for authenticated users (#130 regression)', async () => {
    const { error } = await studentSession
      .from('profiles')
      .update({ full_name: 'rls191-pwned' })
      .eq('id', studentId);
    expect(error?.code).toBe('42501');

    const { data: profile } = await service
      .from('profiles')
      .select('full_name')
      .eq('id', studentId)
      .single();
    expect(profile?.full_name).not.toBe('rls191-pwned');
  });

  it('org_members: self-escalation to admin is blocked, managers can change others', async () => {
    const { data: escalated, error: escalateError } = await studentSession
      .from('org_members')
      .update({ org_role_id: orgA.adminRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', studentId)
      .select('user_id, org_role_id');
    expect(escalateError).toBeNull();
    expect(escalated).toEqual([]);

    const { data: unchanged } = await service
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', orgA.orgId)
      .eq('user_id', studentId)
      .single();
    expect(unchanged?.org_role_id).toBe(orgA.memberRoleId);

    // A teacher managing another member still works (app layer allows it).
    const { data: promoted, error: promoteError } = await teacherSession
      .from('org_members')
      .update({ org_role_id: orgA.teacherRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', studentId)
      .select('user_id, org_role_id');
    expect(promoteError).toBeNull();
    expect(promoted).toHaveLength(1);
    expect(promoted?.[0]?.org_role_id).toBe(orgA.teacherRoleId);

    // Restore for any later assertions.
    await service
      .from('org_members')
      .update({ org_role_id: orgA.memberRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', studentId);
  });

  it('hostile RPC surface is closed', async () => {
    // anon cannot execute get_teacher_stats at all (no EXECUTE grant).
    const anon = newClient();
    const { error: anonError } = await anon.rpc('get_teacher_stats', {
      p_flashcard_ids: [orgA.flashcardId],
      p_user_id: teacherId,
    });
    expect(anonError?.code).toBe('42501');

    // authenticated cannot execute the service-role-only plan function.
    const { error: planError } = await studentSession.rpc('apply_org_plan', {
      p_org_id: orgA.orgId,
      p_plan: 'hub',
    });
    expect(planError?.code).toBe('42501');

    // authenticated cannot ask for another user's dashboard.
    const { error: otherUserError } = await studentSession.rpc('get_teacher_stats', {
      p_flashcard_ids: [orgA.flashcardId],
      p_user_id: teacherId,
    });
    expect(otherUserError?.code).toBe('42501');

    // ...and a crafted card list from another tenant yields an empty summary.
    const { data: stats, error: statsError } = await studentSession.rpc('get_teacher_stats', {
      p_flashcard_ids: [orgB.flashcardId],
      p_user_id: studentId,
    });
    expect(statsError).toBeNull();
    const summary = (stats as { summary?: { totalPractices?: number; totalFlashcards?: number } })
      .summary;
    expect(summary?.totalFlashcards).toBe(0);
    expect(summary?.totalPractices).toBe(0);
  });
});
