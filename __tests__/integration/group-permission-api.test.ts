import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { RequestContext } from '@studiq/authz';
import { groupController } from '@studiq/server/controllers/group.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeedDb } from '#test/helpers/tenant-seed';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

/**
 * ADR-0015 §4.3/§7: the group route asks `group.*` for ONE group.
 *
 * The RLS twin lives in `group-permission-rls.test.ts`; this file is the API
 * half, run through the real `withAuth` + controller + service with real
 * signed-in sessions, so the context (permission scopes and `groupRoles`) is
 * the one `withAuth` actually builds. The only stub is the cookie store Next.js
 * provides from `next/headers`.
 */

const PASSWORD = 'GroupPermApi!';
const ACTIVE_ORG_COOKIE = 'active_org_id';

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

/** Runs one request through the real `withAuth`, returning status and parsed body. */
async function call(
  session: Session,
  orgId: string | null,
  handler: Parameters<typeof withAuth>[1],
): Promise<{ status: number; body: unknown }> {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  const res = await withAuth(
    createNextRequest(
      'http://localhost/api/v1/organization/groups',
      { method: 'GET' },
      orgId ? { [ACTIVE_ORG_COOKIE]: orgId } : undefined,
    ),
    handler,
  );
  const body: unknown = await res.json();
  return { status: res.status, body };
}

// The route layer parses each body before it calls `withAuth`, so the cases drive
// the controller with the parsed value the route hands over — the same bodies the
// four route files read, not the request itself.
const updateGroup = (id: string, name: string) => async (ctx: RequestContext) =>
  toNextResponse(await groupController.updateGroup(ctx, id, { name }));

const listGroups = async (ctx: RequestContext) =>
  toNextResponse(await groupController.listGroups(ctx));

const getGroupMembers = (id: string) => async (ctx: RequestContext) =>
  toNextResponse(await groupController.getGroupMembers(ctx, id));

const setGroupMembers = (id: string) => async (ctx: RequestContext) =>
  toNextResponse(await groupController.setGroupMembers(ctx, id, { members: [] }));

const createGroup = (name: string) => async (ctx: RequestContext) =>
  toNextResponse(await groupController.createGroup(ctx, { name }));

function isCreatedRow(value: unknown): value is { id: string; name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isListRow(value: unknown): value is { id: string; manageVia: string | null } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'manageVia' in value &&
    (value.manageVia === 'group.manage' ||
      value.manageVia === 'group.member.manage' ||
      value.manageVia === null)
  );
}

/** The `manageVia` answer the list route renders for one group. */
function manageVia(body: unknown, groupId: string): string | null | undefined {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined;
  const { data } = body;
  if (!Array.isArray(data)) return undefined;
  for (const row of data) {
    if (isListRow(row) && row.id === groupId) return row.manageVia;
  }
  return undefined;
}

