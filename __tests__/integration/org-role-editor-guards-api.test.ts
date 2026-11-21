import { AccountType, ROLE_TEMPLATES, type RequestContext } from '@studiq/authz';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import * as supabaseModule from '@studiq/server/lib/supabase/server';
import { dbRows } from '@studiq/server/lib/supabase/rows';
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
import { POST as postRole } from '@/app/(backend)/api/v1/organization/roles/route';
import { DELETE as deleteRoleRoute } from '@/app/(backend)/api/v1/organization/roles/[id]/route';

/**
 * The API half of the role-editor guards (ADR-0015 §4.4, §9; R4). The RLS twin
 * is `org-role-editor-guards-rls.test.ts`, which drives PostgREST directly;
 * this suite drives the real route handlers through the real `withAuth`,
 * controller and service with real signed-in sessions, so the context
 * (`permissionScopes`) is the one `withAuth` builds.
 *
 * 2b-8 put the guards on the tables. These cases pin the answers a legitimate
 * caller gets from the service *before* the data plane has to refuse: a preset
 * beyond the caller's own authority is a 403 with no role row written (not a
 * 42501 after an insert-and-rollback), and deleting the last `org.role.manage`
 * holder is a 409 CONFLICT, not the trigger's 42501 → 403. The service-level
 * describe at the bottom drives `OrgRoleService.deleteRole` with the caller's
 * own authenticated client, so the DB trigger is live there: without the
 * service check that delete answers FORBIDDEN (42501), with it CONFLICT.
 */

const PASSWORD = 'RoleEditorApi!';
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  orgId: string,
): Request {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  return createNextRequest(`http://localhost${url}`, init, { active_org_id: orgId });
}

/** One request through a route handler with no `[param]` segment. */
async function call(
  session: Session,
  handler: (req: Request) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
  orgId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await handler(sessionRequest(session, url, init, orgId));
  return { status: response.status, body: await response.json() };
}

/** One request through a route handler whose path carries `[id]`. */
async function callWithId(
  session: Session,
  handler: (req: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
  orgId: string,
  id: string,
): Promise<{ status: number; body: unknown }> {
  const response = await handler(sessionRequest(session, url, init, orgId), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: await response.json() };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** The `data.id` a created-role response carries, or a failure naming the envelope. */
function createdRoleId(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const { data } = body;
    if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') {
      return data.id;
    }
  }
  throw new Error(`expected a created role: ${JSON.stringify(body)}`);
}

