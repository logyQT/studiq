import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { Database } from '@studiq/server/types/database';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import {
  DELETE as deleteMember,
  GET as getMembers,
  PUT as putMembers,
} from '@/app/(backend)/api/v1/organization/members/route';
import {
  GET as getOrganization,
  PUT as putOrganization,
} from '@/app/(backend)/api/v1/organization/[id]/route';
import { GET as getRoles, POST as postRole } from '@/app/(backend)/api/v1/organization/roles/route';
import { GET as getRole } from '@/app/(backend)/api/v1/organization/roles/[id]/route';
import { GET as getInvites } from '@/app/(backend)/api/v1/organization/invites/route';
import {
  PUT as updateInvite,
  DELETE as removeInvite,
} from '@/app/(backend)/api/v1/organization/invites/[id]/route';
import {
  GET as getPools,
  POST as postPool,
} from '@/app/(backend)/api/v1/organization/seats/pools/route';
import {
  GET as getAssignments,
  POST as postAssignment,
} from '@/app/(backend)/api/v1/organization/seats/assignments/route';
import { DELETE as deleteAssignment } from '@/app/(backend)/api/v1/organization/seats/assignments/[id]/route';

/**
 * ADR-0015 §7 (and D13): the org-control routes authorize on `org.*`
 * permissions, decided from the context alone. This file drives the real route
 * handlers through the real `withAuth`, controller and service with real
 * signed-in sessions, so the context (permission scopes) is the one `withAuth`
 * builds. The RLS twin is `org-control-permission-rls.test.ts`.
 *
 * The positive caller holds a custom role carrying only the four keys — never
 * the Admin system role — so the cases pin the permission, not the role name.
 */

const PASSWORD = 'OrgControlApi!';

interface Session {
  build: () => SupabaseClient<Database>;
}

async function signIn(email: string): Promise<Session> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            for (const { name, value } of cookiesToSet) jar.set(name, value);
          },
        },
      },
    );

  const { error } = await build().auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`[setup] signIn failed for ${email}: ${error.message}`);
  return { build };
}

type Request = ReturnType<typeof createNextRequest>;

function sessionRequest(
  session: Session,
  url: string,
  init: RequestInit | undefined,
  orgId: string | null,
): Request {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  return createNextRequest(
    `http://localhost${url}`,
    init,
    orgId ? { active_org_id: orgId } : undefined,
  );
}

/** One request through a route handler with no `[param]` segment. */
async function call(
  session: Session,
  handler: (req: Request) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
  orgId: string | null,
): Promise<{ status: number; body: unknown }> {
  const response = await handler(sessionRequest(session, url, init, orgId));
  return { status: response.status, body: await response.json() };
}

/** One request through a route handler with no session and no cookie jar at all. */
async function callAnonymous(
  handler: (req: Request) => Promise<Response>,
  url: string,
): Promise<{ status: number; body: unknown }> {
  // A session client must not be built at all: if the handler reaches the
  // authenticated wrapper, `withAuth` calls this and the request fails loudly
  // instead of borrowing the implementation a previous case installed.
  vi.mocked(supabaseModule.createClient).mockReset();
  vi.mocked(supabaseModule.createClient).mockRejectedValue(
    new Error('an anonymous request reached the session client'),
  );
  const response = await handler(createNextRequest(`http://localhost${url}`));
  return { status: response.status, body: await response.json() };
}

/** One request through a route handler whose path carries `[id]`. */
async function callWithId(
  session: Session,
  handler: (req: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
  orgId: string | null,
  id: string,
): Promise<{ status: number; body: unknown }> {
  const response = await handler(sessionRequest(session, url, init, orgId), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: await response.json() };
}

/** The created pool id, or a failure naming the envelope the route returned. */
function createdPoolId(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const { data } = body;
    if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') {
      return data.id;
    }
  }
  throw new Error(`expected a created pool: ${JSON.stringify(body)}`);
}

