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
  let seated: Session;
  let outsider: Session;
  let orgManager: Session;
  let outsiderManager: Session;
  let testUsers: TestUserFixture[] = [];

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

    // Give the org a non-default plan so the manager path cannot be confused with
    // the manager's personal `launch` plan (#181).
    const { error: planError } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', orgId);
    if (planError) throw new Error(`[setup] failed to set org plan: ${planError.message}`);

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

    // Seated member (#270): a StudiQ Ace seat makes the seat plan the member's
    // effective plan for features and limits, so `/me/plan` must serve it too.
    const seatedUser = await createTestUser({ role: 'student', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: seatedUser.id,
      orgRoleId: memberRole.id,
    });

    const { data: seatPool, error: poolError } = await service
      .from('org_seat_pools')
      .insert({ organization_id: orgId, plan_key: 'ace', total: 1 })
      .select('id')
      .single();
    if (poolError || !seatPool) {
      throw new Error(`[setup] failed to create seat pool: ${poolError?.message}`);
    }

    const { error: assignmentError } = await service.from('org_seat_assignments').insert({
      organization_id: orgId,
      pool_id: seatPool.id,
      user_id: seatedUser.id,
    });
    if (assignmentError) {
      throw new Error(`[setup] failed to assign seat: ${assignmentError.message}`);
    }

    const outsiderUser = await createTestUser({ role: 'student', password: PASSWORD });
    // Managers have a personal `launch` plan, same as the default org plan, so an
    // outsider manager is the one that proves the forged cookie is rejected.
    const outsiderManagerUser = await createTestUser({ role: 'manager', password: PASSWORD });

    member = await signIn(memberUser.email, memberUser);
    seated = await signIn(seatedUser.email, seatedUser);
    outsider = await signIn(outsiderUser.email, outsiderUser);
    orgManager = await signIn(managerUser.email, managerUser);
    outsiderManager = await signIn(outsiderManagerUser.email, outsiderManagerUser);
    testUsers = [managerUser, memberUser, seatedUser, outsiderUser, outsiderManagerUser];
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
    for (const user of testUsers) {
      if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('serves the personal plan to a student member (#181)', async () => {
    actAs(member);
    const res = await getMyPlan(
      createNextRequest(`${BASE_URL}/api/v1/me/plan`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.key).toBe('base');
  });

  it('serves the seat plan to a seated student member (#270)', async () => {
    actAs(seated);
    const res = await getMyPlan(
      createNextRequest(`${BASE_URL}/api/v1/me/plan`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.key).toBe('ace');
    expect(body.data.limits.max_ai_tokens_per_day).toBe(200000);
    expect(body.data.limits.max_decks).toBe(200);
    expect(body.data.features).toContain('ai.chat');
  });

  it('serves the org plan to the org manager', async () => {
    actAs(orgManager);
    const res = await getMyPlan(
      createNextRequest(`${BASE_URL}/api/v1/me/plan`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.key).toBe('hub');
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

  it('ignores a forged active_org_id cookie for an outsider manager', async () => {
    actAs(outsiderManager);
    const res = await getMyPlan(
      createNextRequest(`${BASE_URL}/api/v1/me/plan`, { method: 'GET' }, { active_org_id: orgId }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.key).toBe('launch');
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
    const res = await logoutPost(
      createNextRequest(`${BASE_URL}/api/v1/auth/logout`, { method: 'POST' }),
    );
    const header = res.headers.get('set-cookie');

    expect(res.status).toBe(200);
    expect(header).toContain('active_org_id=;');
    expect(header).toContain('Expires=Thu, 01 Jan 1970');
    expect(header).not.toContain('Max-Age');
  });
});
