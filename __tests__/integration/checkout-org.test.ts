import * as supabaseModule from '@studiq/server/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, seedViaApi, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as getMyOrgs } from '@/app/(backend)/api/v1/me/orgs/route';
import { POST as createCheckoutSession } from '@/app/(backend)/api/v1/stripe/create-checkout-session/route';

/**
 * #225 (BIL-04) — the checkout page resolves the target organization from the
 * self-scoped `/me/orgs` and then sends that id to the mock webhook. This suite
 * pins the server contract the page relies on: membership visibility is
 * self-scoped and buying an org plan requires the org admin role.
 *
 * Requests run through the real `withAuth()` → controller → service stack with
 * real signed-in sessions, because `mockUser()` switches to a service-role
 * client that bypasses RLS and would hide a `/me/orgs` leak.
 */
const PASSWORD = 'ChkOrg225!';
const BASE_URL = 'http://localhost';

interface Session {
  user: TestUserFixture;
  build: () => SupabaseClient;
}

async function signIn(email: string, user: TestUserFixture): Promise<Session> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient(
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

  return { user, build };
}

function actAs(session: Session) {
  vi.mocked(supabaseModule.createClient).mockImplementation(async () => session.build());
}

function checkoutRequest(body: unknown, cookies?: Record<string, string>) {
  return createNextRequest(
    `${BASE_URL}/api/v1/stripe/create-checkout-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    cookies,
  );
}

describe('org checkout resolves the target organization (#225)', () => {
  const service = createServiceClient();
  const tag = `${Date.now()}`;

  let orgId: string;
  let admin: Session;
  let teacher: Session;
  let outsiderManager: Session;
  let testUsers: TestUserFixture[] = [];

  beforeAll(async () => {
    const adminUser = await createTestUser({ role: 'manager', password: PASSWORD });
    const seeded = await seedViaApi(adminUser, { org: `checkout-org-225-${tag}` });
    orgId = seeded.orgId!;

    const { data: teacherRole, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'teacher')
      .single();
    if (roleError || !teacherRole) throw new Error('[setup] teacher org role missing');

    // Same account type as the buyer (manager) but a non-admin org role: this is
    // the only way to prove the org-admin gate, because a teacher-account-type
    // user is already rejected by the plan's `for_account_type`.
    const teacherUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherUser.id,
      orgRoleId: teacherRole.id,
    });

    const outsiderUser = await createTestUser({ role: 'manager', password: PASSWORD });

    admin = await signIn(adminUser.email, adminUser);
    teacher = await signIn(teacherUser.email, teacherUser);
    outsiderManager = await signIn(outsiderUser.email, outsiderUser);
    testUsers = [adminUser, teacherUser, outsiderUser];
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
    for (const user of testUsers) {
      if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('lists the org as admin for its creator', async () => {
    actAs(admin);
    const res = await getMyOrgs(
      createNextRequest(`${BASE_URL}/api/v1/me/orgs`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([expect.objectContaining({ id: orgId, orgRoleName: 'admin' })]);
  });

  it('omits the org from a manager who is not a member', async () => {
    actAs(outsiderManager);
    const res = await getMyOrgs(
      createNextRequest(`${BASE_URL}/api/v1/me/orgs`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('creates a checkout session whose URL carries the resolved org', async () => {
    actAs(admin);
    const res = await createCheckoutSession(checkoutRequest({ planId: 'hub', orgId }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.url).toContain(`org_id=${orgId}`);
    expect(body.data.url).toContain('plan_id=hub');
  });

  it('rejects a manager who is not an org admin', async () => {
    actAs(teacher);
    const res = await createCheckoutSession(checkoutRequest({ planId: 'hub', orgId }));

    expect(res.status).toBe(403);
  });

  it('rejects an org plan purchase without an org id', async () => {
    actAs(admin);
    const res = await createCheckoutSession(checkoutRequest({ planId: 'hub' }));

    expect(res.status).toBe(400);
  });
});