/** The `data` array a list route returns, or `null`. */
function listData(body: unknown): unknown[] | null {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const { data } = body;
    return Array.isArray(data) ? data : null;
  }
  return null;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('org-control routes authorize on org permissions', () => {
  const service = createTypedServiceClient();
  const tag = `${Date.now()}`;

  let orgId: string;
  let foreignOrgId: string;
  let memberRoleId: string;
  let teacherRoleId: string;
  let holderRoleId: string;

  let holder: TestUserFixture;
  let member: TestUserFixture;
  let studentAdmin: TestUserFixture;
  let outsider: TestUserFixture;
  let disposable: TestUserFixture;
  let educatorHolder: TestUserFixture;
  let classManager: TestUserFixture;
  let classInviter: TestUserFixture;
  let billing: TestUserFixture;
  let settingsOnly: TestUserFixture;

  let holderSession: Session;
  let educatorHolderSession: Session;
  let memberSession: Session;
  let studentAdminSession: Session;
  let outsiderSession: Session;
  let classManagerSession: Session;
  let classInviterSession: Session;
  let billingSession: Session;
  let settingsOnlySession: Session;

  async function roleWith(
    organizationId: string,
    name: string,
    keys: string[],
    scope: 'group' | 'organization' = 'organization',
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`[setup] role ${name}: ${error.message}`);

    if (keys.length > 0) {
      const { error: permissionError } = await service
        .from('org_role_permissions')
        .insert(keys.map((key) => ({ org_role_id: role.id, permission_key: key, scope })));
      if (permissionError) {
        throw new Error(`[setup] permissions ${name}: ${permissionError.message}`);
      }
    }

    return role.id;
  }

  beforeAll(async () => {
    const org = await seedOrganization(`org-control-api-${tag}`);
    orgId = org.org.id;
    memberRoleId = org.memberRoleId;
    teacherRoleId = org.teacherRoleId;

    const foreignOrg = await seedOrganization(`org-control-api-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    holderRoleId = await roleWith(orgId, `org-control-holder-${tag}`, [
      'org.settings.manage',
      'org.member.manage',
      'org.seat.manage',
      'org.invitation.manage',
    ]);

    holder = await createTestUser({ role: 'manager', password: PASSWORD });
    member = await createTestUser({ role: 'student', password: PASSWORD });
    studentAdmin = await createTestUser({ role: 'student', password: PASSWORD });
    outsider = await createTestUser({ role: 'manager', password: PASSWORD });
    disposable = await createTestUser({ role: 'student', password: PASSWORD });
    // An educator persona holding the roster key: the old service narrowed an
    // educator's list to the classes they belong to, which is a persona rule.
    const educatorHolderRoleId = await roleWith(orgId, `org-member-educator-${tag}`, [
      'org.member.manage',
    ]);
    educatorHolder = await createTestUser({ role: 'educator', password: PASSWORD });

    // D25: a Teacher's roster keys sit at `group` scope and never carry
    // `org.member.manage` (D18/FP-04). One caller per branch, nothing else.
    const classManagerRoleId = await roleWith(
      orgId,
      `org-member-class-manager-${tag}`,
      ['group.manage'],
      'group',
    );
    const classInviterRoleId = await roleWith(
      orgId,
      `org-member-class-inviter-${tag}`,
      ['group.invite'],
      'group',
    );
    classManager = await createTestUser({ role: 'educator', password: PASSWORD });
    classInviter = await createTestUser({ role: 'educator', password: PASSWORD });

    // D25's fourth branch, as shipped: the Billing preset is exactly
    // `org.billing.manage` + `org.seat.manage`, and `/manage/seats` fills its
    // assign dialog from this endpoint.
    const billingRoleId = await roleWith(orgId, `org-member-billing-${tag}`, [
      'org.billing.manage',
      'org.seat.manage',
    ]);
    billing = await createTestUser({ role: 'manager', password: PASSWORD });

    // The deny control is a *custom* role with keys and none of them the four
    // read authorities, so the empty answer cannot be the Member role's alone.
    const settingsOnlyRoleId = await roleWith(orgId, `org-member-settings-${tag}`, [
      'org.settings.manage',
    ]);
    settingsOnly = await createTestUser({ role: 'manager', password: PASSWORD });

    await seedOrgMembership({ organizationId: orgId, userId: holder.id, orgRoleId: holderRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: educatorHolder.id,
      orgRoleId: educatorHolderRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: classManager.id,
      orgRoleId: classManagerRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: classInviter.id,
      orgRoleId: classInviterRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: billing.id,
      orgRoleId: billingRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: settingsOnly.id,
      orgRoleId: settingsOnlyRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: member.id,
      orgRoleId: memberRoleId,
    });
    // D13: a `student` persona may hold the Admin role.
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentAdmin.id,
      orgRoleId: org.adminRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: disposable.id,
      orgRoleId: memberRoleId,
    });
    await seedOrgMembership({
      organizationId: foreignOrgId,
      userId: outsider.id,
      orgRoleId: foreignOrg.memberRoleId,
    });

    holderSession = await signIn(holder.email);
    educatorHolderSession = await signIn(educatorHolder.email);
    memberSession = await signIn(member.email);
    studentAdminSession = await signIn(studentAdmin.email);
    outsiderSession = await signIn(outsider.email);
    classManagerSession = await signIn(classManager.email);
    classInviterSession = await signIn(classInviter.email);
    billingSession = await signIn(billing.email);
    settingsOnlySession = await signIn(settingsOnly.email);
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId).catch(() => {});
    if (foreignOrgId) await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
  });

  describe('org.settings.manage', () => {
    it('lets the holder rename the org', async () => {
      const { status } = await callWithId(
        holderSession,
        putOrganization,
        `/api/v1/organization/${orgId}`,
        jsonInit('PUT', { name: `renamed-${tag}` }),
        orgId,
        orgId,
      );

      expect(status).toBe(200);
    });

    it('refuses a Member-role caller and leaves the name untouched', async () => {
      const { status, body } = await callWithId(
        memberSession,
        putOrganization,
        `/api/v1/organization/${orgId}`,
        jsonInit('PUT', { name: `stolen-${tag}` }),
        orgId,
        orgId,
      );

      expect(status).toBe(403);
      expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });

      const { data } = await service.from('organizations').select('name').eq('id', orgId).single();
      expect(data?.name).not.toBe(`stolen-${tag}`);
    });

    it('keeps GET readable for an org member', async () => {
      const { status } = await callWithId(
        memberSession,
        getOrganization,
        `/api/v1/organization/${orgId}`,
        undefined,
        orgId,
        orgId,
      );

      expect(status).toBe(200);
    });
  });

  describe('org.member.manage', () => {
    it('lists the roster for the holder', async () => {
      const { status, body } = await call(
        holderSession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );
      expect(status).toBe(200);
      expect(listData(body)?.length ?? 0).toBeGreaterThanOrEqual(5);
    });

    // D25: the roster has four read authorities. Each case is a caller whose
    // role carries one of them and nothing else, so it pins that branch.
    it('lists the roster for a group.manage-only caller (a class manager)', async () => {
      const { status, body } = await call(
        classManagerSession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      expect(listData(body)?.length ?? 0).toBeGreaterThanOrEqual(5);
    });

    it('lists the roster for a group.invite-only caller (a class inviter)', async () => {
      const { status, body } = await call(
        classInviterSession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      expect(listData(body)?.length ?? 0).toBeGreaterThanOrEqual(5);
    });

    it('lists the roster for the Billing preset (org.billing.manage + org.seat.manage)', async () => {
      const { status, body } = await call(
        billingSession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      expect(listData(body)?.length ?? 0).toBeGreaterThanOrEqual(5);
      // The seat picker needs the people, not just a non-empty envelope.
      expect(JSON.stringify(body)).toContain(member.email);
    });

    // The deny shape is an empty list, not a 403 (AUT-19 accepts either). The
    // body is pinned exactly: a status-only assertion would pass on a leak.
    it('answers a Member-role caller with an empty list and no roster data', async () => {
      const { status, body } = await call(
        memberSession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: [] });

      const raw = JSON.stringify(body);
      for (const account of [
        holder,
        member,
        studentAdmin,
        educatorHolder,
        classManager,
        classInviter,
        billing,
        settingsOnly,
        outsider,
        disposable,
      ]) {
        expect(raw).not.toContain(account.email);
        expect(raw).not.toContain(account.id);
      }
      expect(raw).not.toContain('@');
    });

    it('answers a custom role with none of the four read keys with an empty list', async () => {
      const { status, body } = await call(
        settingsOnlySession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: [] });
    });

    it('lists the whole org roster for an educator who holds the key, not only their classes', async () => {
      const { status, body } = await call(
        educatorHolderSession,
        getMembers,
        '/api/v1/organization/members',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      // This caller teaches no class; the retired persona branch would answer [].
      expect(listData(body)?.length ?? 0).toBeGreaterThanOrEqual(5);
    });

    it('still refuses a Member-role role change with a valid body', async () => {
      const { status, body } = await call(
        memberSession,
        putMembers,
        '/api/v1/organization/members',
        jsonInit('PUT', { targetUserId: disposable.id, newOrgRoleId: teacherRoleId }),
        orgId,
      );

      expect(status).toBe(403);
      expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });

      const { data } = await service
        .from('org_members')
        .select('org_role_id')
        .eq('organization_id', orgId)
        .eq('user_id', disposable.id)
        .single();
      expect(data?.org_role_id).toBe(memberRoleId);
    });

    it('lets the holder move a member between roles', async () => {
      const { status } = await call(
        holderSession,
        putMembers,
        '/api/v1/organization/members',
        jsonInit('PUT', { targetUserId: disposable.id, newOrgRoleId: teacherRoleId }),
        orgId,
      );

      expect(status).toBe(200);
    });

    it('refuses a Member-role caller before reading a body-less DELETE (#189 shape)', async () => {
      const { status, body } = await call(
        memberSession,
        deleteMember,
        `/api/v1/organization/members?userId=${disposable.id}`,
        { method: 'DELETE' },
        orgId,
      );

      // 400 would be the empty stream being parsed before the gate.
      expect(status).toBe(403);
      expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });

      const { data } = await service
        .from('org_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', disposable.id);
      expect(data).toHaveLength(1);
    });
  });

  describe('org.seat.manage', () => {
    let poolId: string;

    it('refuses a Member-role caller on the pool and assignment reads', async () => {
      const pools = await call(
        memberSession,
        getPools,
        '/api/v1/organization/seats/pools',
        undefined,
        orgId,
      );
      const assignments = await call(
        memberSession,
        getAssignments,
        '/api/v1/organization/seats/assignments',
        undefined,
        orgId,
      );

      expect(pools.status).toBe(403);
      expect(assignments.status).toBe(403);
    });

    it('lets the holder create a pool, then refuses a Member-role write', async () => {
      const created = await call(
        holderSession,
        postPool,
        '/api/v1/organization/seats/pools',
        jsonInit('POST', { planKey: 'ace', quantity: 2 }),
        orgId,
      );
      expect(created.status).toBe(201);
      poolId = createdPoolId(created.body);

      const refused = await call(
        memberSession,
        postAssignment,
        '/api/v1/organization/seats/assignments',
        jsonInit('POST', { userId: member.id, poolId }),
        orgId,
      );
      expect(refused.status).toBe(403);
    });

    it('refuses a body-less DELETE without the key with 403, not 400', async () => {
      const { status } = await callWithId(
        memberSession,
        deleteAssignment,
        '/api/v1/organization/seats/assignments/00000000-0000-4000-8000-000000000000',
        { method: 'DELETE' },
        orgId,
        '00000000-0000-4000-8000-000000000000',
      );

      expect(status).toBe(403);
    });

    it('lets the holder unassign a seat', async () => {
      const { data, error } = await service
        .from('org_seat_assignments')
        .insert({ organization_id: orgId, pool_id: poolId, user_id: member.id })
        .select('id')
        .single();
      if (error) throw new Error(`[setup] assignment: ${error.message}`);

      const { status } = await callWithId(
        holderSession,
        deleteAssignment,
        `/api/v1/organization/seats/assignments/${data.id}`,
        { method: 'DELETE' },
        orgId,
        data.id,
      );

      expect(status).toBe(200);
    });
  });

  describe('org.invitation.manage', () => {
    let invitationId: string;

    beforeAll(async () => {
      const { data, error } = await service
        .from('invitations')
        .insert({
          email: `invite-${tag}@example.com`,
          target_org_role_id: memberRoleId,
          organization_id: orgId,
          inviter_id: holder.id,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .select('id')
        .single();
      if (error) throw new Error(`[setup] invitation: ${error.message}`);
      invitationId = data.id;
    });

    it('lists the pending invitations for the holder', async () => {
      const { status, body } = await call(
        holderSession,
        getInvites,
        '/api/v1/organization/invites?isAccepted=false',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
      // A non-null envelope is not enough: an empty list satisfies it. The row
      // the setup minted has to be in the answer.
      expect(listData(body)).not.toBeNull();
      expect(JSON.stringify(body)).toContain(invitationId);
    });

    it('lets a Student-persona Admin list invitations (D13: persona is not authority)', async () => {
      const { status } = await call(
        studentAdminSession,
        getInvites,
        '/api/v1/organization/invites?isAccepted=false',
        undefined,
        orgId,
      );

      expect(status).toBe(200);
    });

    it('refuses a Member-role caller on the list, retarget and revoke', async () => {
      const list = await call(
        memberSession,
        getInvites,
        '/api/v1/organization/invites?isAccepted=false',
        undefined,
        orgId,
      );
      const retarget = await callWithId(
        memberSession,
        updateInvite,
        `/api/v1/organization/invites/${invitationId}`,
        jsonInit('PUT', { targetOrgRoleId: teacherRoleId }),
        orgId,
        invitationId,
      );
      const revoke = await callWithId(
        memberSession,
        removeInvite,
        `/api/v1/organization/invites/${invitationId}`,
        { method: 'DELETE' },
        orgId,
        invitationId,
      );

      expect(list.status).toBe(403);
      expect(retarget.status).toBe(403);
      expect(revoke.status).toBe(403);
    });

    it('lets the holder retarget and then revoke', async () => {
      // Retarget keeps the legacy grant-authority conjunct (`can_assign_org_role`)
      // until 2b-4, so the working caller is the Admin role — which also proves
      // D13: a `student` persona holding Admin passes on authority alone.
      const retarget = await callWithId(
        studentAdminSession,
        updateInvite,
        `/api/v1/organization/invites/${invitationId}`,
        jsonInit('PUT', { targetOrgRoleId: teacherRoleId }),
        orgId,
        invitationId,
      );
      expect(retarget.status).toBe(200);

      const revoke = await callWithId(
        holderSession,
        removeInvite,
        `/api/v1/organization/invites/${invitationId}`,
        { method: 'DELETE' },
        orgId,
        invitationId,
      );
      expect(revoke.status).toBe(200);
    });

    it('keeps the ?token= preview public', async () => {
      // No session and no cookie jar: the token is the capability, so the branch
      // must answer without one. `createClient` is not mocked for this call, and
      // the assertion below proves the authenticated wrapper never ran.
      const { status } = await callAnonymous(
        getInvites,
        '/api/v1/organization/invites?token=does-not-exist',
      );

      expect(status).toBe(404);
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
      expect(supabaseModule.createClient).not.toHaveBeenCalled();
    });
  });

  describe('roles keep their 2a-2 gate', () => {
    it('reads the role list and one role for an org member', async () => {
      const list = await call(
        memberSession,
        getRoles,
        '/api/v1/organization/roles',
        undefined,
        orgId,
      );
      const role = await callWithId(
        memberSession,
        getRole,
        `/api/v1/organization/roles/${memberRoleId}`,
        undefined,
        orgId,
        memberRoleId,
      );

      expect(list.status).toBe(200);
      expect(role.status).toBe(200);
    });

    it('refuses a Member-role write on org.role.manage', async () => {
      const { status } = await call(
        memberSession,
        postRole,
        '/api/v1/organization/roles',
        jsonInit('POST', { name: `member-made-${tag}` }),
        orgId,
      );

      expect(status).toBe(403);
    });
  });

  it('refuses a caller whose only membership is another org', async () => {
    // The cookie names THIS org, but the caller is a member of the foreign one
    // only, so `withAuth` resolves no active org — not an observation of this
    // org's roster (a roster read never crosses tenants).
    const { status, body } = await call(
      outsiderSession,
      getMembers,
      '/api/v1/organization/members',
      undefined,
      orgId,
    );

    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('refuses every gated family when there is no active org', async () => {
    const calls = await Promise.all([
      call(holderSession, getMembers, '/api/v1/organization/members', undefined, null),
      call(holderSession, getPools, '/api/v1/organization/seats/pools', undefined, null),
      call(
        holderSession,
        getInvites,
        '/api/v1/organization/invites?isAccepted=false',
        undefined,
        null,
      ),
      callWithId(
        holderSession,
        putOrganization,
        `/api/v1/organization/${orgId}`,
        jsonInit('PUT', { name: 'no-org' }),
        null,
        orgId,
      ),
    ]);

    expect(calls.map((entry) => entry.status)).toEqual([403, 403, 403, 403]);
  });
});
