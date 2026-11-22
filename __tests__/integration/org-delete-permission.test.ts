import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { RequestContext } from '@studiq/authz';
import { organizationController } from '@studiq/server/controllers/organization.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';

/**
 * ADR-0015 §4.1/§7.1, phase 5b row 8: org deletion authorizes on `org.admin` at
 * organization scope in the active org — `scopeCovers(ctx.permissionScopes
 * ['org.admin'], 'organization')` — not on the dead `rls_caller_is_org_manager`
 * marker RPC. `organizations` deliberately has no DELETE policy (verified over
 * the live stack: only SELECT/UPDATE policies exist), so there is no RLS twin by
 * construction; the service is the whole gate (it runs the delete on the
 * service-role client).
 *
 * No `DELETE /api/v1/organization/[id]` route exists yet (phase 7 owns the
 * route), so the controller is driven directly with a real `withAuth`-built
 * context — the same ctx a route handler would receive.
 *
 * Matrix, through the real `withAuth` → controller → service with real
 * signed-in sessions (one fresh org per case, so no ordering coupling):
 *
 * - an `org.admin` holder of the active org deletes it (200, row gone);
 * - a role holding only `org.member.manage` is refused (403, row stays);
 * - a foreign org id (active org differs) is 403 even for an admin;
 * - a missing org id answers 404 after the authority checks.
 */

const PASSWORD = 'OrgDel5b!';

interface Session {
  build: () => SupabaseClient<Database>;
}

async function signIn(user: TestUserFixture): Promise<Session> {
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

  const { error } = await build().auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
  });
  if (error) throw new Error(`[setup] signIn failed for ${user.email}: ${error.message}`);
  return { build };
}

/** Build the real RequestContext a route handler would get for this session. */
async function contextFor(session: Session, cookieOrgId: string): Promise<RequestContext> {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  let seen: RequestContext | undefined;
  const res = await withAuth(
    createNextRequest(
      'http://localhost/api/v1/example',
      { method: 'GET' },
      { active_org_id: cookieOrgId },
    ),
    (ctx) => {
      seen = ctx;
      return Promise.resolve(toNextResponse({ success: true, statusCode: 200, data: null }));
    },
  );
  if (!seen) throw new Error(`[setup] withAuth did not reach the handler (status ${res.status})`);
  return seen;
}

describe('organization delete — org.admin at organization scope (phase 5b row 8)', () => {
  const service = createTypedServiceClient();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const cleanups: string[] = [];
  let admin: Session;
  let adminUser: TestUserFixture;
  let memberManager: Session;
  let memberManagerUser: TestUserFixture;
  /** An org both users are NOT members of, used as the always-active org. */
  let activeOrgId: string;

  async function customRole(organizationId: string, name: string, keys: string[]): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`role ${name}: ${error.message}`);

    const { error: permissionError } = await service
      .from('org_role_permissions')
      .insert(
        keys.map((key) => ({ org_role_id: role.id, permission_key: key, scope: 'organization' })),
      );
    if (permissionError) throw new Error(`permissions ${name}: ${permissionError.message}`);
    return role.id;
  }

  async function freshOrg(label: string) {
    const org = await seedOrganization(`${label}-${tag}`);
    cleanups.push(org.org.id);
    return org;
  }

  beforeAll(async () => {
    const activeOrg = await freshOrg('org-delete-active');
    activeOrgId = activeOrg.org.id;

    adminUser = await createTestUser({ role: 'manager', password: PASSWORD });
    memberManagerUser = await createTestUser({ role: 'manager', password: PASSWORD });
    // The admin is an org.admin holder of the always-active org, so `withAuth`
    // sets `ctx.activeOrgId` to it on every request below.
    await seedOrgMembership({
      organizationId: activeOrgId,
      userId: adminUser.id,
      orgRoleId: activeOrg.adminRoleId,
    });
    admin = await signIn(adminUser);
    memberManager = await signIn(memberManagerUser);
  });

  afterAll(async () => {
    for (const id of cleanups) await cleanupOrganizationDeep(id).catch(() => {});
    for (const user of [adminUser, memberManagerUser]) {
      await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  async function orgExists(id: string): Promise<boolean> {
    const { data } = await service.from('organizations').select('id').eq('id', id).maybeSingle();
    return data !== null;
  }

  it('lets an org.admin holder delete the active org', async () => {
    const org = await freshOrg('org-delete-admin');
    await seedOrgMembership({
      organizationId: org.org.id,
      userId: adminUser.id,
      orgRoleId: org.adminRoleId,
    });
    const ctx = await contextFor(admin, org.org.id);

    const result = await organizationController.delete(ctx, org.org.id);

    expect(result).toMatchObject({ success: true, statusCode: 200 });
    expect(await orgExists(org.org.id)).toBe(false);
  });

  it('refuses a role holding only org.member.manage (403, org stays)', async () => {
    const org = await freshOrg('org-delete-mm');
    const roleId = await customRole(org.org.id, `member-manage-${tag}`, ['org.member.manage']);
    await seedOrgMembership({
      organizationId: org.org.id,
      userId: memberManagerUser.id,
      orgRoleId: roleId,
    });
    const ctx = await contextFor(memberManager, org.org.id);

    const result = await organizationController.delete(ctx, org.org.id);

    expect(result).toMatchObject({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    expect(await orgExists(org.org.id)).toBe(true);
  });

  it('refuses a foreign org id even for an org.admin holder (active org differs)', async () => {
    const target = await freshOrg('org-delete-foreign');
    // The admin holds org.admin in the ACTIVE org only: deleting `target` is
    // refused by the active-org check alone.
    const ctx = await contextFor(admin, activeOrgId);

    const result = await organizationController.delete(ctx, target.org.id);

    expect(result).toMatchObject({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    expect(await orgExists(target.org.id)).toBe(true);
  });

  it('answers NOT_FOUND for a missing org after the authority checks (race guard)', async () => {
    const ctx = await contextFor(admin, activeOrgId);
    const missingId = '00000000-0000-4000-8000-000000000000';
    // The service refuses `ctx.activeOrgId !== id` before the existence check,
    // so a real ctx can never reach NOT_FOUND for a missing id. In production
    // the branch is a race guard: the org existed when `withAuth` built the
    // ctx and vanished before the delete. Rebuild the synthetic ctx the
    // controller would receive in that race — active org is the missing id and
    // `org.admin` is held at organization scope.
    const racedCtx: RequestContext = {
      ...ctx,
      activeOrgId: missingId,
      permissionScopes: { ...ctx.permissionScopes, 'org.admin': 'organization' },
    };

    const result = await organizationController.delete(racedCtx, missingId);

    expect(result).toMatchObject({ success: false, statusCode: 404, error: 'NOT_FOUND' });
  });
});