describe('role-editor guards at the API (2b-8 follow-up)', () => {
  const service = createTypedServiceClient();

  /** Org for the POST cases: a gate-only caller and a system-admin caller. */
  let apiOrgId: string;
  let apiAdminRoleId: string;
  let gateRoleId: string;
  let gateUser: TestUserFixture;
  let adminUser: TestUserFixture;
  let gateSession: Session;
  let adminSession: Session;

  /** Org for the route-level DELETE with a second holder. */
  let secondOrgId: string;
  let callerGateRoleId: string;
  let victimRoleId: string;
  let secondUser: TestUserFixture;
  let secondSession: Session;

  /** Org for the route-level DELETE of the last gate holder (the caller's own role). */
  let lastOrgId: string;
  let ownGateRoleId: string;
  let lastUser: TestUserFixture;
  let lastSession: Session;

  /** Org for the service-level DELETE with the trigger live. */
  let svcOrgId: string;
  let plainRoleId: string;
  let soleVictimRoleId: string;
  let svcUser: TestUserFixture;
  let svcSession: Session;

  async function customRole(
    organizationId: string,
    name: string,
    rows: Record<string, 'organization'>,
  ): Promise<string> {
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
    for (const [permission_key, scope] of Object.entries(rows)) {
      const { error: permissionError } = await service
        .from('org_role_permissions')
        .insert({ org_role_id: role.id, permission_key, scope });
      if (permissionError)
        throw new Error(`[setup] permission ${permission_key}: ${permissionError.message}`);
    }
    return role.id;
  }

  /** Drop the seeded admin role's gate row so a custom role can be the only holder. */
  async function dropAdminGateRow(organizationId: string, adminRoleId: string): Promise<void> {
    const { error } = await service
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', adminRoleId)
      .eq('permission_key', 'org.role.manage');
    if (error) throw new Error(`[setup] admin gate row removal: ${error.message}`);
  }

  async function roleExists(id: string): Promise<boolean> {
    const { data } = await service.from('org_roles').select('id').eq('id', id);
    return dbRows(data).length === 1;
  }

  async function rolesNamed(name: string, organizationId: string): Promise<number> {
    const { count } = await service
      .from('org_roles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('name', name);
    return count ?? 0;
  }

  async function permissionsOf(roleId: string): Promise<Record<string, string>> {
    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .eq('org_role_id', roleId);
    if (error) throw new Error(`[read] permissions of ${roleId}: ${error.message}`);
    return Object.fromEntries(dbRows(data).map((row) => [row.permission_key, row.scope]));
  }

  beforeAll(async () => {
    // Org for the POST cases.
    const apiOrg = await seedOrganization(`guards-api-${tag}`);
    apiOrgId = apiOrg.org.id;
    apiAdminRoleId = apiOrg.adminRoleId;
    gateRoleId = await customRole(apiOrgId, `gate-${tag}`, { 'org.role.manage': 'organization' });
    gateUser = await createTestUser({ role: 'manager', password: PASSWORD });
    adminUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: apiOrgId,
      userId: gateUser.id,
      orgRoleId: gateRoleId,
    });
    await seedOrgMembership({
      organizationId: apiOrgId,
      userId: adminUser.id,
      orgRoleId: apiAdminRoleId,
    });
    gateSession = await signIn(gateUser.email);
    adminSession = await signIn(adminUser.email);

    // Org where the caller's role and a no-member role both hold the gate.
    const secondOrg = await seedOrganization(`guards-api-second-${tag}`);
    secondOrgId = secondOrg.org.id;
    await dropAdminGateRow(secondOrgId, secondOrg.adminRoleId);
    callerGateRoleId = await customRole(secondOrgId, `caller-gate-${tag}`, {
      'org.role.manage': 'organization',
    });
    victimRoleId = await customRole(secondOrgId, `victim-gate-${tag}`, {
      'org.role.manage': 'organization',
    });
    secondUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: secondOrgId,
      userId: secondUser.id,
      orgRoleId: callerGateRoleId,
    });
    secondSession = await signIn(secondUser.email);

    // Org where the caller's own role is the only gate holder.
    const lastOrg = await seedOrganization(`guards-api-last-${tag}`);
    lastOrgId = lastOrg.org.id;
    await dropAdminGateRow(lastOrgId, lastOrg.adminRoleId);
    ownGateRoleId = await customRole(lastOrgId, `own-gate-${tag}`, {
      'org.role.manage': 'organization',
    });
    lastUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: lastOrgId,
      userId: lastUser.id,
      orgRoleId: ownGateRoleId,
    });
    lastSession = await signIn(lastUser.email);

    // Org for the service-level delete: a no-member role is the sole holder.
    const svcOrg = await seedOrganization(`guards-api-svc-${tag}`);
    svcOrgId = svcOrg.org.id;
    await dropAdminGateRow(svcOrgId, svcOrg.adminRoleId);
    plainRoleId = await customRole(svcOrgId, `plain-${tag}`, {});
    soleVictimRoleId = await customRole(svcOrgId, `sole-victim-${tag}`, {
      'org.role.manage': 'organization',
    });
    svcUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: svcOrgId,
      userId: svcUser.id,
      orgRoleId: plainRoleId,
    });
    svcSession = await signIn(svcUser.email);
  });

  afterAll(async () => {
    for (const id of [apiOrgId, secondOrgId, lastOrgId, svcOrgId]) {
      if (id) await cleanupOrganizationDeep(id).catch(() => {});
    }
  });

  describe('POST /api/v1/organization/roles with a template', () => {
    it('answers 403 and writes no role row when the preset exceeds the caller own authority', async () => {
      // The caller holds org.role.manage (so the controller gate passes) but
      // not org.admin and not the Assistant matrix — the service must refuse
      // before the insert, not let the 2b-8 policy refuse the permission rows.
      const name = `assistant-${tag}`;
      const { status, body } = await call(
        gateSession,
        postRole,
        '/api/v1/organization/roles',
        jsonInit('POST', { name, template: 'assistant' }),
        apiOrgId,
      );

      expect(status).toBe(403);
      expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });
      expect(await rolesNamed(name, apiOrgId)).toBe(0);
    });

    it('still creates the blank preset for a caller with no permissions at all', async () => {
      const name = `blank-${tag}`;
      const { status, body } = await call(
        gateSession,
        postRole,
        '/api/v1/organization/roles',
        jsonInit('POST', { name, template: 'blank' }),
        apiOrgId,
      );

      expect(status).toBe(201);
      expect(body).toMatchObject({ success: true });
      expect(await rolesNamed(name, apiOrgId)).toBe(1);
    });

    it('lets an org.admin holder materialise the assistant preset (D21)', async () => {
      const name = `admin-assistant-${tag}`;
      const { status, body } = await call(
        adminSession,
        postRole,
        '/api/v1/organization/roles',
        jsonInit('POST', { name, template: 'assistant' }),
        apiOrgId,
      );

      expect(status).toBe(201);
      const roleId = createdRoleId(body);
      expect(await permissionsOf(roleId)).toEqual(ROLE_TEMPLATES.assistant.permissions);
    });
  });

  describe('DELETE /api/v1/organization/roles/[id]', () => {
    it('answers 200 and removes the role when another org.role.manage holder remains', async () => {
      const { status, body } = await callWithId(
        secondSession,
        deleteRoleRoute,
        `/api/v1/organization/roles/${victimRoleId}`,
        { method: 'DELETE' },
        secondOrgId,
        victimRoleId,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ success: true });
      expect(await roleExists(victimRoleId)).toBe(false);
    });

    it('answers 409 and keeps the row when deleting the last gate holder', async () => {
      // The caller's own role is the org's only org.role.manage holder.
      const { status, body } = await callWithId(
        lastSession,
        deleteRoleRoute,
        `/api/v1/organization/roles/${ownGateRoleId}`,
        { method: 'DELETE' },
        lastOrgId,
        ownGateRoleId,
      );

      expect(status).toBe(409);
      expect(body).toMatchObject({ success: false, error: 'CONFLICT' });
      expect(await roleExists(ownGateRoleId)).toBe(true);
    });
  });

  // A direct service call with the caller's own session client: RLS and the
  // 2b-8 last-holder trigger both apply, so without the service check the
  // delete of the sole holder reaches the trigger and answers FORBIDDEN
  // (42501 → 403). With it, the service answers CONFLICT before any write.
  const svcCtx = (): RequestContext => ({
    traceId: `guards-api-svc-${tag}`,
    userId: svcUser.id,
    accountType: AccountType.MANAGER,
    orgRoleId: plainRoleId,
    activeOrgId: svcOrgId,
    url: `/api/v1/organization/roles/${soleVictimRoleId}`,
    method: 'DELETE',
    groupIds: [],
    groupRoles: {},
    permissionScopes: { 'org.role.manage': 'organization' },
  });

  describe('OrgRoleService.deleteRole with the caller authenticated (trigger live)', () => {
    it('returns CONFLICT and keeps the sole gate-holder role', async () => {
      const orgRoleService = new OrgRoleService(() => Promise.resolve(svcSession.build()));

      const result = await orgRoleService.deleteRole(svcCtx(), soleVictimRoleId);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error).toBe('CONFLICT');
      expect(await roleExists(soleVictimRoleId)).toBe(true);
    });

    it('deletes the role once a second holder exists', async () => {
      const { error } = await service.from('org_role_permissions').insert({
        org_role_id: plainRoleId,
        permission_key: 'org.role.manage',
        scope: 'organization',
      });
      if (error) throw new Error(`[setup] second holder: ${error.message}`);

      const orgRoleService = new OrgRoleService(() => Promise.resolve(svcSession.build()));
      const result = await orgRoleService.deleteRole(svcCtx(), soleVictimRoleId);

      expect(result.success).toBe(true);
      expect(await roleExists(soleVictimRoleId)).toBe(false);
    });
  });
});
