import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson } from '#test/helpers/json';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';

// The `quiz_attempts` staff branch at the database boundary (D-5e3, register row 4): the
// predicate is capability-based, never persona-based, so these reads run with REAL user JWTs
// against PostgREST. Both directions are pinned in ONE fixture where persona and role disagree
// (R28): an educator persona on the Member role reads no other learner's attempt (the old
// account_type branch leaked exactly this), while a student persona on a custom role holding
// `assignment.update`@organization does (a group-or-wider capability the Member's own-scope
// `stats.read` does not cover). The unattributed arm (organization_id IS NULL — a legacy/practice
// attempt) is pinned the same way: a shared-org staff-capability holder reads it, a Member does
// not, and a capability holder in another org does not — nothing crosses orgs.

const PASSWORD = 'AttemptScope1!';
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

async function attemptsOf(
  session: SupabaseClient<Database>,
  userId: string,
): Promise<Array<{ id: string }>> {
  const { data, error } = await session.from('quiz_attempts').select('id').eq('user_id', userId);
  expect(error, 'the read itself must not be refused — the rows are filtered').toBeNull();
  return asJson<Array<{ id: string }>>(data);
}

describe('quiz_attempts staff branch keys on capability, not persona (#1165, D-5e3)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let teacherRoleId: string;
  let memberRoleId: string;
  let attemptId: string;
  let nullOrgAttemptId: string;
  let otherOrgId: string;
  let studentAId: string;
  let teacher: SupabaseClient<Database>;
  let manager: SupabaseClient<Database>;
  let memberStudent: SupabaseClient<Database>;
  let educatorOnMember: SupabaseClient<Database>;
  let customGrader: SupabaseClient<Database>;
  let outsider: SupabaseClient<Database>;
  let studentA: SupabaseClient<Database>;
  const userIds: string[] = [];

  async function createUser(label: string, accountType: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email: `attempts-${label}-${tag}@dev.local`,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    userIds.push(data.user.id);
    return data.user.id;
  }

  beforeAll(async () => {
    const seeded = asJson<Awaited<ReturnType<typeof seedOrganization>>>(
      await seedOrganization(`attempts-${tag}`),
    );
    orgId = seeded.org.id;
    teacherRoleId = seeded.teacherRoleId;
    memberRoleId = seeded.memberRoleId;

    const teacherId = await createUser('teacher', 'educator');
    const managerId = await createUser('manager', 'manager');
    studentAId = await createUser('student-a', 'student');
    const memberStudentId = await createUser('student-b', 'student');
    const educatorMemberId = await createUser('educator-member', 'educator');

    // A custom role whose only key is `assignment.update`@organization — no read key at all.
    const { data: graderRole, error: roleError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `attempts-grader-${tag}`,
        display_name: 'Grader',
        is_system: false,
      })
      .select('id')
      .single();
    if (roleError) throw new Error(`grader role: ${roleError.message}`);
    const { error: permissionError } = await service.from('org_role_permissions').insert({
      org_role_id: graderRole.id,
      permission_key: 'assignment.update',
      scope: 'organization',
    });
    if (permissionError) throw new Error(`grader permission: ${permissionError.message}`);
    const graderId = await createUser('grader', 'student');

    await seedOrgMembership({ organizationId: orgId, userId: teacherId, orgRoleId: teacherRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: managerId,
      orgRoleId: seeded.adminRoleId,
    });
    await seedOrgMembership({ organizationId: orgId, userId: studentAId, orgRoleId: memberRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: memberStudentId,
      orgRoleId: memberRoleId,
    });
    // Persona and role disagree: an educator persona sitting on the Member role.
    await seedOrgMembership({
      organizationId: orgId,
      userId: educatorMemberId,
      orgRoleId: memberRoleId,
    });
    // ...and a student persona holding `assignment.update`@organization.
    await seedOrgMembership({ organizationId: orgId, userId: graderId, orgRoleId: graderRole.id });

    const { data: group, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `attempts-group-${tag}` })
      .select('id')
      .single();
    if (groupError) throw new Error(`group: ${groupError.message}`);
    await seedGroupMembership({ groupId: group.id, userId: studentAId, role: 'member' });

    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        title: `attempts-assignment-${tag}`,
        status: 'published',
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single();
    if (assignmentError) throw new Error(`assignment: ${assignmentError.message}`);

    // The attempt is stamped with the assignment's organization by the trigger (20261028100000).
    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert({
        user_id: studentAId,
        assignment_id: assignment.id,
        score: 1,
        total_questions: 1,
      })
      .select('id, organization_id')
      .single();
    if (attemptError) throw new Error(`attempt: ${attemptError.message}`);
    attemptId = asJson<{ id: string; organization_id: string | null }>(attempt).id;
    expect(asJson<{ organization_id: string | null }>(attempt).organization_id).toBe(orgId);

    // A practice attempt (no assignment) stays unattributed: organization_id IS NULL. The
    // unattributed arm of the policy must still let a shared-org staff-capability holder
    // read it — and never anyone outside that org.
    const { data: nullOrgAttempt, error: nullOrgError } = await service
      .from('quiz_attempts')
      .insert({
        user_id: studentAId,
        assignment_id: null,
        score: 1,
        total_questions: 1,
      })
      .select('id, organization_id')
      .single();
    if (nullOrgError) throw new Error(`null-org attempt: ${nullOrgError.message}`);
    nullOrgAttemptId = asJson<{ id: string; organization_id: string | null }>(nullOrgAttempt).id;
    expect(asJson<{ organization_id: string | null }>(nullOrgAttempt).organization_id).toBeNull();

    // A second org with its own Teacher-role holder: staff-capable, but sharing no org with
    // the attempt's owner, so neither the org-attributed nor the unattributed arm may reach.
    const otherSeeded = asJson<Awaited<ReturnType<typeof seedOrganization>>>(
      await seedOrganization(`attempts-other-${tag}`),
    );
    otherOrgId = otherSeeded.org.id;
    const outsiderId = await createUser('outsider', 'educator');
    await seedOrgMembership({
      organizationId: otherOrgId,
      userId: outsiderId,
      orgRoleId: otherSeeded.teacherRoleId,
    });

    teacher = await signIn(`attempts-teacher-${tag}@dev.local`);
    manager = await signIn(`attempts-manager-${tag}@dev.local`);
    memberStudent = await signIn(`attempts-student-b-${tag}@dev.local`);
    educatorOnMember = await signIn(`attempts-educator-member-${tag}@dev.local`);
    customGrader = await signIn(`attempts-grader-${tag}@dev.local`);
    outsider = await signIn(`attempts-outsider-${tag}@dev.local`);
    studentA = await signIn(`attempts-student-a-${tag}@dev.local`);
  });

  afterAll(async () => {
    await service.from('quiz_attempts').delete().in('id', [attemptId, nullOrgAttemptId]);
    await service.from('teacher_assignments').delete().eq('organization_id', orgId);
    await cleanupOrganizationDeep(orgId);
    await cleanupOrganizationDeep(otherOrgId);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  it('stamps the assignment attempt with the organization, and leaves a practice attempt unattributed', async () => {
    const own = await studentA
      .from('quiz_attempts')
      .select('id, organization_id')
      .eq('id', attemptId);
    expect(own.error).toBeNull();
    expect(asJson<Array<{ id: string; organization_id: string | null }>>(own.data)).toEqual([
      { id: attemptId, organization_id: orgId },
    ]);

    const practice = await studentA
      .from('quiz_attempts')
      .select('id, organization_id')
      .eq('id', nullOrgAttemptId);
    expect(practice.error).toBeNull();
    expect(asJson<Array<{ id: string; organization_id: string | null }>>(practice.data)).toEqual([
      { id: nullOrgAttemptId, organization_id: null },
    ]);
  });

  it('lets the author (Teacher, stats.read@group) and the Admin read the learner’s attempts', async () => {
    for (const [label, session] of [
      ['teacher', teacher],
      ['manager', manager],
    ] as const) {
      const rows = await attemptsOf(session, studentAId);
      expect(
        rows.map((row) => row.id).toSorted(),
        `${label} reads the org-attributed AND the unattributed attempt`,
      ).toEqual([attemptId, nullOrgAttemptId].toSorted());
    }
  });

  it('lets a custom role holding assignment.update@organization read the cohort (no read key needed)', async () => {
    const rows = await attemptsOf(customGrader, studentAId);
    expect(rows.map((row) => row.id).toSorted()).toEqual([attemptId, nullOrgAttemptId].toSorted());
  });

  it('lets no Member read another learner’s attempts — own-scope stats.read does not cover group (R28)', async () => {
    expect(await attemptsOf(memberStudent, studentAId)).toEqual([]);
    // Persona and role disagree the other way too: an educator persona on the Member role is
    // still not staff — the old account_type branch returned the rows here.
    expect(await attemptsOf(educatorOnMember, studentAId)).toEqual([]);
  });

  it('lets no staff-capability holder who shares no org with the owner read the unattributed attempt', async () => {
    // The outsider holds the Teacher role (stats.read@group) in a DIFFERENT org: the
    // unattributed arm requires a shared org, so nothing crosses orgs.
    expect(await attemptsOf(outsider, studentAId)).toEqual([]);
  });

  it('keeps the learner’s own read working', async () => {
    const rows = await attemptsOf(studentA, studentAId);
    expect(rows.map((row) => row.id).toSorted()).toEqual([attemptId, nullOrgAttemptId].toSorted());
  });
});
