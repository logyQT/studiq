import { AccountType, type RequestContext } from '@studiq/authz';
import { invitationService } from '@studiq/server/services/invitation.service';
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
  /** Report authored by `studentId` and addressed to `teacherId`. */
  reportId: string;
  /** Report authored by `peerId` and addressed to `teacherId` (#276 control). */
  peerReportId: string | null;
}

describe('RLS tenant isolation (#191)', () => {
  const service = createServiceClient();

  let orgA: OrgBundle;
  let orgB: OrgBundle;

  let adminId: string;
  let teacherId: string;
  let studentId: string;
  let outsiderId: string;
  let peerId: string;
  let invitee1Id: string;
  let invitee2Id: string;
  let lonerId: string;

  let adminSession: SupabaseClient;
  let teacherSession: SupabaseClient;
  let studentSession: SupabaseClient;
  let outsiderSession: SupabaseClient;
  let lonerSession: SupabaseClient;

  /** RequestContext for driving the service-role accept flow. */
  function acceptCtx(userId: string): RequestContext {
    return {
      userId,
      accountType: AccountType.STUDENT,
      traceId: 'rls191-test',
      url: '',
      method: 'POST',
      activeOrgId: null,
      orgRoleId: null,
      groupIds: [],
      permissionScopes: {},
    };
  }

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
    /** When set, also seed a report between this third party and the teacher. */
    peerId?: string;
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

    // #276 positive control: a same-org report between two OTHER users, so only
    // the org-membership clause of "Report participants or org members" can make
    // it readable for a plain member.
    let peerReportId: string | null = null;
    if (data.peerId) {
      const { data: peerReport, error: peerReportError } = await service
        .from('question_reports')
        .insert({
          question_id: question.id,
          organization_id: seeded.org.id,
          reported_by: data.peerId,
          teacher_id: data.teacherId,
        })
        .select('id')
        .single();
      if (peerReportError || !peerReport) {
        throw new Error(`peer report: ${peerReportError?.message}`);
      }
      peerReportId = peerReport.id;
    }

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
      reportId: report.id,
      peerReportId,
    };
  }

  beforeAll(async () => {
    const managerEmail = `rls191-manager-${tag}@dev.local`;
    const teacherEmail = `rls191-teacher-${tag}@dev.local`;
    const studentEmail = `rls191-student-${tag}@dev.local`;
    const outsiderEmail = `rls191-outsider-${tag}@dev.local`;
    const peerEmail = `rls191-peer-${tag}@dev.local`;
    const invitee1Email = `rls191-invitee1-${tag}@dev.local`;
    const invitee2Email = `rls191-invitee2-${tag}@dev.local`;
    const lonerEmail = `rls191-loner-${tag}@dev.local`;

    adminId = await createUser(managerEmail, 'manager', 'manager');
    teacherId = await createUser(teacherEmail, 'educator', 'teacher');
    studentId = await createUser(studentEmail, 'student', 'student');
    outsiderId = await createUser(outsiderEmail, 'manager', 'outsider');
    peerId = await createUser(peerEmail, 'student', 'peer');
    invitee1Id = await createUser(invitee1Email, 'student', 'invitee1');
    invitee2Id = await createUser(invitee2Email, 'student', 'invitee2');
    lonerId = await createUser(lonerEmail, 'student', 'loner');

    // Org A: manager (admin), teacher, student.
    orgA = await seedOrgBundle({ name: 'rls191-org-a', teacherId, studentId, peerId });
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
    await seedOrgMembership({
      organizationId: orgA.orgId,
      userId: peerId,
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

    adminSession = await signIn(managerEmail);
    teacherSession = await signIn(teacherEmail);
    studentSession = await signIn(studentEmail);
    outsiderSession = await signIn(outsiderEmail);
    lonerSession = await signIn(lonerEmail);
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
    await service.from('flashcard_review_state').delete().eq('user_id', lonerId);
    await service.from('user_study_settings').delete().eq('user_id', lonerId);
    await service.from('flashcards').delete().eq('created_by', lonerId);
    await service.from('flashcard_decks').delete().eq('created_by', lonerId);
    for (const id of [
      adminId,
      teacherId,
      studentId,
      outsiderId,
      peerId,
      invitee1Id,
      invitee2Id,
      lonerId,
    ]) {
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

    // The org-wide manager report inbox (#276) relies on the DB floor being
    // org-scoped. Read a report between TWO OTHER users: the participant clauses
    // (`reported_by = auth.uid()`, `teacher_id = auth.uid()`) cannot satisfy it,
    // so only `organization_id IN rls_caller_org_ids()` can. Removing that
    // clause would silently reintroduce #276 with a green suite.
    expect(orgA.peerReportId).toBeTruthy();
    const { data: orgReport, error: orgReportError } = await studentSession
      .from('question_reports')
      .select('id')
      .eq('id', orgA.peerReportId as string);
    expect(orgReportError, 'question_reports read failed').toBeNull();
    expect(
      orgReport?.map((r) => r.id),
      'member cannot read a same-org report',
    ).toEqual([orgA.peerReportId]);

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

  it('org admin session reads, resolves its role and replies to a non-participant report (#276)', async () => {
    // The exact production path of #276 with the manager's own JWT: the service
    // reads `question_reports` and `org_roles` through PostgREST as this user and
    // writes the reply with `question_report_messages` RLS in force.
    expect(adminId).not.toBe(studentId);
    expect(adminId).not.toBe(teacherId);

    const { data: report, error: reportError } = await adminSession
      .from('question_reports')
      .select('id, reported_by, teacher_id, reporter:reported_by(id), teacher:teacher_id(id)')
      .eq('id', orgA.reportId)
      .single();
    expect(reportError).toBeNull();
    expect(report).toMatchObject({
      id: orgA.reportId,
      reported_by: studentId,
      teacher_id: teacherId,
    });

    // The role lookup `resolveOrgWideReportScope` issues, including the exact
    // predicate it now requires (`is_system` + `admin`).
    const { data: role, error: roleError } = await adminSession
      .from('org_roles')
      .select('name, is_system')
      .eq('id', orgA.adminRoleId)
      .eq('organization_id', orgA.orgId)
      .single();
    expect(roleError).toBeNull();
    expect(role).toMatchObject({ name: 'admin', is_system: true });

    const { data: reply, error: replyError } = await adminSession
      .from('question_report_messages')
      .insert({ report_id: orgA.reportId, sender_id: adminId, body: 'rls191 manager reply' })
      .select('id')
      .single();
    expect(replyError).toBeNull();
    expect(reply?.id).toBeTruthy();
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
      ['question_reports', { organization_id: orgB.orgId }],
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

  it('org_members: self-escalation to admin is blocked, only a manager can change others (B2)', async () => {
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

    // A non-manager cannot promote (or remove) a peer. This is the second
    // account escalation path: `user_id <> auth.uid()` alone was not enough.
    await seedOrgMembership({
      organizationId: orgA.orgId,
      userId: peerId,
      orgRoleId: orgA.memberRoleId,
    });

    const { data: peerEscalated, error: peerEscalateError } = await studentSession
      .from('org_members')
      .update({ org_role_id: orgA.adminRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', peerId)
      .select('user_id, org_role_id');
    expect(peerEscalateError).toBeNull();
    expect(peerEscalated).toEqual([]);

    const { data: peerAfterUpdate } = await service
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', orgA.orgId)
      .eq('user_id', peerId)
      .single();
    expect(peerAfterUpdate?.org_role_id).toBe(orgA.memberRoleId);

    const { data: peerDeleted, error: peerDeleteError } = await studentSession
      .from('org_members')
      .delete()
      .eq('organization_id', orgA.orgId)
      .eq('user_id', peerId)
      .select('user_id');
    expect(peerDeleteError).toBeNull();
    expect(peerDeleted).toEqual([]);

    // A manager can promote and remove other members.
    const { data: promoted, error: promoteError } = await adminSession
      .from('org_members')
      .update({ org_role_id: orgA.teacherRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', peerId)
      .select('user_id, org_role_id');
    expect(promoteError).toBeNull();
    expect(promoted).toHaveLength(1);
    expect(promoted?.[0]?.org_role_id).toBe(orgA.teacherRoleId);

    const { data: removed, error: removeError } = await adminSession
      .from('org_members')
      .delete()
      .eq('organization_id', orgA.orgId)
      .eq('user_id', peerId)
      .select('user_id');
    expect(removeError).toBeNull();
    expect(removed).toHaveLength(1);
  });

  it('invitations: a member cannot mint or retarget role-escalating invites (B1)', async () => {
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // A plain member cannot target the admin role...
    const { error: adminTargetError } = await studentSession.from('invitations').insert({
      email: `rls191-b1-admin-${tag}@dev.local`,
      organization_id: orgA.orgId,
      inviter_id: studentId,
      target_org_role_id: orgA.adminRoleId,
      expires_at: expiry,
    });
    expect(adminTargetError?.code).toBe('42501');

    // ...nor mint any other invite (no member.manage, member role is not teacher).
    const { error: memberTargetError } = await studentSession.from('invitations').insert({
      email: `rls191-b1-member-${tag}@dev.local`,
      organization_id: orgA.orgId,
      inviter_id: studentId,
      target_org_role_id: orgA.memberRoleId,
      expires_at: expiry,
    });
    expect(memberTargetError?.code).toBe('42501');

    // Spoofing the inviter is rejected by the INSERT WITH CHECK.
    const { error: spoofError } = await studentSession.from('invitations').insert({
      email: `rls191-b1-spoof-${tag}@dev.local`,
      organization_id: orgA.orgId,
      inviter_id: teacherId,
      target_org_role_id: orgA.memberRoleId,
      expires_at: expiry,
    });
    expect(spoofError?.code).toBe('42501');

    // The teacher flow may invite students (member role) only.
    const { data: teacherInvite, error: teacherInviteError } = await teacherSession
      .from('invitations')
      .insert({
        email: `rls191-b1-teacher-${tag}@dev.local`,
        organization_id: orgA.orgId,
        inviter_id: teacherId,
        target_org_role_id: orgA.memberRoleId,
        expires_at: expiry,
      })
      .select('id, token')
      .single();
    expect(teacherInviteError).toBeNull();

    const { error: teacherAdminError } = await teacherSession.from('invitations').insert({
      email: `rls191-b1-teacher-admin-${tag}@dev.local`,
      organization_id: orgA.orgId,
      inviter_id: teacherId,
      target_org_role_id: orgA.adminRoleId,
      expires_at: expiry,
    });
    expect(teacherAdminError?.code).toBe('42501');

    // Managers may invite into any role.
    const { data: managerInvite, error: managerInviteError } = await adminSession
      .from('invitations')
      .insert({
        email: `rls191-b1-manager-${tag}@dev.local`,
        organization_id: orgA.orgId,
        inviter_id: adminId,
        target_org_role_id: orgA.adminRoleId,
        expires_at: expiry,
      })
      .select('id')
      .single();
    expect(managerInviteError).toBeNull();

    // A member cannot retarget an existing invite to admin...
    const { data: retargeted, error: retargetError } = await studentSession
      .from('invitations')
      .update({ target_org_role_id: orgA.adminRoleId })
      .eq('id', teacherInvite?.id as string)
      .select('id');
    expect(retargetError).toBeNull();
    expect(retargeted).toEqual([]);

    // ...nor delete a manager-created invite.
    const { data: deleted, error: deleteError } = await studentSession
      .from('invitations')
      .delete()
      .eq('id', managerInvite?.id as string)
      .select('id');
    expect(deleteError).toBeNull();
    expect(deleted).toEqual([]);
  });

  it('invites: accept applies the granted role, and a used token can never re-promote (B6)', async () => {
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invite, error } = await service
      .from('invitations')
      .insert({
        email: `rls191-b6-${tag}@dev.local`,
        organization_id: orgA.orgId,
        inviter_id: adminId,
        target_org_role_id: orgA.adminRoleId,
        expires_at: expiry,
      })
      .select('token')
      .single();
    expect(error).toBeNull();

    const accepted = await invitationService.acceptInvitation(
      acceptCtx(invitee1Id),
      invite?.token as string,
    );
    expect(accepted.success).toBe(true);

    let { data: membership } = await service
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', orgA.orgId)
      .eq('user_id', invitee1Id)
      .single();
    expect(membership?.org_role_id).toBe(orgA.adminRoleId);

    // A manager demotes them; replaying the same token must not restore admin.
    const { error: demoteError } = await adminSession
      .from('org_members')
      .update({ org_role_id: orgA.memberRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', invitee1Id);
    expect(demoteError).toBeNull();

    const reaccepted = await invitationService.acceptInvitation(
      acceptCtx(invitee1Id),
      invite?.token as string,
    );
    expect(reaccepted.success).toBe(false);
    expect(reaccepted.error).toBe('GONE');

    ({ data: membership } = await service
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', orgA.orgId)
      .eq('user_id', invitee1Id)
      .single());
    expect(membership?.org_role_id).toBe(orgA.memberRoleId);
  });

  it('invites: a demoted inviter cannot promote an invitee at accept time (B1)', async () => {
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invite } = await service
      .from('invitations')
      .insert({
        email: `rls191-demoted-${tag}@dev.local`,
        organization_id: orgA.orgId,
        inviter_id: adminId,
        target_org_role_id: orgA.adminRoleId,
        expires_at: expiry,
      })
      .select('token')
      .single();

    // Demote the inviter before the token is used.
    await service
      .from('org_members')
      .update({ org_role_id: orgA.memberRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', adminId);

    const result = await invitationService.acceptInvitation(
      acceptCtx(invitee2Id),
      invite?.token as string,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('GONE');

    const { data: membership } = await service
      .from('org_members')
      .select('user_id')
      .eq('organization_id', orgA.orgId)
      .eq('user_id', invitee2Id)
      .maybeSingle();
    expect(membership).toBeNull();

    // Restore the manager for the remaining tests.
    await service
      .from('org_members')
      .update({ org_role_id: orgA.adminRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', adminId);
  });

  it('organizations.plan cannot be changed through PostgREST (B3)', async () => {
    const { data: memberUpdate } = await studentSession
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', orgA.orgId)
      .select('id');
    expect(memberUpdate).toEqual([]);

    // A manager passes the UPDATE policy but the guard trigger rejects the plan
    // change (billing is service-role only).
    const { error: planError } = await adminSession
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', orgA.orgId)
      .select('id');
    expect(planError?.code).toBe('42501');

    const { data: unchanged } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgA.orgId)
      .single();
    expect(unchanged?.plan).toBe('launch');

    // Rename (the legitimate settings update) still works for a manager.
    const { data: renamed, error: renameError } = await adminSession
      .from('organizations')
      .update({ name: `rls191-renamed-${tag}` })
      .eq('id', orgA.orgId)
      .select('id, name');
    expect(renameError).toBeNull();
    expect(renamed).toHaveLength(1);
  });

  it('seat pools/assignments: members read their own seat but cannot write (B4)', async () => {
    const { data: pool, error: poolCreateError } = await service
      .from('org_seat_pools')
      .insert({ organization_id: orgA.orgId, plan_key: 'hub', total: 5, assigned: 0 })
      .select('id')
      .single();
    expect(poolCreateError).toBeNull();

    // Self-service premium seat through PostgREST is impossible.
    const { error: assignError } = await studentSession.from('org_seat_assignments').insert({
      organization_id: orgA.orgId,
      pool_id: pool?.id as string,
      user_id: studentId,
    });
    expect(assignError?.code).toBe('42501');

    const { error: memberPoolError } = await studentSession.from('org_seat_pools').insert({
      organization_id: orgA.orgId,
      plan_key: 'campus',
      total: 3,
      assigned: 0,
    });
    expect(memberPoolError?.code).toBe('42501');

    // The service assigns a seat; the member must still be able to read it
    // (getSeatPlanKey runs on the user session for every feature/limit check).
    await service.from('org_seat_assignments').insert({
      organization_id: orgA.orgId,
      pool_id: pool?.id as string,
      user_id: studentId,
    });

    const { data: ownSeat, error: seatReadError } = await studentSession
      .from('org_seat_assignments')
      .select('id')
      .eq('user_id', studentId);
    expect(seatReadError).toBeNull();
    expect(ownSeat).toHaveLength(1);

    // Managers can still create pools.
    const { error: managerPoolError } = await adminSession.from('org_seat_pools').insert({
      organization_id: orgA.orgId,
      plan_key: 'campus',
      total: 3,
      assigned: 0,
    });
    expect(managerPoolError).toBeNull();
  });

  it('roles, permissions and groups: reads stay org-wide, writes require the capability (B5)', async () => {
    const { error: roleInsertError } = await studentSession.from('org_roles').insert({
      organization_id: orgA.orgId,
      name: `rls191-custom-member-${tag}`,
      display_name: `Custom member ${tag}`,
      description: null,
      is_system: false,
    });
    expect(roleInsertError?.code).toBe('42501');

    const { data: renamedRole } = await studentSession
      .from('org_roles')
      .update({ name: 'pwned' })
      .eq('id', orgA.adminRoleId)
      .select('id');
    expect(renamedRole).toEqual([]);

    const { error: permError } = await studentSession.from('org_role_permissions').insert({
      org_role_id: orgA.memberRoleId,
      permission_name: 'deck.update',
      scope: 'organization',
    });
    expect(permError?.code).toBe('42501');

    // Groups: a member cannot create a group or join one (that would grant
    // group-scoped read access to arbitrary content).
    const { error: groupError } = await studentSession.from('groups').insert({
      organization_id: orgA.orgId,
      name: `rls191-group-member-${tag}`,
      description: null,
      is_default: false,
    });
    expect(groupError?.code).toBe('42501');

    const { data: group } = await service
      .from('groups')
      .insert({
        organization_id: orgA.orgId,
        name: `rls191-group-${tag}`,
        description: null,
        is_default: false,
      })
      .select('id')
      .single();

    const { error: selfJoinError } = await studentSession.from('group_members').insert({
      group_id: group?.id as string,
      user_id: studentId,
      role: 'member',
    });
    expect(selfJoinError?.code).toBe('42501');

    // Teachers hold group.manage and still manage rosters.
    const { error: teacherGroupError } = await teacherSession.from('group_members').insert({
      group_id: group?.id as string,
      user_id: studentId,
      role: 'member',
    });
    expect(teacherGroupError).toBeNull();

    // Managers hold member.manage: they may create roles, but a system role's
    // identity is immutable (the manager helper keys on the `admin` name).
    const { error: managerRoleError } = await adminSession.from('org_roles').insert({
      organization_id: orgA.orgId,
      name: `rls191-custom-manager-${tag}`,
      display_name: `Custom manager ${tag}`,
      description: null,
      is_system: false,
    });
    expect(managerRoleError).toBeNull();

    const { error: renameSystemError } = await adminSession
      .from('org_roles')
      .update({ name: 'pwned' })
      .eq('id', orgA.adminRoleId)
      .select('id');
    expect(renameSystemError?.code).toBe('42501');
  });

  it('a seated custom role cannot resolve manager authority (RLS mirrors FeatureResolver)', async () => {
    // A custom role from the role builder has ZERO org_role_features rows, so
    // the org-plan fallback used to grant every plan capability. FeatureResolver
    // strips ADMIN_ONLY_FEATURES (org.manage/member.manage/role.builder) for a
    // seated non-admin role; RLS must not be wider (review-1-r2 B1).
    const seatedEmail = `rls191-seated-custom-${tag}@dev.local`;
    const unseatedEmail = `rls191-unseated-custom-${tag}@dev.local`;

    const { data: customRole, error: customRoleError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgA.orgId,
        name: `rls191-custom-seated-${tag}`,
        display_name: `Custom seated ${tag}`,
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    expect(customRoleError).toBeNull();

    const { count: roleFeatureCount } = await service
      .from('org_role_features')
      .select('id', { count: 'exact', head: true })
      .eq('org_role_id', customRole?.id as string);
    expect(roleFeatureCount).toBe(0);

    const seatedCustomId = await createUser(seatedEmail, 'student', 'seated-custom');
    const unseatedCustomId = await createUser(unseatedEmail, 'student', 'unseated-custom');

    try {
      for (const userId of [seatedCustomId, unseatedCustomId]) {
        await seedOrgMembership({
          organizationId: orgA.orgId,
          userId,
          orgRoleId: customRole?.id as string,
        });
      }

      const { data: pool, error: poolError } = await service
        .from('org_seat_pools')
        .insert({ organization_id: orgA.orgId, plan_key: 'master', total: 5, assigned: 0 })
        .select('id')
        .single();
      expect(poolError).toBeNull();

      const { error: seatError } = await service.from('org_seat_assignments').insert({
        organization_id: orgA.orgId,
        pool_id: pool?.id as string,
        user_id: seatedCustomId,
      });
      expect(seatError).toBeNull();

      const unseatedSession = await signIn(unseatedEmail);
      const seatedSession = await signIn(seatedEmail);

      // Control: a NON-seated custom role keeps today's plan entitlements.
      const { data: unseatedManager } = await unseatedSession.rpc('rls_caller_is_org_manager', {
        p_organization_id: orgA.orgId,
      });
      expect(unseatedManager).toBe(true);

      const { data: unseatedGroupManage } = await unseatedSession.rpc(
        'rls_caller_has_org_feature',
        { p_organization_id: orgA.orgId, p_feature: 'group.manage' },
      );
      expect(unseatedGroupManage).toBe(true);

      // A seat must not add management authority the app withholds.
      const { data: seatedManager } = await seatedSession.rpc('rls_caller_is_org_manager', {
        p_organization_id: orgA.orgId,
      });
      expect(seatedManager).toBe(false);

      // Peer promotion is filtered out by the org_members UPDATE policy.
      const { data: promoted, error: promoteError } = await seatedSession
        .from('org_members')
        .update({ org_role_id: orgA.adminRoleId })
        .eq('organization_id', orgA.orgId)
        .eq('user_id', studentId)
        .select('user_id, org_role_id');
      expect(promoteError).toBeNull();
      expect(promoted).toEqual([]);

      const { data: studentMembership } = await service
        .from('org_members')
        .select('org_role_id')
        .eq('organization_id', orgA.orgId)
        .eq('user_id', studentId)
        .single();
      expect(studentMembership?.org_role_id).toBe(orgA.memberRoleId);

      // The B1 admin-invite escalation stays closed for this class of user.
      const { error: inviteError } = await seatedSession.from('invitations').insert({
        email: `rls191-seated-admin-${tag}@dev.local`,
        organization_id: orgA.orgId,
        inviter_id: seatedCustomId,
        target_org_role_id: orgA.adminRoleId,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(inviteError?.code).toBe('42501');

      // ...and so does writing a seat assignment.
      const { error: selfSeatError } = await seatedSession.from('org_seat_assignments').insert({
        organization_id: orgA.orgId,
        pool_id: pool?.id as string,
        user_id: seatedCustomId,
      });
      expect(selfSeatError?.code).toBe('42501');

      // The system admin role is untouched by the seat carve-out.
      const { data: adminManager } = await adminSession.rpc('rls_caller_is_org_manager', {
        p_organization_id: orgA.orgId,
      });
      expect(adminManager).toBe(true);
    } finally {
      await service.from('org_seat_assignments').delete().eq('organization_id', orgA.orgId);
      await service.from('org_seat_pools').delete().eq('organization_id', orgA.orgId);
      await service.from('org_members').delete().in('user_id', [seatedCustomId, unseatedCustomId]);
      await service
        .from('org_roles')
        .delete()
        .eq('id', customRole?.id as string);
      for (const userId of [seatedCustomId, unseatedCustomId]) {
        await service.auth.admin.deleteUser(userId).catch(() => {});
      }
    }
  });

  it('a seated custom role resolves the SEAT plan, not the org plan (review-2-r3 B1)', async () => {
    // Zero-`org_role_features` custom role in a `launch` org (group.manage) with
    // a `pro` seat (advanced.stats, NO group.manage). FeatureResolver resolves a
    // seated actor against the seat plan only, so RLS must agree; before the r4
    // fix the org-plan fallback still granted group.manage through PostgREST.
    const seatedEmail = `rls191-seat-plan-${tag}@dev.local`;
    const controlEmail = `rls191-seat-plan-control-${tag}@dev.local`;

    const { data: orgPlan } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgA.orgId)
      .single();
    expect(orgPlan?.plan).toBe('launch');

    const { data: customRole, error: customRoleError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgA.orgId,
        name: `rls191-custom-seatplan-${tag}`,
        display_name: `Custom seat plan ${tag}`,
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    expect(customRoleError).toBeNull();

    const seatedId = await createUser(seatedEmail, 'student', 'seated-seat-plan');
    const controlId = await createUser(controlEmail, 'student', 'unseated-control');

    try {
      for (const userId of [seatedId, controlId]) {
        await seedOrgMembership({
          organizationId: orgA.orgId,
          userId,
          orgRoleId: customRole?.id as string,
        });
      }

      const { data: pool, error: poolError } = await service
        .from('org_seat_pools')
        .insert({ organization_id: orgA.orgId, plan_key: 'pro', total: 1, assigned: 0 })
        .select('id')
        .single();
      expect(poolError).toBeNull();

      const { error: assignmentError } = await service.from('org_seat_assignments').insert({
        organization_id: orgA.orgId,
        pool_id: pool?.id as string,
        user_id: seatedId,
      });
      expect(assignmentError).toBeNull();

      const { data: group } = await service
        .from('groups')
        .select('id')
        .eq('organization_id', orgA.orgId)
        .limit(1)
        .single();
      expect(group?.id).toBeTruthy();

      const seatedSession = await signIn(seatedEmail);
      const controlSession = await signIn(controlEmail);

      // `pro` has no group.manage, `launch` does: RLS must follow the seat plan.
      const { data: seatedGroupManage } = await seatedSession.rpc('rls_caller_has_org_feature', {
        p_organization_id: orgA.orgId,
        p_feature: 'group.manage',
      });
      expect(seatedGroupManage).toBe(false);

      // ...and it must be reading the seat plan, not just denying everything:
      // `pro` has advanced.stats, `launch` does not.
      const { data: seatedAdvancedStats } = await seatedSession.rpc('rls_caller_has_org_feature', {
        p_organization_id: orgA.orgId,
        p_feature: 'advanced.stats',
      });
      expect(seatedAdvancedStats).toBe(true);

      // The app denies group creation for this user; PostgREST must too.
      const { error: groupInsertError } = await seatedSession
        .from('groups')
        .insert({ organization_id: orgA.orgId, name: `rls191-b1-${tag}` })
        .select('id');
      expect(groupInsertError?.code).toBe('42501');

      // Same policy: no self-join into an existing org group.
      const { error: groupMemberError } = await seatedSession.from('group_members').insert({
        group_id: group?.id as string,
        user_id: seatedId,
        role: 'member',
      });
      expect(groupMemberError?.code).toBe('42501');

      // Tenant floor intact: the seated user still reads the org's groups.
      const { data: readableGroups, error: groupsReadError } = await seatedSession
        .from('groups')
        .select('id')
        .eq('organization_id', orgA.orgId);
      expect(groupsReadError).toBeNull();
      expect(readableGroups?.length ?? 0).toBeGreaterThan(0);

      // Unseated custom roles keep the org-plan fallback.
      const { data: controlGroupManage } = await controlSession.rpc('rls_caller_has_org_feature', {
        p_organization_id: orgA.orgId,
        p_feature: 'group.manage',
      });
      expect(controlGroupManage).toBe(true);

      const { data: controlAdvancedStats } = await controlSession.rpc(
        'rls_caller_has_org_feature',
        { p_organization_id: orgA.orgId, p_feature: 'advanced.stats' },
      );
      expect(controlAdvancedStats).toBe(false);

      // Losing the seat restores the org-plan fallback for the same user.
      const { error: unassignError } = await service
        .from('org_seat_assignments')
        .delete()
        .eq('organization_id', orgA.orgId)
        .eq('user_id', seatedId);
      expect(unassignError).toBeNull();

      const { data: unseatedGroupManage } = await seatedSession.rpc('rls_caller_has_org_feature', {
        p_organization_id: orgA.orgId,
        p_feature: 'group.manage',
      });
      expect(unseatedGroupManage).toBe(true);
    } finally {
      await service.from('org_seat_assignments').delete().eq('organization_id', orgA.orgId);
      await service.from('org_seat_pools').delete().eq('organization_id', orgA.orgId);
      await service.from('org_members').delete().in('user_id', [seatedId, controlId]);
      await service
        .from('org_roles')
        .delete()
        .eq('id', customRole?.id as string);
      for (const userId of [seatedId, controlId]) {
        await service.auth.admin.deleteUser(userId).catch(() => {});
      }
    }
  });

  it('lists an assignment whose member was removed, and lets the manager free the seat (review-2-r3 B2)', async () => {
    // Historical `removeMember` deleted only the org_members row, so the seat
    // assignment survived while the narrowed `profiles` SELECT made the
    // `profiles!inner` embed drop the whole row from /manage/seats. The list
    // query now left-joins the profile, so an orphan is visible and unassignable.
    const orphanEmail = `rls191-orphan-seat-${tag}@dev.local`;
    const orphanId = await createUser(orphanEmail, 'student', 'orphan-seat');

    try {
      const { data: pool, error: poolError } = await service
        .from('org_seat_pools')
        .insert({ organization_id: orgA.orgId, plan_key: 'pro', total: 5, assigned: 0 })
        .select('id')
        .single();
      expect(poolError).toBeNull();

      const { error: assignmentError } = await service.from('org_seat_assignments').insert({
        organization_id: orgA.orgId,
        pool_id: pool?.id as string,
        user_id: orphanId,
      });
      expect(assignmentError).toBeNull();

      // No org_members row for orphanId: exactly the state a historical removal
      // leaves behind.
      const { count: membershipCount } = await service
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA.orgId)
        .eq('user_id', orphanId);
      expect(membershipCount).toBe(0);

      // The exact query seat.service.listAssignments issues for the manager.
      const { data: listed, error: listError } = await adminSession
        .from('org_seat_assignments')
        .select('id, user_id, profile:profiles(email, full_name)')
        .eq('organization_id', orgA.orgId);
      expect(listError).toBeNull();
      const orphanRow = (listed ?? []).find((row) => row.user_id === orphanId);
      expect(orphanRow).toBeTruthy();
      expect(orphanRow?.profile ?? null).toBeNull();

      // The manager cannot read that profile: why assignSeat fails closed for a
      // non-member, and why the left join matters.
      const { data: hiddenProfile } = await adminSession
        .from('profiles')
        .select('id, email')
        .eq('id', orphanId);
      expect(hiddenProfile).toEqual([]);

      // The manager can still free the seat through the org-scoped DELETE policy
      // and the trigger returns it to the pool.
      const { error: deleteError } = await adminSession
        .from('org_seat_assignments')
        .delete()
        .eq('organization_id', orgA.orgId)
        .eq('user_id', orphanId);
      expect(deleteError).toBeNull();

      const { count: remainingAssignments } = await service
        .from('org_seat_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA.orgId)
        .eq('user_id', orphanId);
      expect(remainingAssignments).toBe(0);

      const { data: poolAfter } = await service
        .from('org_seat_pools')
        .select('assigned')
        .eq('id', pool?.id as string)
        .single();
      expect(poolAfter?.assigned).toBe(0);
    } finally {
      await service.from('org_seat_assignments').delete().eq('organization_id', orgA.orgId);
      await service.from('org_seat_pools').delete().eq('organization_id', orgA.orgId);
      await service.auth.admin.deleteUser(orphanId).catch(() => {});
    }
  });

  it('cross-tenant role references are rejected (B1/B2)', async () => {
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // An org A manager cannot invite into an org B role. The BEFORE trigger
    // rejects the cross-org reference (23514) before the RLS WITH CHECK would
    // deny it (42501) — either way the row is never written.
    const { error: inviteError } = await adminSession.from('invitations').insert({
      email: `rls191-cross-${tag}@dev.local`,
      organization_id: orgA.orgId,
      inviter_id: adminId,
      target_org_role_id: orgB.adminRoleId,
      expires_at: expiry,
    });
    expect(['23514', '42501']).toContain(inviteError?.code);

    // Even the service role cannot persist a membership with another org's role.
    const { error: memberError } = await service
      .from('org_members')
      .update({ org_role_id: orgB.adminRoleId })
      .eq('organization_id', orgA.orgId)
      .eq('user_id', studentId);
    expect(memberError?.code).toBe('23514');
  });

  it('internal role-authority RPCs are service-role only, RLS wrappers work (function ACL)', async () => {
    for (const [fn, args] of [
      [
        'has_org_feature',
        { p_actor: studentId, p_organization_id: orgA.orgId, p_feature: 'member.manage' },
      ],
      ['is_org_manager', { p_actor: studentId, p_organization_id: orgA.orgId }],
      ['can_assign_org_role', { p_actor: studentId, p_role_id: orgA.adminRoleId }],
    ] as const) {
      const { data, error } = await studentSession.rpc(fn as never, args as never);
      expect(error?.code, `${fn} must not be executable by authenticated`).toBe('42501');
      expect(data).toBeNull();
    }

    // The wrappers ARE granted and reflect the caller's role.
    const { data: studentManager } = await studentSession.rpc('rls_caller_is_org_manager', {
      p_organization_id: orgA.orgId,
    });
    expect(studentManager).toBe(false);
    const { data: adminManager } = await adminSession.rpc('rls_caller_is_org_manager', {
      p_organization_id: orgA.orgId,
    });
    expect(adminManager).toBe(true);

    const { data: studentCanAssign } = await studentSession.rpc('rls_caller_can_assign_org_role', {
      p_role_id: orgA.adminRoleId,
    });
    expect(studentCanAssign).toBe(false);
    const { data: teacherCanAssignMember } = await teacherSession.rpc(
      'rls_caller_can_assign_org_role',
      { p_role_id: orgA.memberRoleId },
    );
    expect(teacherCanAssignMember).toBe(true);
    const { data: teacherCanAssignAdmin } = await teacherSession.rpc(
      'rls_caller_can_assign_org_role',
      { p_role_id: orgA.adminRoleId },
    );
    expect(teacherCanAssignAdmin).toBe(false);

    const { data: teacherGroupManage } = await teacherSession.rpc('rls_caller_has_org_feature', {
      p_organization_id: orgA.orgId,
      p_feature: 'group.manage',
    });
    expect(teacherGroupManage).toBe(true);
    const { data: studentGroupManage } = await studentSession.rpc('rls_caller_has_org_feature', {
      p_organization_id: orgA.orgId,
      p_feature: 'group.manage',
    });
    expect(studentGroupManage).toBe(false);
  });

  it('a signed-in user with no organization can still use personal flashcards', async () => {
    const { data: deck, error: deckError } = await lonerSession
      .from('flashcard_decks')
      .insert({ created_by: lonerId, name: `rls191-loner-deck-${tag}`, visibility: 'personal' })
      .select('id')
      .single();
    expect(deckError).toBeNull();

    const { data: card, error: cardError } = await lonerSession
      .from('flashcards')
      .insert({
        created_by: lonerId,
        deck_id: deck?.id as string,
        front: `rls191-loner-front-${tag}`,
        back: `rls191-loner-back-${tag}`,
        visibility: 'personal',
      })
      .select('id')
      .single();
    expect(cardError).toBeNull();

    const { error: reviewError } = await lonerSession
      .from('flashcard_review_state')
      .insert({ user_id: lonerId, flashcard_id: card?.id as string });
    expect(reviewError).toBeNull();

    const { error: settingsError } = await lonerSession
      .from('user_study_settings')
      .insert({ user_id: lonerId, new_cards_per_day: 5 });
    expect(settingsError).toBeNull();
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
