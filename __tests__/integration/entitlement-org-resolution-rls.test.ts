import { AccountType, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

const suiteId = crypto.randomUUID().slice(0, 8);

// Regression tests for issue #124: the resolver's reads ran under RLS, and a
// user-session query that returned [] silently changed the answer. These tests
// sign in a REAL user with the anon key — the exact access path
// entitlement.resolver.ts uses in production — and assert the org layer
// (profile, plan, seat) resolves through it. The legacy per-role feature table
// that first exposed the bug was dropped in phase 7; its replacement is the
// profile column and the seat plan.

const PASSWORD = 'Rls4Test!';

function anonSession(email: string): Promise<SupabaseClient<Database>> {
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

describe(`org entitlement resolution under RLS`, () => {
  const tag = `${suiteId}-${Date.now()}`;
  const memberEmail = `rls-member-${tag}@dev.local`;
  const outsiderEmail = `rls-outsider-${tag}@dev.local`;

  let service: SupabaseClient<Database>;
  let org1: string; // the member's org
  let hubOrg: string; // the member's org on a paid plan (limit RLS probe)
  let org1MemberRole: string;
  let hubMemberRole: string;
  let memberId: string;
  let outsiderId: string;
  let memberSession: SupabaseClient<Database>;
  let outsiderSession: SupabaseClient<Database>;

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
      // handle_new_user() reads app_metadata.account_type first, then falls
      // back to validated user_metadata.account_type — mirror what the
      // register route stores for real signups.
      user_metadata: { name: email.split('@')[0], account_type: 'student' },
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    service = createTypedServiceClient();

    org1 = await createOrg(`rls-org1-${tag}`);
    hubOrg = await createOrg(`rls-org-hub-${tag}`);
    org1MemberRole = await roleId(org1, 'member');
    hubMemberRole = await roleId(hubOrg, 'member');

    // A paid plan makes org-derived limits differ from the member's personal
    // (`base`) plan, so an RLS-hidden `organizations` row cannot masquerade
    // as a correct answer in the resolver limit test below.
    const { error: planError } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', hubOrg);
    if (planError) throw new Error(`hub plan update failed: ${planError.message}`);

    memberId = await createUser(memberEmail);
    outsiderId = await createUser(outsiderEmail);

    // Member belongs to org1 and hubOrg; the outsider belongs to no org.
    await seedOrgMembership({
      organizationId: org1,
      userId: memberId,
      orgRoleId: org1MemberRole,
    });
    await seedOrgMembership({
      organizationId: hubOrg,
      userId: memberId,
      orgRoleId: hubMemberRole,
    });

    memberSession = await anonSession(memberEmail);
    outsiderSession = await anonSession(outsiderEmail);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(org1).catch(() => {});
    await cleanupOrganizationDeep(hubOrg).catch(() => {});
    if (memberId) await service.auth.admin.deleteUser(memberId).catch(() => {});
    if (outsiderId) await service.auth.admin.deleteUser(outsiderId).catch(() => {});
  });

  it('EntitlementResolver uses the org-role profile for a non-seated member', async () => {
    const resolver = new EntitlementResolver(() => Promise.resolve(memberSession));
    const ctx: RequestContext = {
      traceId: `rls-${suiteId}`,
      userId: memberId,
      accountType: AccountType.STUDENT,
      orgRoleId: org1MemberRole,
      activeOrgId: org1,
      url: '/api/v1/me/entitlements',
      method: 'GET',
      groupIds: [],
      permissionScopes: {},
    };

    const { entitlements } = await resolver.resolveEntitlements(ctx);

    // The member role's profile is `learner` on the `launch` org: the learner
    // set intersected with the launch ceiling is exactly ['flashcards', 'quiz']
    // (`documents` left the catalog in phase 1c, the four management markers
    // in 2b-7). Without the RLS fix an empty org_roles read would resolve
    // `none` and under-grant every member.
    expect(entitlements).toEqual(['flashcards', 'quiz']);
  });

  it('the resolver resolves org capacity from a real member session (RLS path)', async () => {
    const resolver = new EntitlementResolver(() => Promise.resolve(memberSession));
    const ctx: RequestContext = {
      traceId: `rls-limits-${suiteId}`,
      userId: memberId,
      accountType: AccountType.STUDENT,
      orgRoleId: hubMemberRole,
      activeOrgId: hubOrg,
      url: '/api/v1/decks',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };

    // `hub` raises max_flashcards to 2000, while the member's personal `base`
    // plan caps it at 100. If RLS hid the `organizations` row the resolver
    // would silently fall back to 100 — the #124/#182 class of regression.
    const { limits } = await resolver.resolveEntitlements(ctx);
    expect(limits.max_flashcards).toBe(2000);
  });

  it('the resolver reads a seated member plan through the embed under RLS', async () => {
    // An `ace` seat on the `launch` org: 5000 is the only max_flashcards
    // above launch's 100, so the value proves the member's own session could
    // read the assignment -> pool(plan_key) embed (and not just the org plan).
    const { data: pool, error: poolError } = await service
      .from('org_seat_pools')
      .insert({ organization_id: org1, plan_key: 'ace', total: 1 })
      .select('id')
      .single();
    if (poolError) throw new Error(`seat pool create failed: ${poolError.message}`);
    const { error: seatError } = await service
      .from('org_seat_assignments')
      .insert({ organization_id: org1, pool_id: pool.id, user_id: memberId });
    if (seatError) throw new Error(`seat assignment failed: ${seatError.message}`);

    const resolver = new EntitlementResolver(() => Promise.resolve(memberSession));
    const ctx: RequestContext = {
      traceId: `rls-seat-${suiteId}`,
      userId: memberId,
      accountType: AccountType.STUDENT,
      orgRoleId: org1MemberRole,
      activeOrgId: org1,
      url: '/api/v1/decks',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };

    const { limits, sources } = await resolver.resolveEntitlements(ctx);

    expect(sources.seat).toEqual({ planKey: 'ace', origin: 'seat' });
    expect(limits.max_flashcards).toBe(5000);
  });

  it('the resolver cannot read a foreign org plan through RLS', async () => {
    const resolver = new EntitlementResolver(() => Promise.resolve(outsiderSession));
    const ctx: RequestContext = {
      traceId: `rls-limits-outsider-${suiteId}`,
      userId: outsiderId,
      accountType: AccountType.STUDENT,
      orgRoleId: null,
      activeOrgId: hubOrg,
      url: '/api/v1/decks',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };

    // Not a member of the hub org: its plan row must stay invisible, so only
    // the outsider's own `base` plan (max_flashcards 100) applies.
    const { limits } = await resolver.resolveEntitlements(ctx);
    expect(limits.max_flashcards).toBe(100);
  });
});
