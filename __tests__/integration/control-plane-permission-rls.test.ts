import { readFileSync } from 'node:fs';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

/**
 * RLS parity for the control-plane sweep (ADR-0015 §4.1, §4.4, §7; R4).
 *
 * 2b-4 is the last slice of the control plane: `billing_subscriptions` read,
 * the assignment writes and the staff read of an assignment's frozen item set
 * stop asking the legacy `member.manage` capability helper and ask the
 * permission the API checks. `can_assign_org_role` and the `invitations` SELECT
 * deliberately stay legacy: PostgREST refuses an UPDATE whose row the SELECT
 * policy hides, so moving the helper's manager half alone would leave the
 * intended caller unable to retarget (R25), and 2b-5 moves both halves with the
 * class-invite rewrite.
 *
 * Both directions are pinned with real signed-in sessions against PostgREST, the
 * path a hostile client actually uses. The "legacy" roles hold the old
 * `member.manage` marker and no key, so they prove the predicate moved rather
 * than widened. The Teacher rows are the other half of the proof: a Teacher
 * holds every `assignment.*` key at `own` scope, and the write policies must
 * still refuse a run they did not author.
 */

const PASSWORD = 'ControlPlane!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MIGRATION = 'supabase/migrations/20261120130000_control_plane_permission_rls.sql';

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * A run without the local database URL must fail instead of skipping: a silent
 * skip would keep asserting against whatever policies a previous run applied, so
 * a reverted predicate would survive.
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "control-plane-permission-rls needs SUPABASE_DB_URL pointing at this checkout's local " +
        'Supabase to install the shipped policies. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`: a bare `bun run test:integration` ' +
        'in a fresh worktree has no database URL, and skipping the install would let a ' +
        'reverted predicate pass.',
    );
  }
  return localDatabaseUrl;
}

/** Install the shipped migration the way a reset would (`alter policy` is idempotent). */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(MIGRATION, 'utf8'));
  } finally {
    await sql.end();
  }
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

