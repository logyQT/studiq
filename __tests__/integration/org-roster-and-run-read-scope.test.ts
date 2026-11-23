import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { Database, Json } from '@studiq/server/types/database';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { asJson } from '#test/helpers/json';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { POST as createGroupReport } from '@/app/(backend)/api/v1/organization/groups/[id]/reports/route';

// ADR-0015 phase 5e-2 (register row 10): the roster and run read scope key on
// capabilities, not membership-wide org reads. Every case below reads through
// PostgREST with a REAL signed-in JWT (R41 — a service-role mock bypasses
// RLS and cannot see a policy change), seeded by the service role.

const PASSWORD = 'Roster5e2!';
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE_URL = 'http://localhost';

interface SeededOrg {
  org: { id: string; name: string };
  adminRoleId: string;
  teacherRoleId: string;
  memberRoleId: string;
  defaultGroupId: string;
}

/** The nine D-5e2-1 union keys, each granted to one dedicated custom role at its minimum allowed scope. */
const UNION_KEYS = [
  { key: 'org.member.manage', scope: 'organization' },
  { key: 'group.manage', scope: 'own' },
  { key: 'group.invite', scope: 'group' },
  { key: 'org.seat.manage', scope: 'organization' },
  { key: 'group.member.manage', scope: 'own' },
  { key: 'org.role.manage', scope: 'organization' },
  { key: 'assignment.create', scope: 'own' },
  { key: 'assignment.update', scope: 'own' },
  { key: 'stats.read', scope: 'group' },
] as const;

const signIn = async (email: string): Promise<SupabaseClient<Database>> => {
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
};

