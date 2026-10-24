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
import { POST as logoutPost } from '@/app/(backend)/api/v1/auth/logout/route';
import { GET as getMyOrgs } from '@/app/(backend)/api/v1/me/orgs/route';
import { GET as getMyPlan } from '@/app/(backend)/api/v1/me/plan/route';

/**
 * #186 (SEC-03) — `active_org_id` is a client-controlled cookie. `withAuth()` may
 * only turn it into the tenant scope when the caller actually holds an
 * `org_members` row for that org, and logout must drop it.
 *
 * Every request runs through the real `withAuth()` → controller → service stack
 * with a real signed-in session (see `question-reports-api.test.ts`): the only
 * stub is the cookie store Next.js would provide from `next/headers`.
 */
const PASSWORD = 'ActOrg186!';
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

describe('active_org_id membership gate (#186)', () => {
  const service = createServiceClient();
  const tag = `${Date.now()}`;

  let orgId: string;
  let member: Session;
  let outsider: Session;

  beforeAll(async () => {
    const managerUser = await createTestUser({ role: 'manager', password: PASSWORD });
    const seeded = await seedViaApi(managerUser, { org: `active-org-186-${tag}` });
    orgId = seeded.orgId!;

    const { data: org, error: orgError } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    if (orgError || org?.plan !== 'launch') {
      throw new Error(`[setup] expected a launch-plan org, got ${org?.plan}: ${orgError?.message}`);
    }

    const { data: memberRole, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (roleError || !memberRole) throw new Error('[setup] member org role missing');

    const memberUser = await createTestUser({ role: 'student', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: memberUser.id,
      orgRoleId: memberRole.id,
    });

    const outsiderUser = await createTestUser({ role: 'student', password: PASSWORD });

    member = await signIn(memberUser.email, memberUser);
    outsider = await signIn(outsiderUser.email, outsiderUser);
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('serves the org plan to a legitimate member', async () => {
    actAs(member);
    const res = await getMyPlan(
      createNextRequest(`${BASE_URL}/api/v1/me/plan`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.key).toBe('launch');
  });

  it('ignores a forged active_org_id cookie and falls back to the personal plan', async () => {
    actAs(outsider);
    const res = await getMyPlan(
      createNextRequest(`${BASE_URL}/api/v1/me/plan`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.key).toBe('base');
  });

  it('does not report the forged org as active in /me/orgs', async () => {
    actAs(outsider);
    const res = await getMyOrgs(
      createNextRequest(`${BASE_URL}/api/v1/me/orgs`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('reports the org as active for a real member', async () => {
    actAs(member);
    const res = await getMyOrgs(
      createNextRequest(`${BASE_URL}/api/v1/me/orgs`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([expect.objectContaining({ id: orgId, isActive: true })]);
  });

  it('clears active_org_id on logout', async () => {
    actAs(member);
    const res = await logoutPost();
    const header = res.headers.get('set-cookie');

    expect(res.status).toBe(200);
    expect(header).toContain('active_org_id=;');
    expect(header).toContain('Max-Age=0');
  });
});