describe('group routes authorize on group permissions', () => {
  const service = createSeedDb();
  const tag = `${Date.now()}`;

  let orgId: string;
  let foreignOrgId: string;
  let groupScopedRoleId: string;
  /** `group.read` at `own` and nothing else: the role a custom preset can be. */
  let ownReadRoleId: string;
  let ownReadSession: Session;
  let rosterOnlySession: Session;
  /** `group.member.manage` at `group` and nothing else: no way to list a class. */
  let rosterOnlySessionNoRead: Session;
  let rosterOnlyTeacherNoRead: TestUserFixture;
  let groupAId: string;
  let groupBId: string;
  /** The org's own plan resolved `max_groups` for the fixture org. */
  let groupsAtLimit = false;

  let teacher: TestUserFixture;
  let ownRead: TestUserFixture;
  let rosterOnlyTeacher: TestUserFixture;
  let member: TestUserFixture;
  let admin: TestUserFixture;
  let outsider: TestUserFixture;
  let teacherSession: Session;
  let memberSession: Session;
  let adminSession: Session;
  let outsiderSession: Session;

  async function groupRole(organizationId: string, name: string): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({
        organization_id: organizationId,
        name,
        display_name: name,
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`[setup] role ${name}: ${error.message}`);

    const { error: permissionError } = await service.from('org_role_permissions').insert(
      ['group.read', 'group.manage', 'group.member.manage'].map((key) => ({
        org_role_id: role.id,
        permission_key: key,
        scope: 'group',
      })),
    );
    if (permissionError) throw new Error(`[setup] permissions ${name}: ${permissionError.message}`);
    return role.id;
  }

  async function roleWith(
    organizationId: string,
    name: string,
    permissions: { key: string; scope: 'own' | 'group' | 'organization' }[],
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`[setup] role ${name}: ${error.message}`);

    const { error: permissionError } = await service.from('org_role_permissions').insert(
      permissions.map(({ key, scope }) => ({
        org_role_id: role.id,
        permission_key: key,
        scope,
      })),
    );
    if (permissionError) throw new Error(`[setup] permissions ${name}: ${permissionError.message}`);
    return role.id;
  }

  async function createGroupRow(
    organizationId: string,
    name: string,
    createdBy?: string,
  ): Promise<string> {
    const { data, error } = await service
      .from('groups')
      .insert({
        organization_id: organizationId,
        name: `${name}-${tag}`,
        ...(createdBy ? { created_by: createdBy } : {}),
      })
      .select('id')
      .single();
    if (error) throw new Error(`[setup] group ${name}: ${error.message}`);
    return data.id;
  }

  beforeAll(async () => {
    const org = await seedOrganization(`group-perm-api-${tag}`);
    orgId = org.org.id;
    const foreignOrg = await seedOrganization(`group-perm-api-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    groupScopedRoleId = await groupRole(orgId, `group-scope-api-${tag}`);
    ownReadRoleId = await roleWith(orgId, `own-read-api-${tag}`, [
      { key: 'group.read', scope: 'own' },
    ]);
    const rosterOnlyRoleId = await roleWith(orgId, `roster-only-api-${tag}`, [
      { key: 'group.read', scope: 'group' },
      { key: 'group.member.manage', scope: 'group' },
    ]);
    groupAId = await createGroupRow(orgId, 'A');
    groupBId = await createGroupRow(orgId, 'B');

    // `POST /organization/groups` checks the org's `max_groups` limit AFTER the
    // permission gate, so a refusal on the permission path can only be observed
    // while the org is under it: the fresh org carries its default class plus
    // these two, which fills a `launch` org's three. Raise the ceiling for the
    // fixture only, exactly as an admin would on a bigger plan.
    const { count } = await service
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    const { data: planRow } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    const { data: limitRow } = await service
      .from('plan_limits')
      .select('limit_value')
      .eq('plan_key', planRow?.plan ?? '')
      .eq('limit_key', 'max_groups')
      .maybeSingle();
    const limit = limitRow?.limit_value ?? 0;
    if (limit !== -1 && (count ?? 0) >= limit) {
      const { error: raiseError } = await service
        .from('organizations')
        .update({ plan: 'creator' })
        .eq('id', orgId);
      if (raiseError) throw new Error(`[setup] plan: ${raiseError.message}`);
    }

    const { count: afterCount } = await service
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    groupsAtLimit = (afterCount ?? 0) >= 20;

    teacher = await createTestUser({ role: 'educator', password: PASSWORD });
    member = await createTestUser({ role: 'student', password: PASSWORD });
    admin = await createTestUser({ role: 'manager', password: PASSWORD });
    outsider = await createTestUser({ role: 'educator', password: PASSWORD });

    await seedOrgMembership({
      organizationId: orgId,
      userId: teacher.id,
      orgRoleId: groupScopedRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: member.id,
      orgRoleId: groupScopedRoleId,
    });
    // The seeded Admin system role: every group key at organization scope.
    await seedOrgMembership({
      organizationId: orgId,
      userId: admin.id,
      orgRoleId: org.adminRoleId,
    });
    await seedOrgMembership({
      organizationId: foreignOrgId,
      userId: outsider.id,
      orgRoleId: foreignOrg.memberRoleId,
    });

    await seedGroupMembership({ groupId: groupAId, userId: teacher.id, role: 'teacher' });
    await seedGroupMembership({ groupId: groupAId, userId: member.id, role: 'member' });

    ownRead = await createTestUser({ role: 'educator', password: PASSWORD });
    rosterOnlyTeacher = await createTestUser({ role: 'educator', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: ownRead.id,
      orgRoleId: ownReadRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: rosterOnlyTeacher.id,
      orgRoleId: rosterOnlyRoleId,
    });
    await seedGroupMembership({ groupId: groupBId, userId: rosterOnlyTeacher.id, role: 'teacher' });

    const rosterNoReadRoleId = await roleWith(orgId, `roster-only-noread-api-${tag}`, [
      { key: 'group.member.manage', scope: 'group' },
    ]);
    rosterOnlyTeacherNoRead = await createTestUser({ role: 'educator', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: rosterOnlyTeacherNoRead.id,
      orgRoleId: rosterNoReadRoleId,
    });
    await seedGroupMembership({
      groupId: groupBId,
      userId: rosterOnlyTeacherNoRead.id,
      role: 'teacher',
    });

    rosterOnlySessionNoRead = await signIn(rosterOnlyTeacherNoRead.email);
    ownReadSession = await signIn(ownRead.email);
    rosterOnlySession = await signIn(rosterOnlyTeacher.email);
    teacherSession = await signIn(teacher.email);
    memberSession = await signIn(member.email);
    adminSession = await signIn(admin.email);
    outsiderSession = await signIn(outsider.email);
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId).catch(() => {});
    if (foreignOrgId) await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
  });

  it('lets a teacher of the group rename it', async () => {
    const { status } = await call(teacherSession, orgId, updateGroup(groupAId, 'taught-edit'));

    expect(status).toBe(200);
  });

  it('refuses the same teacher on another group of the org', async () => {
    const { status, body } = await call(teacherSession, orgId, updateGroup(groupBId, 'stolen'));

    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });
  });

  it('refuses a member of the group', async () => {
    const { status } = await call(memberSession, orgId, updateGroup(groupAId, 'member-edit'));

    expect(status).toBe(403);
  });

  it('lets an Admin-role holder write any group in the org', async () => {
    const { status } = await call(adminSession, orgId, updateGroup(groupBId, 'admin-edit'));

    expect(status).toBe(200);
  });

  it('refuses a caller from another org', async () => {
    const { status } = await call(outsiderSession, orgId, updateGroup(groupAId, 'cross-org'));

    expect(status, 'no org_members row in the group org, no authority').toBe(403);
  });

  it('lists the org groups with manageVia following the same rule', async () => {
    const { status, body } = await call(teacherSession, orgId, listGroups);

    expect(status).toBe(200);
    expect(manageVia(body, groupAId), 'the group it teaches').toBe('group.manage');
    expect(manageVia(body, groupBId), 'a group it does not teach').toBeNull();
  });

  it('lets a group-scope Teacher create a class, and lists it as theirs', async () => {
    // The 2b-2 decision (§4.3 scopes, §10 classes): a Teacher starts their own
    // class. A 429 here would be the plan limit, which runs after the permission
    // gate and would mask a missing gate, so the fixture org must be under it.
    expect(groupsAtLimit, 'the fixture org is under max_groups').toBe(false);

    const name = `teacher-made-${tag}`;
    const { status, body } = await call(teacherSession, orgId, createGroup(name));

    expect(status).toBe(201);
    if (
      typeof body !== 'object' ||
      body === null ||
      !('data' in body) ||
      !isCreatedRow(body.data)
    ) {
      throw new Error(`${name} returned no created row: ${JSON.stringify(body)}`);
    }
    const created = body.data;
    expect(created.name, 'the create returns its own row').toBe(name);

    const { data: stored } = await service
      .from('groups')
      .select('id, created_by')
      .eq('organization_id', orgId)
      .eq('name', name)
      .maybeSingle();
    expect(stored?.created_by, 'the caller is the class’s creator').toBe(teacher.id);

    // The creator is enrolled as the class's teacher by the create itself (§10),
    // so the class it just made is one it can manage: `manageVia` is the key its
    // rows carry, and the delete it needs to clean up is admitted.
    const { data: roster } = await service
      .from('group_members')
      .select('role')
      .eq('group_id', created.id)
      .eq('user_id', teacher.id);
    expect(roster, 'the creator is on the class’s roster as its teacher').toEqual([
      { role: 'teacher' },
    ]);

    const { body: listBody } = await call(teacherSession, orgId, listGroups);
    expect(manageVia(listBody, created.id), 'the creator manages its class').toBe('group.manage');

    const { status: deleteStatus } = await call(teacherSession, orgId, (ctx) =>
      toNextResponse(groupController.deleteGroup(ctx, created.id)),
    );
    expect(deleteStatus, 'the creator can delete the class it made').toBe(200);
  });

  it('refuses group creation to a role holding only the roster key', async () => {
    // `group.member.manage` (and `group.read`) without `group.manage`: a new class
    // has no roster to manage, and the create gate asks for `group.manage`.
    const name = `roster-made-${tag}`;
    const { status, body } = await call(rosterOnlySession, orgId, createGroup(name));

    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });

    const { data: stored } = await service
      .from('groups')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', name);
    expect(stored, 'the refused row does not exist').toEqual([]);
  });

  it('does not refuse an Admin-role holder whose role carries group.manage at the org', async () => {
    // The seeded plan allows a handful of classes, so a fresh fixture org can
    // already be at its `max_groups` limit — a 429 would prove nothing about the
    // permission. A refusal must be the permission's 403, never the limit's 429.
    const { status } = await call(adminSession, orgId, createGroup(`admin-made-${tag}`));

    expect(status, 'an Admin-role holder is never refused by the permission gate').not.toBe(403);
  });

  it('gives a group.read-at-own role only the classes it created, not a 403', async () => {
    const created = await createGroupRow(orgId, 'own-read', ownRead.id);

    const { status, body } = await call(ownReadSession, orgId, listGroups);

    expect(status).toBe(200);
    // Listing it is `own`; editing it would need `group.manage`, which the role
    // does not hold, so the row must not offer the edit pair.
    expect(manageVia(body, created), 'own is created_by (§4.3)').toBeNull();
    expect(manageVia(body, groupAId), 'a class it did not create').toBeUndefined();
  });

  it('offers the members action, and only that, to a roster-only manager', async () => {
    const { status, body } = await call(rosterOnlySession, orgId, listGroups);

    expect(status).toBe(200);
    // `PUT /groups/:id` checks `group.manage`, so offering it would be a 403.
    expect(manageVia(body, groupBId), 'teaches it, holds group.member.manage only').toBe(
      'group.member.manage',
    );
    expect(manageVia(body, groupAId), 'does not teach it').toBeNull();
  });

  it('answers 403 rather than 404 for a caller with no org membership', async () => {
    const { status } = await call(outsiderSession, null, listGroups);

    expect(status).toBe(403);
  });

  it('lets a roster-only manager read and replace the roster of a class it teaches', async () => {
    const read = await call(rosterOnlySession, orgId, getGroupMembers(groupBId));
    expect(read.status, 'the members dialog opens with this call').toBe(200);

    const write = await call(rosterOnlySession, orgId, setGroupMembers(groupBId));
    expect(write.status, 'and saves with this one').toBe(200);

    const elsewhere = await call(rosterOnlySession, orgId, setGroupMembers(groupAId));
    expect(elsewhere.status, 'a class it does not teach is still out of reach').toBe(403);
  });

  it('refuses the roster to a group.member.manage holder with no group.read', async () => {
    // The two keys are separate: `group.member.manage` alone opens the roster
    // endpoints, and the list — which is what puts a row on screen — is
    // `group.read`. So the UI gate has to be the roster key, not the list's.
    const roster = await call(rosterOnlySessionNoRead, orgId, getGroupMembers(groupBId));
    expect(roster.status).toBe(200);

    const list = await call(rosterOnlySessionNoRead, orgId, listGroups);
    expect(list.status).toBe(403);
  });
});
