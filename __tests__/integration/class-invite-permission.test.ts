import { readFileSync } from 'node:fs';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { before, createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  mockUser,
  seedGroupMembership,
  seedOrgMembership,
  seedOrganization,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import {
  GET as inviteGet,
  POST as invitePost,
} from '@/app/(backend)/api/v1/organization/invites/route';
import { POST as acceptPost } from '@/app/(backend)/api/v1/organization/invites/accept/route';
import { DELETE as inviteDelete } from '@/app/(backend)/api/v1/organization/invites/[id]/route';

/**
 * Class invites (ADR-0015 §4.3, §10, §15 #7; D7; R4, R25) — slice 2b-5.
 *
 * The matrix, through the real routes + `withAuth` AND through PostgREST with
 * real signed-in sessions:
 *
 * - an ORG invite (no `groupId`) is `org.invitation.manage`: the Admin-role
 *   manager creates, lists and revokes;
 * - a CLASS invite (`groupId` + `groupRole`) is `group.invite` on that group:
 *   a Teacher-role holder who teaches the class creates it, is refused for
 *   another class of the same org (API 403, PostgREST 42501), and is refused
 *   for an org invite at all (the teacher-name exception is deleted);
 * - a Member-role caller is refused everywhere;
 * - a foreign-org group is 404, a non-member invitee is 422 (D7), a half-set
 *   class target or a role outside `group_members.role` is 422;
 * - accept adds the group membership with `target_group_role` (idempotent
 *   upsert) and never touches the existing member's org role; a tampered
 *   class invite for a non-member is refused by the RPC itself (GONE, no
 *   membership written), and a tampered class invite for an EXISTING member
 *   carrying the Admin target still leaves `org_members.org_role_id` alone
 *   (the accept branch's org_members write is a no-op — mutation-proven);
 * - the write trigger normalizes a class row's `target_org_role_id` to the
 *   system `member` role, so a `group.invite` holder cannot persist a class
 *   invite whose target org role is Admin;
 * - the token preview exposes the group name/role of the invite's own org.
 */

const PASSWORD = 'ClassInvite!2b5';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      'class-invite-permission needs SUPABASE_DB_URL pointing at this checkout’s local Supabase. ' +
        'Run the suite through `bun run env:run -- bunx vitest run …`.',
    );
  }
  return localDatabaseUrl;
}

/** Replay the shipped 2b-5 migration so a reverted predicate cannot survive. */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync('supabase/migrations/20261120170000_class_invites.sql', 'utf8'));
  } finally {
    await sql.end();
  }
}

function newClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

function postInvite(body: unknown, activeOrgId: string) {
  return createNextRequest(
    'http://localhost/api/v1/organization/invites',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { active_org_id: activeOrgId },
  );
}

const expiry = () => new Date(Date.now() + 86_400_000).toISOString();

interface ApiErrorBody {
  success: boolean;
  error?: string;
  issues?: unknown[];
}

interface InviteCreatedBody {
  success: boolean;
  data: { success: boolean; invitationId: string; inviteLink: string; inviteCode: string };
}

interface InvitePreviewBody {
  success?: boolean;
  data: {
    email: string;
    organizationName: string;
    orgRoleName: string;
    groupId: string | null;
    groupName: string | null;
    groupRole: string | null;
  };
}