describe('org_members and teacher_assignments read scope (ADR-0015 5e-2, row 10)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let defaultGroupId: string;
  let memberRoleId: string;

  let managerId: string;
  let teacherId: string;
  let studentAId: string;
  let studentBId: string;
  let educatorOnMemberId: string;
  let studentOnStatsRoleId: string;
  /** The assignment.create-only key user: authors a run and reads it back with no assignment.read. */
  let authorNoReadId: string;
  /** One user per union key, in UNION_KEYS order. */
  const keyUserIds: string[] = [];
  const userEmails: string[] = [];
  const userIds: string[] = [];

  let runA: string;
  let runB: string;
  let runAuthor: string;
  let ownerlessGroupId: string;

  let manager: SupabaseClient<Database>;
  let teacher: SupabaseClient<Database>;
  let studentA: SupabaseClient<Database>;
  let studentB: SupabaseClient<Database>;
  let educatorOnMember: SupabaseClient<Database>;
  let studentOnStatsRole: SupabaseClient<Database>;
  let authorNoRead: SupabaseClient<Database>;
  const keyUsers: SupabaseClient<Database>[] = [];

  async function createUser(label: string, accountType: string): Promise<string> {
    const email = `roster-${label}-${tag}@dev.local`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    userIds.push(data.user.id);
    userEmails.push(email);
    return data.user.id;
  }

  async function createCustomRoleWithOnly(
    label: string,
    key: string,
    scope: string,
  ): Promise<string> {
    const { data: role, error: roleError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `roster-${label}-${tag}`,
        display_name: label,
        is_system: false,
      })
      .select('id')
      .single();
    if (roleError) throw new Error(`custom role ${label}: ${roleError.message}`);
    const { error: permError } = await service.from('org_role_permissions').insert({
      org_role_id: role.id,
      permission_key: key,
      scope,
    });
    if (permError) throw new Error(`custom role ${label} permission: ${permError.message}`);
    return role.id;
  }

  async function seedRun(createdBy: string, title: string): Promise<string> {
    const { data: run, error } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: createdBy,
        title,
        status: 'published',
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed run ${title}: ${error.message}`);
    return run.id;
  }

  beforeAll(async () => {
    const seeded = asJson<SeededOrg>(await seedOrganization(`roster-5e2-${tag}`));
    orgId = seeded.org.id;
    defaultGroupId = seeded.defaultGroupId;
    memberRoleId = seeded.memberRoleId;

    managerId = await createUser('manager', 'manager');
    teacherId = await createUser('teacher', 'educator');
    studentAId = await createUser('student-a', 'student');
    studentBId = await createUser('student-b', 'student');
    educatorOnMemberId = await createUser('educator-on-member', 'educator');
    studentOnStatsRoleId = await createUser('student-on-stats', 'student');

    await seedOrgMembership({
      organizationId: orgId,
      userId: managerId,
      orgRoleId: seeded.adminRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherId,
      orgRoleId: seeded.teacherRoleId,
    });
    for (const id of [studentAId, studentBId, educatorOnMemberId]) {
      await seedOrgMembership({ organizationId: orgId, userId: id, orgRoleId: memberRoleId });
    }

    // One custom role per union key, each holding ONLY that key at its minimum
    // allowed scope; the assignment.create holder doubles as the no-read author.
    for (const [index, unionKey] of UNION_KEYS.entries()) {
      const roleId = await createCustomRoleWithOnly(`key${index}`, unionKey.key, unionKey.scope);
      const userId = await createUser(`key-${unionKey.key}`, 'student');
      await seedOrgMembership({ organizationId: orgId, userId, orgRoleId: roleId });
      keyUserIds.push(userId);
      if (unionKey.key === 'assignment.create') authorNoReadId = userId;
    }
    // The R43 positive side: a student persona whose role holds stats.read@group.
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentOnStatsRoleId,
      orgRoleId: await createCustomRoleWithOnly('stats-only', 'stats.read', 'group'),
    });

    // Group memberships: studentA is a learner of the default group; the
    // teacher, the stats-holder and the educator-on-Member staff it (so the
    // R43 negative case would see data under the old persona branch).
    await seedGroupMembership({ groupId: defaultGroupId, userId: studentAId, role: 'member' });
    await seedGroupMembership({ groupId: defaultGroupId, userId: teacherId, role: 'teacher' });
    await seedGroupMembership({
      groupId: defaultGroupId,
      userId: studentOnStatsRoleId,
      role: 'teacher',
    });
    await seedGroupMembership({
      groupId: defaultGroupId,
      userId: educatorOnMemberId,
      role: 'teacher',
    });

    // Runs: A targets the default group (studentA), B targets studentB
    // directly, and the author's own run targets nobody.
    runA = await seedRun(teacherId, `roster-run-a-${tag}`);
    runB = await seedRun(teacherId, `roster-run-b-${tag}`);
    runAuthor = await seedRun(authorNoReadId, `roster-run-author-${tag}`);
    await service
      .from('assignment_targets')
      .insert({ assignment_id: runA, group_id: defaultGroupId });
    await service
      .from('assignment_targets')
      .insert({ assignment_id: runB, student_id: studentBId });

    // One completed attempt of studentA on runA, so the activity feed has a row.
    const { error: attemptError } = await service.from('quiz_attempts').insert({
      user_id: studentAId,
      assignment_id: runA,
      is_assignment_attempt: true,
      score: 1,
      total_questions: 1,
      config: { marker: `roster-${tag}` } as Json,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      completed_at: new Date().toISOString(),
    });
    if (attemptError) throw new Error(`seed attempt: ${attemptError.message}`);

    // An ownerless group: reports on it route through org_report_recipient.
    const { data: ownerless, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `roster-ownerless-${tag}`, created_by: null })
      .select('id')
      .single();
    if (groupError) throw new Error(`ownerless group: ${groupError.message}`);
    ownerlessGroupId = ownerless.id;

    manager = await signIn(`roster-manager-${tag}@dev.local`);
    teacher = await signIn(`roster-teacher-${tag}@dev.local`);
    studentA = await signIn(`roster-student-a-${tag}@dev.local`);
    studentB = await signIn(`roster-student-b-${tag}@dev.local`);
    educatorOnMember = await signIn(`roster-educator-on-member-${tag}@dev.local`);
    studentOnStatsRole = await signIn(`roster-student-on-stats-${tag}@dev.local`);
    authorNoRead = await signIn(userEmails[userIds.indexOf(authorNoReadId)]);
    for (const userId of keyUserIds) {
      keyUsers.push(await signIn(userEmails[userIds.indexOf(userId)]));
    }
  }, 120_000);

  afterAll(async () => {
    await service.from('quiz_attempts').delete().eq('assignment_id', runA);
    await service.from('assignment_targets').delete().in('assignment_id', [runA, runB, runAuthor]);
    await service.from('teacher_assignments').delete().eq('organization_id', orgId);
    await cleanupOrganizationDeep(orgId);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  it('a Member reads only their own org_members row through PostgREST', async () => {
    const own = await studentA
      .from('org_members')
      .select('user_id, organization_id')
      .eq('organization_id', orgId);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ user_id: studentAId, organization_id: orgId }]);

    const all = await studentA.from('org_members').select('user_id');
    expect(all.error).toBeNull();
    expect(all.data).toEqual([{ user_id: studentAId }]);
  });

  it.each(UNION_KEYS.map((unionKey, index) => ({ ...unionKey, index })))(
    'a role holding only $key at $scope reads the whole roster',
    async ({ index }) => {
      const rows = await keyUsers[index]
        .from('org_members')
        .select('user_id')
        .eq('organization_id', orgId);
      expect(rows.error).toBeNull();
      const ids = (rows.data ?? []).map((row) => row.user_id);
      expect(ids.length).toBeGreaterThan(1);
      expect(ids).toContain(managerId);
      expect(ids).toContain(keyUserIds[index]);
    },
  );

  it('an org admin reads the whole roster (the union carries the owner via org.admin)', async () => {
    const rows = await manager.from('org_members').select('user_id').eq('organization_id', orgId);
    expect(rows.error).toBeNull();
    expect((rows.data ?? []).length).toBeGreaterThan(1);
  });

  it('a Member reads no foreign published run and does read a targeted one', async () => {
    const seen = await studentA.from('teacher_assignments').select('id').eq('status', 'published');
    expect(seen.error).toBeNull();
    expect((seen.data ?? []).map((row) => row.id).toSorted()).toEqual([runA]);

    const seenB = await studentB.from('teacher_assignments').select('id');
    expect(seenB.error).toBeNull();
    expect((seenB.data ?? []).map((row) => row.id).toSorted()).toEqual([runB]);

    // The staff reader keeps the org view: the admin holds assignment.read.
    const seenManager = await manager.from('teacher_assignments').select('id');
    expect((seenManager.data ?? []).map((row) => row.id).toSorted()).toEqual(
      [runA, runAuthor, runB].toSorted(),
    );
  });

  it('the author reads their own run with no assignment.read', async () => {
    const own = await authorNoRead.from('teacher_assignments').select('id');
    expect(own.error).toBeNull();
    expect((own.data ?? []).map((row) => row.id)).toEqual([runAuthor]);
  });

  it('the teacher dashboard RPCs still answer for the teacher (capability stats.read@group)', async () => {
    const { data: groups, error: groupsError } = await teacher.rpc(
      'get_teacher_group_performance',
      {
        p_user_id: teacherId,
        p_organization_id: orgId,
      },
    );
    expect(groupsError).toBeNull();
    const payload = asJson<{
      groups: { groupName: string; students: number }[];
      totals: { students: number };
    }>(groups);
    expect(payload.groups.length).toBeGreaterThan(0);
    expect(payload.totals.students).toBeGreaterThan(0);

    const { data: feed, error: feedError } = await teacher.rpc('get_teacher_activity_feed', {
      p_user_id: teacherId,
      p_organization_id: orgId,
    });
    expect(feedError).toBeNull();
    const rows = asJson<{ assignmentId: string | null }[]>(feed);
    expect(rows.map((row) => row.assignmentId)).toContain(runA);
  });

  it('an educator persona on the Member role gets the empty payload from both RPCs (R43)', async () => {
    // Persona says educator, role says Member (stats.read at own only): the
    // old persona branch would have returned the data.
    const { data: groups, error: groupsError } = await educatorOnMember.rpc(
      'get_teacher_group_performance',
      { p_user_id: educatorOnMemberId, p_organization_id: orgId },
    );
    expect(groupsError).toBeNull();
    expect(groups).toEqual({
      groups: [],
      totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 },
    });

    const { data: feed, error: feedError } = await educatorOnMember.rpc(
      'get_teacher_activity_feed',
      {
        p_user_id: educatorOnMemberId,
        p_organization_id: orgId,
      },
    );
    expect(feedError).toBeNull();
    expect(feed).toEqual([]);
  });

  it('a student persona whose role holds stats.read@group gets the data (R43)', async () => {
    // Persona says student, role holds the staff-scope capability: the old
    // persona branch would have emptied the payload.
    const { data: groups, error: groupsError } = await studentOnStatsRole.rpc(
      'get_teacher_group_performance',
      { p_user_id: studentOnStatsRoleId, p_organization_id: orgId },
    );
    expect(groupsError).toBeNull();
    const payload = asJson<{ groups: { students: number }[]; totals: { students: number } }>(
      groups,
    );
    expect(payload.groups.length).toBeGreaterThan(0);
    expect(payload.totals.students).toBeGreaterThan(0);

    const { data: feed, error: feedError } = await studentOnStatsRole.rpc(
      'get_teacher_activity_feed',
      { p_user_id: studentOnStatsRoleId, p_organization_id: orgId },
    );
    expect(feedError).toBeNull();
    const rows = asJson<{ assignmentId: string | null }[]>(feed);
    expect(rows.map((row) => row.assignmentId)).toContain(runA);
  });

  it('an ownerless-group report still routes to the manager when the reporter is a learner', async () => {
    // Real cookie-jar session through the API route (R41): the learner's JWT
    // is what PostgREST enforces, and the recipient lookup must go through the
    // org_report_recipient RPC because the learner cannot read the roster row.
    const jar = new Map<string, string>();
    const build = () =>
      createServerClient<Database>(url, anonKey, {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            for (const { name, value } of cookiesToSet) jar.set(name, value);
          },
        },
      });
    const { error: signInError } = await build().auth.signInWithPassword({
      email: `roster-student-a-${tag}@dev.local`,
      password: PASSWORD,
    });
    if (signInError) throw new Error(`signIn failed: ${signInError.message}`);

    vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(build()));

    const req = createNextRequest(
      `${BASE_URL}/api/v1/organization/groups/${ownerlessGroupId}/reports`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `learner report ${tag}` }),
      },
      { active_org_id: orgId },
    );
    const res = await createGroupReport(req, { params: Promise.resolve({ id: ownerlessGroupId }) });
    expect(res.status).toBe(201);
    const body = asJson<{ success: boolean; data: { id: string; teacher_id: string } }>(
      await res.json(),
    );
    expect(body.data.teacher_id).toBe(managerId);

    await service.from('question_report_messages').delete().eq('report_id', body.data.id);
    await service.from('question_reports').delete().eq('group_id', ownerlessGroupId);
  });
});
