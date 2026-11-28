import { AccountType, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOrganizationDeep,
  seedOrgMembership,
  useRealSupabase,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

const suiteId = crypto.randomUUID().slice(0, 8);
const PASSWORD = 'Seat4Test!';

// #1511 PR1: a seat licence grants its own keys, so an `ai_lite` pool is the
// only source of `ai.chat` on a `launch` organization (D38). A seat is a
// per-member licence: the assignment row is the entitlement, and the org on the
// assignment must be the caller's verified org.

function userSession(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client.auth.signInWithPassword({ email, password: PASSWORD }).then(({ error }) => {
    if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
    return client;
  });
}

describe('AI seat licence resolution (#1511)', () => {
  const tag = `${suiteId}-${Date.now()}`;
  const seatedEmail = `seat-a-${tag}@dev.local`;
  const unseatedEmail = `seat-b-${tag}@dev.local`;
  const foreignEmail = `seat-c-${tag}@dev.local`;

  let service: SupabaseClient<Database>;
  let orgA: string;
  let orgB: string;
  let memberRoleA: string;
  let memberRoleB: string;
  let seatedId: string;
  let unseatedId: string;
  let foreignId: string;
  let seatedSession: SupabaseClient<Database>;
  let unseatedSession: SupabaseClient<Database>;
  let foreignSession: SupabaseClient<Database>;

  async function createOrg(name: string): Promise<string> {
    const { data, error } = await service
      .from('organizations')
      .insert({ name })
      .select('id')
      .single();
    if (error) throw new Error(`org create failed: ${error.message}`);
    return data.id;
  }

  async function roleId(orgId: string, roleName: string): Promise<string> {
    const { data, error } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', roleName)
      .single();
    if (error) throw new Error(`role ${roleName} not found: ${error.message}`);
    return data.id;
  }

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: email.split('@')[0], account_type: 'student' },
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    service = createTypedServiceClient();

    orgA = await createOrg(`seat-org-a-${tag}`);
    orgB = await createOrg(`seat-org-b-${tag}`);
    memberRoleA = await roleId(orgA, 'member');
    memberRoleB = await roleId(orgB, 'member');

    seatedId = await createUser(seatedEmail);
    unseatedId = await createUser(unseatedEmail);
    foreignId = await createUser(foreignEmail);

    await seedOrgMembership({ organizationId: orgA, userId: seatedId, orgRoleId: memberRoleA });
    await seedOrgMembership({ organizationId: orgA, userId: unseatedId, orgRoleId: memberRoleA });
    await seedOrgMembership({ organizationId: orgB, userId: foreignId, orgRoleId: memberRoleB });

    const { data: pool, error: poolError } = await service
      .from('org_seat_pools')
      .insert({ organization_id: orgA, plan_key: 'ai_lite', total: 2 })
      .select('id')
      .single();
    if (poolError) throw new Error(`seat pool create failed: ${poolError.message}`);

    const { error: seatError } = await service
      .from('org_seat_assignments')
      .insert({ organization_id: orgA, pool_id: pool.id, user_id: seatedId });
    if (seatError) throw new Error(`seat assignment failed: ${seatError.message}`);

    // A stale row in a foreign org: the caller's own org must be the filter,
    // not the presence of any assignment row.
    const { error: foreignSeatError } = await service
      .from('org_seat_assignments')
      .insert({ organization_id: orgA, pool_id: pool.id, user_id: foreignId });
    if (foreignSeatError) throw new Error(`foreign seat row failed: ${foreignSeatError.message}`);

    seatedSession = await userSession(seatedEmail);
    unseatedSession = await userSession(unseatedEmail);
    foreignSession = await userSession(foreignEmail);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    if (orgA) await cleanupOrganizationDeep(orgA).catch(() => {});
    if (orgB) await cleanupOrganizationDeep(orgB).catch(() => {});
    if (seatedId) await service.auth.admin.deleteUser(seatedId).catch(() => {});
    if (unseatedId) await service.auth.admin.deleteUser(unseatedId).catch(() => {});
    if (foreignId) await service.auth.admin.deleteUser(foreignId).catch(() => {});
  });

  function ctxFor(input: {
    userId: string;
    activeOrgId: string;
    orgRoleId: string;
  }): RequestContext {
    return {
      traceId: `seat-${suiteId}`,
      userId: input.userId,
      accountType: AccountType.STUDENT,
      orgRoleId: input.orgRoleId,
      activeOrgId: input.activeOrgId,
      url: '/api/v1/ai/chat',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };
  }

  it('grants ai.chat and the tier quota to the assigned member only', async () => {
    const resolver = new EntitlementResolver(() => Promise.resolve(seatedSession));

    const { entitlements, limits, sources } = await resolver.resolveEntitlements(
      ctxFor({ userId: seatedId, activeOrgId: orgA, orgRoleId: memberRoleA }),
    );

    expect(entitlements).toContain('ai.chat');
    expect(limits.max_ai_tokens_per_day).toBe(100000);
    expect(sources.seat).toEqual({ planKey: 'ai_lite', origin: 'seat' });
  });

  it('grants no AI to an unassigned member of the same org', async () => {
    const resolver = new EntitlementResolver(() => Promise.resolve(unseatedSession));

    const { entitlements, limits, sources } = await resolver.resolveEntitlements(
      ctxFor({ userId: unseatedId, activeOrgId: orgA, orgRoleId: memberRoleA }),
    );

    expect(entitlements).not.toContain('ai.chat');
    expect(limits.max_ai_tokens_per_day).toBe(0);
    expect(sources.seat).toBeNull();
  });

  it('ignores an assignment row that belongs to another org', async () => {
    // `foreign` holds a stale seat row in org A but resolves inside org B.
    const resolver = new EntitlementResolver(() => Promise.resolve(foreignSession));

    const { entitlements, sources } = await resolver.resolveEntitlements(
      ctxFor({ userId: foreignId, activeOrgId: orgB, orgRoleId: memberRoleB }),
    );

    expect(entitlements).not.toContain('ai.chat');
    expect(sources.seat).toBeNull();
  });
});