describe('class invites (2b-5) — API + PostgREST', () => {
  const service = createTypedServiceClient();

  let admin!: TestUserFixture; // manager persona, Admin role of org A
  let teacher!: TestUserFixture; // educator persona, Teacher role, teaches G1 only
  let student!: TestUserFixture; // student persona, Member role (existing org member)
  let outsider!: TestUserFixture; // student persona, NOT a member of org A

  let orgId!: string;
  let foreignOrgId!: string;
  let adminRoleId!: string;
  let teacherRoleId!: string;
  let memberRoleId!: string;
  let foreignMemberRoleId!: string;
  let taughtGroupId!: string;
  let otherGroupId!: string;
  let foreignGroupId!: string;

  let adminSession!: SupabaseClient<Database>;
  let teacherSession!: SupabaseClient<Database>;
  let studentSession!: SupabaseClient<Database>;

  async function createAuthUser(
    email: string,
    label: string,
    accountType: string,
  ): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  async function roleIdOf(organizationId: string, name: string): Promise<string> {
    const { data: role } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('name', name)
      .single();
    if (!role) throw new Error(`role ${name} not found for ${organizationId}`);
    return role.id;
  }

  async function createGroup(organizationId: string, name: string): Promise<string> {
    const { data: group, error } = await service
      .from('groups')
      .insert({ organization_id: organizationId, name })
      .select('id')
      .single();
    if (error) throw new Error(`group insert failed: ${error.message}`);
    return group.id;
  }

  beforeAll(async () => {
    await installShippedSql();

    const fixture = await before({ role: 'manager', org: true });
    admin = fixture.user;
    orgId = fixture.orgId!;
    // launch caps max_students at 5 and this fixture org already has 5 members;
    // the accept cases need headroom.
    const { error: planError } = await service.rpc('apply_org_plan', {
      p_org_id: orgId,
      p_plan: 'hub',
    });
    if (planError) throw new Error(`apply_org_plan failed: ${planError.message}`);
    adminRoleId = await roleIdOf(orgId, 'admin');
    teacherRoleId = await roleIdOf(orgId, 'teacher');
    memberRoleId = await roleIdOf(orgId, 'member');

    const foreign = await seedOrganization(`class-invite-foreign-${tag}`);
    foreignOrgId = foreign.org.id;
    foreignMemberRoleId = await roleIdOf(foreignOrgId, 'member');
    foreignGroupId = await createGroup(foreignOrgId, `foreign-class-${tag}`);

    taughtGroupId = await createGroup(orgId, `taught-class-${tag}`);
    otherGroupId = await createGroup(orgId, `other-class-${tag}`);

    // Teacher: educator persona on the org Teacher role, teaching G1 only.
    teacher = await createTestUser({ role: 'educator' });
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacher.id,
      orgRoleId: teacherRoleId,
    });
    await seedGroupMembership({ groupId: taughtGroupId, userId: teacher.id, role: 'teacher' });

    // Student: an EXISTING org member (the D7 invitee), already in G1 as member.
    student = await createTestUser({ role: 'student' });
    await seedOrgMembership({ organizationId: orgId, userId: student.id, orgRoleId: memberRoleId });
    await seedGroupMembership({ groupId: taughtGroupId, userId: student.id, role: 'member' });

    // Outsider: not a member of org A — D7 refuses a class invite for them.
    outsider = await createTestUser({ role: 'student' });

    // Real signed-in sessions for the PostgREST half.
    const teacherAuthId = await createAuthUser(
      `class-invite-teacher-${tag}@dev.local`,
      'teacher',
      'educator',
    );
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherAuthId,
      orgRoleId: teacherRoleId,
    });
    await seedGroupMembership({ groupId: taughtGroupId, userId: teacherAuthId, role: 'teacher' });
    teacherSession = await signIn(`class-invite-teacher-${tag}@dev.local`, PASSWORD);

    const studentAuthId = await createAuthUser(
      `class-invite-student-${tag}@dev.local`,
      'student',
      'student',
    );
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentAuthId,
      orgRoleId: memberRoleId,
    });
    studentSession = await signIn(`class-invite-student-${tag}@dev.local`, PASSWORD);

    adminSession = await signIn(admin.email, 'Seed4Test!');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
    await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
  });

  describe('API — org invite is org.invitation.manage', () => {
    it('lets the Admin-role manager create, list and revoke an org invite', async () => {
      mockUser(admin);
      const email = `org-invite-${tag}@example.com`;

      const createRes = await invitePost(
        postInvite({ email, targetOrgRoleId: memberRoleId }, orgId),
      );
      const created = await json<InviteCreatedBody>(createRes);
      expect(createRes.status).toBe(201);
      expect(created.data.invitationId).toBeTruthy();

      const { data: row } = await service
        .from('invitations')
        .select('id, group_id, target_group_role')
        .eq('email', email)
        .single();
      expect(row.group_id).toBeNull();
      expect(row.target_group_role).toBeNull();

      const listRes = await inviteGet(
        createNextRequest(
          'http://localhost/api/v1/organization/invites?isAccepted=false',
          undefined,
          { active_org_id: orgId },
        ),
      );
      expect(listRes.status).toBe(200);
      const list = await json<{ data: Array<{ id: string }> }>(listRes);
      expect(list.data.some((i) => i.id === row.id)).toBe(true);

      const { request, params } = await import('#test/integration/test-utils').then((m) =>
        m.createNextRequestWithParams(
          `http://localhost/api/v1/organization/invites/${row.id}`,
          { id: row.id },
          { method: 'DELETE' },
          { active_org_id: orgId },
        ),
      );
      const deleteRes = await inviteDelete(request, { params });
      expect(deleteRes.status).toBe(200);
      const { data: gone } = await service.from('invitations').select('id').eq('id', row.id);
      expect(gone).toEqual([]);
    });

    it('refuses an org invite for the Teacher-role holder (teacher-name exception deleted)', async () => {
      mockUser(teacher);
      const email = `teacher-org-${tag}@example.com`;

      const res = await invitePost(postInvite({ email, targetOrgRoleId: memberRoleId }, orgId));
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    it('refuses a class invite for a Member-role caller', async () => {
      mockUser(student);
      const email = `member-class-${tag}@example.com`;

      const res = await invitePost(
        postInvite(
          {
            email,
            targetOrgRoleId: memberRoleId,
            groupId: taughtGroupId,
            groupRole: 'member',
          },
          orgId,
        ),
      );
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });
  });

  describe('API — class invite is group.invite on the group', () => {
    it('lets a teacher of the class create a class invite for an existing org member', async () => {
      mockUser(teacher);

      const res = await invitePost(
        postInvite(
          {
            email: student.email,
            targetOrgRoleId: memberRoleId,
            groupId: taughtGroupId,
            groupRole: 'member',
          },
          orgId,
        ),
      );
      const created = await json<InviteCreatedBody>(res);

      expect(res.status).toBe(201);
      expect(created.success).toBe(true);

      const { data: row } = await service
        .from('invitations')
        .select('id, group_id, target_group_role, organization_id')
        .eq('id', created.data.invitationId)
        .single();
      expect(row?.group_id).toBe(taughtGroupId);
      expect(row?.target_group_role).toBe('member');
      expect(row?.organization_id).toBe(orgId);
    });

    it('refuses a class invite for another class of the same org (403)', async () => {
      mockUser(teacher);
      const email = `other-class-${tag}@example.com`;

      const res = await invitePost(
        postInvite(
          { email, targetOrgRoleId: memberRoleId, groupId: otherGroupId, groupRole: 'member' },
          orgId,
        ),
      );
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    it('returns 404 for a group of another organization', async () => {
      mockUser(teacher);
      const email = `foreign-group-${tag}@example.com`;

      const res = await invitePost(
        postInvite(
          { email, targetOrgRoleId: memberRoleId, groupId: foreignGroupId, groupRole: 'member' },
          orgId,
        ),
      );
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(404);
      expect(body.error).toBe('NOT_FOUND');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    it('returns 422 for a class invite whose invitee is not an org member (D7)', async () => {
      mockUser(teacher);
      const email = outsider.email;

      const res = await invitePost(
        postInvite(
          { email, targetOrgRoleId: memberRoleId, groupId: taughtGroupId, groupRole: 'member' },
          orgId,
        ),
      );
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(422);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      // The issue tree names the offending entry field.
      expect(JSON.stringify(body.issues)).toContain('email');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    it('returns 422 when groupId is set without groupRole, and for a role outside group_members.role', async () => {
      mockUser(teacher);

      const halfSet = await invitePost(
        postInvite(
          {
            email: `half-${tag}@example.com`,
            targetOrgRoleId: memberRoleId,
            groupId: taughtGroupId,
          },
          orgId,
        ),
      );
      expect(halfSet.status).toBe(422);

      const badRole = await invitePost(
        postInvite(
          {
            email: `bad-role-${tag}@example.com`,
            targetOrgRoleId: memberRoleId,
            groupId: taughtGroupId,
            groupRole: 'admin',
          },
          orgId,
        ),
      );
      expect(badRole.status).toBe(422);
    });
  });

  describe('PostgREST — the same split at the table', () => {
    it('lets the teacher insert a class invite for the taught class and refuses the other class', async () => {
      const teacherId = (await teacherSession.auth.getUser()).data.user!.id;
      const classOk = await teacherSession.from('invitations').insert({
        email: `pg-taught-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: teacherId,
        group_id: taughtGroupId,
        target_group_role: 'member',
        expires_at: expiry(),
      });
      expect(classOk.error).toBeNull();

      const classOther = await teacherSession.from('invitations').insert({
        email: `pg-other-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: teacherId,
        group_id: otherGroupId,
        target_group_role: 'member',
        expires_at: expiry(),
      });
      expect(classOther.error?.code).toBe('42501');

      const orgInsert = await teacherSession.from('invitations').insert({
        email: `pg-org-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: teacherId,
        expires_at: expiry(),
      });
      expect(orgInsert.error?.code).toBe('42501');
    });

    it('refuses every invitation write for a Member-role session and hides the rows', async () => {
      const studentId = (await studentSession.auth.getUser()).data.user!.id;

      const insert = await studentSession.from('invitations').insert({
        email: `pg-member-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: studentId,
        group_id: taughtGroupId,
        target_group_role: 'member',
        expires_at: expiry(),
      });
      expect(insert.error?.code).toBe('42501');

      const read = await studentSession
        .from('invitations')
        .select('id')
        .eq('organization_id', orgId);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
    });

    it('lets the teacher read their own class invite through the class branch', async () => {
      const teacherId = (await teacherSession.auth.getUser()).data.user!.id;
      const { data: row } = await service
        .from('invitations')
        .insert({
          email: `pg-own-${tag}@example.com`,
          target_org_role_id: memberRoleId,
          organization_id: orgId,
          inviter_id: teacherId,
          group_id: taughtGroupId,
          target_group_role: 'member',
          expires_at: expiry(),
        })
        .select('id, token')
        .single();
      if (!row) throw new Error('seed insert failed');

      const read = await teacherSession
        .from('invitations')
        .select('id, group_id, target_group_role')
        .eq('id', row.id);
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(1);
      expect(read.data[0]?.group_id).toBe(taughtGroupId);
      expect(read.data[0]?.target_group_role).toBe('member');
    });

    it('lets the org.invitation.manage holder insert an org invite but not a class invite without group.invite', async () => {
      const adminId = (await adminSession.auth.getUser()).data.user!.id;

      const orgInsert = await adminSession.from('invitations').insert({
        email: `pg-admin-org-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: adminId,
        expires_at: expiry(),
      });
      expect(orgInsert.error).toBeNull();

      // The Admin role holds group.* at organization scope, so it reaches the
      // class branch too — the strict split is about the KEY, not the persona.
      const classInsert = await adminSession.from('invitations').insert({
        email: `pg-admin-class-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: adminId,
        group_id: otherGroupId,
        target_group_role: 'teacher',
        expires_at: expiry(),
      });
      expect(classInsert.error).toBeNull();
    });

    it('keeps the tenant floor: a foreign-org class invite is refused and writes no row', async () => {
      const teacherId = (await teacherSession.auth.getUser()).data.user!.id;
      const foreign = await teacherSession.from('invitations').insert({
        email: `pg-foreign-${tag}@example.com`,
        target_org_role_id: foreignMemberRoleId,
        organization_id: foreignOrgId,
        inviter_id: teacherId,
        group_id: foreignGroupId,
        target_group_role: 'member',
        expires_at: expiry(),
      });
      // The write trigger reads `org_roles` under the caller's RLS, so a
      // cross-org row trips its 23514 before the policy's 42501 — either way
      // the row is refused and nothing is written.
      expect(['23514', '42501']).toContain(foreign.error?.code);
      const { data: rows } = await service
        .from('invitations')
        .select('id')
        .eq('email', `pg-foreign-${tag}@example.com`);
      expect(rows).toEqual([]);
    });

    it('normalizes a class invite target org role to the system member role at the table', async () => {
      // A `group.invite` holder can mint the row, but the write trigger forces
      // a class row's `target_org_role_id` to the system `member` role: the
      // row cannot carry the Admin target (or any other org authority).
      const teacherId = (await teacherSession.auth.getUser()).data.user!.id;
      const { data: row, error } = await teacherSession
        .from('invitations')
        .insert({
          email: `pg-admin-target-${tag}@example.com`,
          target_org_role_id: adminRoleId,
          organization_id: orgId,
          inviter_id: teacherId,
          group_id: taughtGroupId,
          target_group_role: 'member',
          expires_at: expiry(),
        })
        .select('id, target_org_role_id')
        .single();
      expect(error).toBeNull();
      expect(row?.target_org_role_id).toBe(memberRoleId);
    });
  });

  /** Mint a class invite for the seeded student through the real POST route. */
  async function mintClassInvite(): Promise<{ token: string; id: string }> {
    mockUser(teacher);
    // D7: the invitee must be an existing org member.
    const res = await invitePost(
      postInvite(
        {
          email: student.email,
          targetOrgRoleId: memberRoleId,
          groupId: taughtGroupId,
          groupRole: 'member',
        },
        orgId,
      ),
    );
    expect(res.status).toBe(201);
    const created = await json<InviteCreatedBody>(res);
    return { token: created.data.inviteCode, id: created.data.invitationId };
  }

  describe('preview + accept — the class target flows through', () => {
    it('exposes the group name/role in the public token preview', async () => {
      const { token } = await mintClassInvite();

      useRealSupabase();
      const res = await inviteGet(
        createNextRequest(`http://localhost/api/v1/organization/invites?token=${token}`),
      );
      const body = await json<InvitePreviewBody>(res);

      expect(res.status).toBe(200);
      expect(body.data.groupName).toBe(`taught-class-${tag}`);
      expect(body.data.groupRole).toBe('member');
      expect(body.data.groupId).toBe(taughtGroupId);
      expect(body.data.organizationName).toBeTruthy();
      // No inviter identity, no other org's data in the preview.
      expect(JSON.stringify(body.data)).not.toContain('inviter');
    });

    it('accept adds the group membership with the invited role and keeps the org role (idempotent)', async () => {
      const { token } = await mintClassInvite();

      mockUser(student);
      const acceptRes = await acceptPost(
        createNextRequest('http://localhost/api/v1/organization/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }),
      );
      expect(acceptRes.status).toBe(200);

      // The student was already a member of G1: the upsert is idempotent —
      // exactly one row, with the invited role.
      const { data: rows } = await service
        .from('group_members')
        .select('group_id, user_id, role')
        .eq('group_id', taughtGroupId)
        .eq('user_id', student.id);
      expect(rows).toHaveLength(1);
      expect(rows?.[0]?.role).toBe('member');

      // The org membership keeps the member's existing org role — a class
      // invite never grants or changes it.
      const { data: membership } = await service
        .from('org_members')
        .select('org_role_id')
        .eq('organization_id', orgId)
        .eq('user_id', student.id)
        .single();
      expect(membership?.org_role_id).toBe(memberRoleId);

      // Re-accepting the consumed token is GONE and changes nothing.
      const again = await acceptPost(
        createNextRequest('http://localhost/api/v1/organization/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }),
      );
      expect(again.status).toBe(410);
      const { data: after } = await service
        .from('group_members')
        .select('role')
        .eq('group_id', taughtGroupId)
        .eq('user_id', student.id)
        .single();
      expect(after?.role).toBe('member');
    });

    it('accept of a class invite upgrades the group role when the invite says so', async () => {
      // A second student, not yet in G1.
      const second = await createTestUser({ role: 'student' });
      await seedOrgMembership({
        organizationId: orgId,
        userId: second.id,
        orgRoleId: memberRoleId,
      });

      mockUser(teacher);
      const res = await invitePost(
        postInvite(
          {
            email: second.email,
            targetOrgRoleId: memberRoleId,
            groupId: taughtGroupId,
            groupRole: 'teacher',
          },
          orgId,
        ),
      );
      expect(res.status).toBe(201);
      const created = await json<InviteCreatedBody>(res);

      mockUser(second);
      const acceptRes = await acceptPost(
        createNextRequest('http://localhost/api/v1/organization/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: created.data.inviteCode }),
        }),
      );
      expect(acceptRes.status).toBe(200);

      const { data: row } = await service
        .from('group_members')
        .select('role')
        .eq('group_id', taughtGroupId)
        .eq('user_id', second.id)
        .single();
      expect(row?.role).toBe('teacher');
    });

    it('refuses a tampered class invite for a non-member at the RPC (no membership written)', async () => {
      // Inserted on the service role, bypassing the API's D7 check: the accept
      // RPC itself must refuse to create an org membership from a class invite.
      const { data: row, error } = await service
        .from('invitations')
        .insert({
          email: outsider.email,
          target_org_role_id: adminRoleId,
          organization_id: orgId,
          inviter_id: admin.id,
          group_id: taughtGroupId,
          target_group_role: 'member',
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .select('id, token')
        .single();
      if (error) throw new Error(`seed insert failed: ${error.message}`);

      mockUser(outsider);
      const acceptRes = await acceptPost(
        createNextRequest('http://localhost/api/v1/organization/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: row.token }),
        }),
      );
      expect(acceptRes.status).toBe(410);

      const { data: membership } = await service
        .from('org_members')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', outsider.id);
      expect(membership).toEqual([]);
      const { data: groupRow } = await service
        .from('group_members')
        .select('id')
        .eq('group_id', taughtGroupId)
        .eq('user_id', outsider.id);
      expect(groupRow).toEqual([]);
      // The claim was rolled back with the refusal: the token stays usable.
      const { data: invite } = await service
        .from('invitations')
        .select('is_accepted')
        .eq('id', row.id)
        .single();
      expect(invite?.is_accepted).not.toBe(true);
    });

    it('accept of a tampered class invite (target org role Admin) keeps the existing member org role', async () => {
      // Seeded past the write trigger (`session_replication_role = replica` on
      // a direct connection): a class row still carrying the Admin target is
      // exactly what a manual write or a future regression can leave behind,
      // and the accept branch ALONE must be safe against it. The mutation
      // proof for this case flips the class branch's `do nothing` to
      // `do update set org_role_id = excluded.org_role_id` and must go red.
      const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
      try {
        await sql`set session_replication_role = replica`;
        const [seeded] = await sql<Array<{ id: string; token: string }>>`
          insert into public.invitations
            (email, target_org_role_id, organization_id, inviter_id, group_id, target_group_role, expires_at)
          values
            (${student.email}, ${adminRoleId}, ${orgId}, ${admin.id}, ${otherGroupId}, 'teacher', ${expiry()})
          returning id, token
        `;
        if (!seeded) throw new Error('tampered class invite seed failed');

        mockUser(student);
        const acceptRes = await acceptPost(
          createNextRequest('http://localhost/api/v1/organization/invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: seeded.token }),
          }),
        );
        expect(acceptRes.status).toBe(200);
      } finally {
        await sql.end();
      }

      // The group membership IS added, with the invited group role.
      const { data: groupRows } = await service
        .from('group_members')
        .select('group_id, user_id, role')
        .eq('group_id', otherGroupId)
        .eq('user_id', student.id);
      expect(groupRows).toHaveLength(1);
      expect(groupRows?.[0]?.role).toBe('teacher');

      // The org membership is untouched: still exactly the member role — a
      // class invite never grants or changes it, whatever the row carries.
      const { data: membership } = await service
        .from('org_members')
        .select('org_role_id')
        .eq('organization_id', orgId)
        .eq('user_id', student.id)
        .single();
      expect(membership?.org_role_id).toBe(memberRoleId);
    });
  });
});