describe('control-plane permission RLS (2b-4)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let foreignOrgId: string;
  let memberRoleId: string;
  let adminRoleId: string;
  let teacherRoleId: string;
  let billingRoleId: string;
  let legacyBillingRoleId: string;
  let updaterRoleId: string;
  let ownUpdaterRoleId: string;
  let readerRoleId: string;
  let foreignMemberRoleId: string;

  let billingId: string;
  let legacyBillingId: string;
  let memberId: string;
  let adminId: string;
  let teacherId: string;
  let otherTeacherId: string;
  let memberEducatorId: string;
  let studentId: string;
  let updaterId: string;
  let ownUpdaterId: string;
  let readerId: string;
  let outsiderId: string;

  let billing: SupabaseClient<Database>;
  let legacyBilling: SupabaseClient<Database>;
  let member: SupabaseClient<Database>;
  let admin: SupabaseClient<Database>;
  let teacher: SupabaseClient<Database>;
  let otherTeacher: SupabaseClient<Database>;
  let memberEducator: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;
  let updater: SupabaseClient<Database>;
  let ownUpdater: SupabaseClient<Database>;
  let reader: SupabaseClient<Database>;
  let outsider: SupabaseClient<Database>;

  let groupId: string;
  let questionA: string;
  let questionB: string;
  let questionC: string;
  let questionD: string;
  let ownAssignmentId: string;
  let foreignAssignmentId: string;
  let deleteAssignmentId: string;
  let updaterChildAssignmentId: string;
  let ownScopeChildAssignmentId: string;
  let cohortAssignmentId: string;
  let questionRowId: string;
  let targetRowId: string;
  let ownScopeQuestionRowId: string;
  let ownScopeTargetRowId: string;

  async function createUser(email: string, label: string, persona: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: persona },
      user_metadata: { name: label, account_type: persona },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  async function customRole(
    organizationId: string,
    name: string,
    keys: Array<[key: string, scope: string]> = [],
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`role ${name} create failed: ${error.message}`);

    if (keys.length > 0) {
      const { error: permissionError } = await service.from('org_role_permissions').insert(
        keys.map(([permissionKey, scope]) => ({
          org_role_id: role.id,
          permission_key: permissionKey,
          scope,
        })),
      );
      if (permissionError) throw new Error(`permission ${name} failed: ${permissionError.message}`);
    }

    return role.id;
  }

  async function grantLegacyMarker(roleId: string, featureKey: string) {
    const { error } = await service.from('org_role_features').insert({
      org_role_id: roleId,
      feature_key: featureKey,
      is_enabled: true,
    });
    if (error) throw new Error(`feature grant failed: ${error.message}`);
  }

  async function insertBillingOwner(data: {
    organizationId?: string;
    userId?: string;
    label: string;
  }): Promise<{ customerId: string; subscriptionId: string }> {
    const { data: customer, error: customerError } = await service
      .from('billing_customers')
      .insert({
        organization_id: data.organizationId ?? null,
        user_id: data.userId ?? null,
        stripe_customer_id: `cus_${data.label}_${tag}`,
        livemode: false,
      })
      .select('id')
      .single();
    if (customerError) throw new Error(`customer ${data.label}: ${customerError.message}`);

    const { data: subscription, error: subscriptionError } = await service
      .from('billing_subscriptions')
      .insert({
        stripe_subscription_id: `sub_${data.label}_${tag}`,
        billing_customer_id: customer.id,
        organization_id: data.organizationId ?? null,
        user_id: data.userId ?? null,
        plan_key: data.organizationId ? 'hub' : 'ace',
        price_id: data.organizationId ? 'price_hub' : 'price_ace',
        status: 'active',
        livemode: false,
      })
      .select('id')
      .single();
    if (subscriptionError) {
      throw new Error(`subscription ${data.label}: ${subscriptionError.message}`);
    }

    return { customerId: customer.id, subscriptionId: subscription.id };
  }

  async function insertAssignment(createdBy: string, title: string): Promise<string> {
    const { data, error } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: createdBy,
        title: `${title}-${tag}`,
        status: 'draft',
        question_count: 1,
        total_points: 1,
      })
      .select('id')
      .single();
    if (error) throw new Error(`assignment ${title}: ${error.message}`);
    return data.id;
  }

  beforeAll(async () => {
    await installShippedSql();

    const org = await seedOrganization(`control-plane-${tag}`);
    orgId = org.org.id;
    memberRoleId = org.memberRoleId;
    adminRoleId = org.adminRoleId;
    teacherRoleId = org.teacherRoleId;

    const foreignOrg = await seedOrganization(`control-plane-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;
    foreignMemberRoleId = foreignOrg.memberRoleId;

    // D17's Billing preset: org.billing.manage + org.seat.manage.
    billingRoleId = await customRole(orgId, `control-plane-billing-${tag}`, [
      ['org.billing.manage', 'organization'],
      ['org.seat.manage', 'organization'],
    ]);
    // The control: the legacy `member.manage` marker the old policies read.
    legacyBillingRoleId = await customRole(orgId, `control-plane-legacy-${tag}`);

    updaterRoleId = await customRole(orgId, `control-plane-updater-${tag}`, [
      ['assignment.update', 'organization'],
      ['assignment.read', 'organization'],
    ]);
    // `own` scope is what the seeded Teacher holds; it must not reach a foreign run.
    ownUpdaterRoleId = await customRole(orgId, `control-plane-own-${tag}`, [
      ['assignment.update', 'own'],
    ]);
    readerRoleId = await customRole(orgId, `control-plane-reader-${tag}`, [
      ['assignment.read', 'organization'],
    ]);

    await grantLegacyMarker(legacyBillingRoleId, 'member.manage');

    billingId = await createUser(`control-plane-billing-${tag}@dev.local`, 'billing', 'manager');
    legacyBillingId = await createUser(
      `control-plane-legacy-${tag}@dev.local`,
      'legacy billing',
      'manager',
    );
    memberId = await createUser(`control-plane-member-${tag}@dev.local`, 'member', 'manager');
    adminId = await createUser(`control-plane-admin-${tag}@dev.local`, 'admin', 'manager');
    teacherId = await createUser(`control-plane-teacher-${tag}@dev.local`, 'teacher', 'educator');
    otherTeacherId = await createUser(
      `control-plane-other-teacher-${tag}@dev.local`,
      'other teacher',
      'educator',
    );
    memberEducatorId = await createUser(
      `control-plane-member-educator-${tag}@dev.local`,
      'member educator',
      'educator',
    );
    studentId = await createUser(`control-plane-student-${tag}@dev.local`, 'student', 'student');
    updaterId = await createUser(`control-plane-updater-${tag}@dev.local`, 'updater', 'manager');
    ownUpdaterId = await createUser(`control-plane-own-${tag}@dev.local`, 'own updater', 'manager');
    readerId = await createUser(`control-plane-reader-${tag}@dev.local`, 'reader', 'student');
    outsiderId = await createUser(`control-plane-outsider-${tag}@dev.local`, 'outsider', 'manager');

    await seedOrgMembership({ organizationId: orgId, userId: billingId, orgRoleId: billingRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: legacyBillingId,
      orgRoleId: legacyBillingRoleId,
    });
    await seedOrgMembership({ organizationId: orgId, userId: memberId, orgRoleId: memberRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: adminId, orgRoleId: adminRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: teacherId, orgRoleId: teacherRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: otherTeacherId,
      orgRoleId: teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: memberEducatorId,
      orgRoleId: memberRoleId,
    });
    await seedOrgMembership({ organizationId: orgId, userId: studentId, orgRoleId: memberRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: updaterId, orgRoleId: updaterRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: ownUpdaterId,
      orgRoleId: ownUpdaterRoleId,
    });
    await seedOrgMembership({ organizationId: orgId, userId: readerId, orgRoleId: readerRoleId });
    await seedOrgMembership({
      organizationId: foreignOrgId,
      userId: outsiderId,
      orgRoleId: foreignMemberRoleId,
    });

    const { data: group, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `control-plane-${tag}` })
      .select('id')
      .single();
    if (groupError) throw new Error(`group: ${groupError.message}`);
    groupId = group.id;
    await seedGroupMembership({ groupId, userId: studentId, role: 'member' });

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        name: `control-plane-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`bank: ${bankError.message}`);

    const questionIds: Record<string, string> = {};
    for (const label of ['a', 'b', 'c', 'd']) {
      const { data: question, error: questionError } = await service
        .from('questions')
        .insert({
          organization_id: orgId,
          created_by: teacherId,
          bank_id: bank.id,
          type: 'mcq',
          content: `control-plane-question-${label}-${tag}`,
          visibility: 'group',
        })
        .select('id')
        .single();
      if (questionError) throw new Error(`question ${label}: ${questionError.message}`);
      questionIds[label] = question.id;
    }
    questionA = questionIds.a!;
    questionB = questionIds.b!;
    questionC = questionIds.c!;
    questionD = questionIds.d!;

    ownAssignmentId = await insertAssignment(teacherId, 'own');
    foreignAssignmentId = await insertAssignment(otherTeacherId, 'foreign');
    deleteAssignmentId = await insertAssignment(teacherId, 'delete');
    updaterChildAssignmentId = await insertAssignment(otherTeacherId, 'updater children');
    ownScopeChildAssignmentId = await insertAssignment(otherTeacherId, 'own-scope children');
    cohortAssignmentId = await insertAssignment(otherTeacherId, 'cohort');

    const { data: questionRow, error: questionRowError } = await service
      .from('assignment_questions')
      .insert({
        assignment_id: ownAssignmentId,
        question_id: questionA,
        order_index: 0,
        points: 1,
        snapshot: { id: questionA, content: 'snapshot', type: 'mcq', question_answers: [] },
        snapshot_version: 1,
      })
      .select('id')
      .single();
    if (questionRowError) throw new Error(`assignment question: ${questionRowError.message}`);
    questionRowId = questionRow.id;

    const { data: targetRow, error: targetRowError } = await service
      .from('assignment_targets')
      .insert({ assignment_id: ownAssignmentId, student_id: studentId })
      .select('id')
      .single();
    if (targetRowError) throw new Error(`assignment target: ${targetRowError.message}`);
    targetRowId = targetRow.id;

    // Rows the own-scope holder must not touch: both child tables of a run its
    // author owns, seeded with the service client so the write policies are the
    // only thing a signed-in caller meets.
    const { data: ownScopeQuestion, error: ownScopeQuestionError } = await service
      .from('assignment_questions')
      .insert({
        assignment_id: ownScopeChildAssignmentId,
        question_id: questionA,
        order_index: 0,
        points: 1,
      })
      .select('id')
      .single();
    if (ownScopeQuestionError) {
      throw new Error(`own-scope question: ${ownScopeQuestionError.message}`);
    }
    ownScopeQuestionRowId = ownScopeQuestion.id;

    const { data: ownScopeTarget, error: ownScopeTargetError } = await service
      .from('assignment_targets')
      .insert({ assignment_id: ownScopeChildAssignmentId, student_id: studentId })
      .select('id')
      .single();
    if (ownScopeTargetError) throw new Error(`own-scope target: ${ownScopeTargetError.message}`);
    ownScopeTargetRowId = ownScopeTarget.id;

    // The cohort the updater replaces: two students, no group.
    const { error: cohortError } = await service.from('assignment_targets').insert([
      { assignment_id: cohortAssignmentId, student_id: studentId },
      { assignment_id: cohortAssignmentId, student_id: memberEducatorId },
    ]);
    if (cohortError) throw new Error(`cohort targets: ${cohortError.message}`);

    await insertBillingOwner({ organizationId: orgId, label: 'org' });
    await insertBillingOwner({ organizationId: foreignOrgId, label: 'foreign-org' });
    await insertBillingOwner({ userId: teacherId, label: 'teacher' });
    await insertBillingOwner({ userId: memberId, label: 'member' });

    billing = await signIn(`control-plane-billing-${tag}@dev.local`);
    legacyBilling = await signIn(`control-plane-legacy-${tag}@dev.local`);
    member = await signIn(`control-plane-member-${tag}@dev.local`);
    admin = await signIn(`control-plane-admin-${tag}@dev.local`);
    teacher = await signIn(`control-plane-teacher-${tag}@dev.local`);
    otherTeacher = await signIn(`control-plane-other-teacher-${tag}@dev.local`);
    memberEducator = await signIn(`control-plane-member-educator-${tag}@dev.local`);
    student = await signIn(`control-plane-student-${tag}@dev.local`);
    updater = await signIn(`control-plane-updater-${tag}@dev.local`);
    ownUpdater = await signIn(`control-plane-own-${tag}@dev.local`);
    reader = await signIn(`control-plane-reader-${tag}@dev.local`);
    outsider = await signIn(`control-plane-outsider-${tag}@dev.local`);
  });

  afterAll(async () => {
    await service
      .from('billing_subscriptions')
      .delete()
      .in('organization_id', [orgId, foreignOrgId]);
    await service.from('billing_customers').delete().in('organization_id', [orgId, foreignOrgId]);
    await service
      .from('billing_subscriptions')
      .delete()
      .in('user_id', [...userIds()]);
    await service
      .from('billing_customers')
      .delete()
      .in('user_id', [...userIds()]);
    await cleanupOrganizationDeep(orgId).catch(() => {});
    await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
    for (const id of userIds()) {
      if (id) await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  function userIds(): string[] {
    return [
      billingId,
      legacyBillingId,
      memberId,
      adminId,
      teacherId,
      otherTeacherId,
      memberEducatorId,
      studentId,
      updaterId,
      ownUpdaterId,
      readerId,
      outsiderId,
    ].filter(Boolean);
  }

  describe('billing_subscriptions read — org.billing.manage', () => {
    it('lets the Billing preset and the Admin role read the org subscription', async () => {
      const billingRead = await billing
        .from('billing_subscriptions')
        .select('id, plan_key')
        .eq('organization_id', orgId);
      const adminRead = await admin
        .from('billing_subscriptions')
        .select('id, plan_key')
        .eq('organization_id', orgId);

      expect(billingRead.error).toBeNull();
      expect(billingRead.data).toHaveLength(1);
      expect(billingRead.data?.[0]?.plan_key).toBe('hub');
      expect(adminRead.data).toHaveLength(1);
    });

    it('refuses the Member role, the legacy marker and a foreign org', async () => {
      const memberRead = await member
        .from('billing_subscriptions')
        .select('id')
        .eq('organization_id', orgId);
      const legacyRead = await legacyBilling
        .from('billing_subscriptions')
        .select('id')
        .eq('organization_id', orgId);
      const outsiderRead = await outsider
        .from('billing_subscriptions')
        .select('id')
        .eq('organization_id', orgId);

      expect(memberRead.data).toEqual([]);
      expect(legacyRead.data).toEqual([]);
      expect(outsiderRead.data).toEqual([]);
    });

    it('keeps the personal own-row branch', async () => {
      const ownRead = await teacher
        .from('billing_subscriptions')
        .select('id, plan_key')
        .is('organization_id', null);
      const othersPersonal = await teacher
        .from('billing_subscriptions')
        .select('id')
        .eq('user_id', memberId);
      const memberOwn = await member
        .from('billing_subscriptions')
        .select('id')
        .is('organization_id', null);

      expect(ownRead.data).toHaveLength(1);
      expect(ownRead.data?.[0]?.plan_key).toBe('ace');
      expect(othersPersonal.data).toEqual([]);
      expect(memberOwn.data).toHaveLength(1);
    });

    it('keeps billing_customers closed to a signed-in session', async () => {
      // `billing_customers` has no grants at all: the Stripe customer id never
      // leaves the server. The read model joins by `billing_customer_id` only.
      const { error } = await billing.from('billing_customers').select('id');

      expect(error?.code).toBe('42501');
    });
  });

  describe('teacher_assignments writes — assignment.update / assignment.delete', () => {
    it('lets an org-scope assignment.update holder edit a run it did not author', async () => {
      const { data, error } = await updater
        .from('teacher_assignments')
        .update({ title: `updater-renamed-${tag}` })
        .eq('id', foreignAssignmentId)
        .select('id, title');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.title).toBe(`updater-renamed-${tag}`);
    });

    it('refuses the Member role and the legacy marker without touching the row', async () => {
      const before = (
        await service
          .from('teacher_assignments')
          .select('title')
          .eq('id', foreignAssignmentId)
          .single()
      ).data?.title;

      const memberUpdate = await member
        .from('teacher_assignments')
        .update({ title: `member-renamed-${tag}` })
        .eq('id', foreignAssignmentId)
        .select('id');
      const legacyUpdate = await legacyBilling
        .from('teacher_assignments')
        .update({ title: `legacy-renamed-${tag}` })
        .eq('id', foreignAssignmentId)
        .select('id');

      expect(memberUpdate.data).toEqual([]);
      expect(legacyUpdate.data).toEqual([]);

      const after = (
        await service
          .from('teacher_assignments')
          .select('title')
          .eq('id', foreignAssignmentId)
          .single()
      ).data?.title;
      expect(after).toBe(before);
    });

    it('refuses an own-scope holder and a Teacher that did not author the run', async () => {
      // The seeded Teacher holds assignment.update at `own`; the same key at
      // `own` on a custom role must not reach another teacher's run either. The
      // author branch is what makes own-scope rows useful.
      const ownUpdate = await ownUpdater
        .from('teacher_assignments')
        .update({ title: `own-renamed-${tag}` })
        .eq('id', foreignAssignmentId)
        .select('id');
      const teacherUpdate = await otherTeacher
        .from('teacher_assignments')
        .update({ title: `teacher-renamed-${tag}` })
        .eq('id', ownAssignmentId)
        .select('id');

      expect(ownUpdate.data).toEqual([]);
      expect(teacherUpdate.data).toEqual([]);
    });

    it('keeps the author branch for the creator', async () => {
      const { data, error } = await teacher
        .from('teacher_assignments')
        .update({ title: `author-renamed-${tag}` })
        .eq('id', ownAssignmentId)
        .select('id, title');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('splits DELETE onto assignment.delete: the updater is refused, the Admin is not', async () => {
      const updaterDelete = await updater
        .from('teacher_assignments')
        .delete()
        .eq('id', deleteAssignmentId)
        .select('id');
      expect(updaterDelete.error).toBeNull();
      expect(updaterDelete.data).toEqual([]);

      const { data, error } = await admin
        .from('teacher_assignments')
        .delete()
        .eq('id', deleteAssignmentId)
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  describe('assignment_questions / assignment_targets writes', () => {
    it('lets the Admin role write the frozen item set of a run it did not author', async () => {
      const inserted = await admin
        .from('assignment_questions')
        .insert({
          assignment_id: foreignAssignmentId,
          question_id: questionB,
          order_index: 0,
          points: 1,
        })
        .select('id');
      expect(inserted.error).toBeNull();
      expect(inserted.data).toHaveLength(1);

      const updated = await admin
        .from('assignment_questions')
        .update({ points: 2 })
        .eq('assignment_id', foreignAssignmentId)
        .eq('question_id', questionB)
        .select('id, points');
      expect(updated.data).toHaveLength(1);

      const removed = await admin
        .from('assignment_questions')
        .delete()
        .eq('assignment_id', foreignAssignmentId)
        .eq('question_id', questionB)
        .select('id');
      expect(removed.data).toHaveLength(1);
    });

    it('lets an org-scope assignment.update holder — not an Admin — write a foreign run’s child rows', async () => {
      // The Admin case above cannot carry this proof: the Admin system role also
      // satisfies the legacy `rls_caller_is_org_manager` marker, so a reverted
      // child policy would stay green. `updater` holds `assignment.update` at
      // organization scope on a custom role and no marker.
      const questionInsert = await updater
        .from('assignment_questions')
        .insert({
          assignment_id: updaterChildAssignmentId,
          question_id: questionB,
          order_index: 0,
          points: 1,
        })
        .select('points');
      expect(questionInsert.error).toBeNull();
      expect(questionInsert.data).toEqual([{ points: 1 }]);

      const questionUpdate = await updater
        .from('assignment_questions')
        .update({ points: 3 })
        .eq('assignment_id', updaterChildAssignmentId)
        .eq('question_id', questionB)
        .select('points');
      expect(questionUpdate.data).toEqual([{ points: 3 }]);

      const targetInsert = await updater
        .from('assignment_targets')
        .insert({ assignment_id: updaterChildAssignmentId, group_id: groupId })
        .select('id');
      expect(targetInsert.error).toBeNull();
      expect(targetInsert.data).toHaveLength(1);

      // The target UPDATE the suite otherwise never exercises.
      const targetUpdate = await updater
        .from('assignment_targets')
        .update({ group_id: null, student_id: memberEducatorId })
        .eq('assignment_id', updaterChildAssignmentId)
        .eq('group_id', groupId)
        .select('student_id, group_id');
      expect(targetUpdate.error).toBeNull();
      expect(targetUpdate.data).toEqual([{ student_id: memberEducatorId, group_id: null }]);

      const questionDelete = await updater
        .from('assignment_questions')
        .delete()
        .eq('assignment_id', updaterChildAssignmentId)
        .select('id');
      expect(questionDelete.data).toHaveLength(1);
    });

    it('refuses an own-scope assignment.update holder the same child writes', async () => {
      // `own` scope is what the seeded Teacher holds; it reaches only the author
      // branch. Neither child table may widen it to another teacher's run.
      const questionInsert = await ownUpdater.from('assignment_questions').insert({
        assignment_id: ownScopeChildAssignmentId,
        question_id: questionC,
        order_index: 1,
        points: 1,
      });
      const targetInsert = await ownUpdater
        .from('assignment_targets')
        .insert({ assignment_id: ownScopeChildAssignmentId, group_id: groupId });
      expect(questionInsert.error?.code).toBe('42501');
      expect(targetInsert.error?.code).toBe('42501');

      const questionUpdate = await ownUpdater
        .from('assignment_questions')
        .update({ points: 9 })
        .eq('id', ownScopeQuestionRowId)
        .select('id');
      const targetUpdate = await ownUpdater
        .from('assignment_targets')
        .update({ student_id: memberEducatorId })
        .eq('id', ownScopeTargetRowId)
        .select('id');
      expect(questionUpdate.data).toEqual([]);
      expect(targetUpdate.data).toEqual([]);

      const questions = await service
        .from('assignment_questions')
        .select('points')
        .eq('id', ownScopeQuestionRowId)
        .single();
      const targets = await service
        .from('assignment_targets')
        .select('student_id')
        .eq('id', ownScopeTargetRowId)
        .single();
      expect(questions.data?.points).toBe(1);
      expect(targets.data?.student_id).toBe(studentId);
    });

    it('lets an org-scope updater replace a foreign run’s cohort and the old rows are gone', async () => {
      // The service's `setTargets` deletes then inserts. A child DELETE left on
      // `assignment.delete` would filter this delete to zero rows without an
      // error, and the insert would leave the stale cohort beside the new one.
      const removed = await updater
        .from('assignment_targets')
        .delete()
        .eq('assignment_id', cohortAssignmentId)
        .select('id, student_id');
      expect(removed.error).toBeNull();
      expect(removed.data).toHaveLength(2);

      const inserted = await updater
        .from('assignment_targets')
        .insert({ assignment_id: cohortAssignmentId, group_id: groupId })
        .select('id');
      expect(inserted.error).toBeNull();

      // The set, not the count: both student rows are gone and the group is the
      // only remaining target.
      const after = await service
        .from('assignment_targets')
        .select('group_id, student_id')
        .eq('assignment_id', cohortAssignmentId);
      expect(after.data).toEqual([{ group_id: groupId, student_id: null }]);
    });

    it('refuses the Member role and a Teacher that did not author the run (42501)', async () => {
      const memberInsert = await member.from('assignment_questions').insert({
        assignment_id: ownAssignmentId,
        question_id: questionC,
        order_index: 1,
        points: 1,
      });
      const teacherInsert = await otherTeacher.from('assignment_questions').insert({
        assignment_id: ownAssignmentId,
        question_id: questionD,
        order_index: 2,
        points: 1,
      });

      expect(memberInsert.error?.code).toBe('42501');
      expect(teacherInsert.error?.code).toBe('42501');

      const memberUpdate = await member
        .from('assignment_questions')
        .update({ points: 9 })
        .eq('id', questionRowId)
        .select('id');
      const teacherDelete = await otherTeacher
        .from('assignment_questions')
        .delete()
        .eq('id', questionRowId)
        .select('id');

      expect(memberUpdate.data).toEqual([]);
      expect(teacherDelete.data).toEqual([]);

      const { data } = await service
        .from('assignment_questions')
        .select('points')
        .eq('id', questionRowId)
        .single();
      expect(data?.points).toBe(1);
    });

    it('gates the target list the same way', async () => {
      const adminInsert = await admin
        .from('assignment_targets')
        .insert({ assignment_id: foreignAssignmentId, group_id: groupId })
        .select('id');
      expect(adminInsert.error).toBeNull();

      const memberInsert = await member
        .from('assignment_targets')
        .insert({ assignment_id: foreignAssignmentId, student_id: memberId });
      const otherTeacherDelete = await otherTeacher
        .from('assignment_targets')
        .delete()
        .eq('id', targetRowId)
        .select('id');

      expect(memberInsert.error?.code).toBe('42501');
      expect(otherTeacherDelete.data).toEqual([]);

      const { data } = await admin
        .from('assignment_targets')
        .delete()
        .eq('assignment_id', foreignAssignmentId)
        .select('id');
      expect(data).toHaveLength(1);
    });
  });

  describe('assignments_items read — assignment.read replaces the staff persona', () => {
    it('lets an assignment.read holder with the student persona read another run’s items', async () => {
      // The reader is a `student` account type on purpose: D13 makes the persona
      // irrelevant, so a re-added `account_type IN ('educator','manager')`
      // conjunct would pass a manager-persona positive and the Member-educator
      // negative below, and survive.
      const { data, error } = await reader
        .from('assignment_questions')
        .select('id, assignment_id')
        .eq('assignment_id', ownAssignmentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('keeps the author branch and the staff-wide read the old branch granted', async () => {
      const authorRead = await teacher
        .from('assignment_questions')
        .select('id')
        .eq('assignment_id', ownAssignmentId);
      // A Teacher reads `assignment.read` at `own`; the old predicate was
      // 'any educator/manager in the org', which is org-wide either way.
      const colleagueRead = await otherTeacher
        .from('assignment_questions')
        .select('id')
        .eq('assignment_id', ownAssignmentId);

      expect(authorRead.data).toHaveLength(1);
      expect(colleagueRead.data).toHaveLength(1);
    });

    it('refuses a Member-role educator (the persona no longer authorizes)', async () => {
      // The old helper answered true for any educator persona in the org, so
      // this caller read every run's items. The permission is what replaced it.
      const { data, error } = await memberEducator
        .from('assignment_questions')
        .select('id')
        .eq('assignment_id', ownAssignmentId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('keeps the targeted-student branch on the target list, not on the items', async () => {
      const targets = await student
        .from('assignment_targets')
        .select('id')
        .eq('assignment_id', ownAssignmentId);
      const items = await student
        .from('assignment_questions')
        .select('id')
        .eq('assignment_id', ownAssignmentId);

      expect(targets.data).toHaveLength(1);
      expect(items.data).toEqual([]);
    });

    it('keeps the tenant floor: an outsider reads nothing', async () => {
      const targets = await outsider
        .from('assignment_targets')
        .select('id')
        .eq('assignment_id', ownAssignmentId);
      const items = await outsider
        .from('assignment_questions')
        .select('id')
        .eq('assignment_id', ownAssignmentId);

      expect(targets.data).toEqual([]);
      expect(items.data).toEqual([]);
    });
  });

  describe('org_members SELECT stays membership-wide (recorded asymmetry)', () => {
    it('lets a plain member read another member’s row through PostgREST', async () => {
      // D25/R23: the roster API is four keys and answers `[]` to this caller
      // (pinned in `org-control-permission-api.test.ts`), while the data-plane
      // policy predates the slice and answers the row. Narrowing it means
      // auditing every `org_members` reader — stats, assignment target
      // validation, the report inbox, the role list's member counts — and those
      // would silently return nothing (R21 in the read direction). Phase 5 owns
      // that narrowing; this case is what makes the asymmetry a scheduled fact
      // instead of an assumption.
      const { data, error } = await member
        .from('org_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', teacherId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('still hides a foreign org’s rows', async () => {
      const { data } = await member
        .from('org_members')
        .select('user_id')
        .eq('organization_id', foreignOrgId);

      expect(data).toEqual([]);
    });
  });
});
