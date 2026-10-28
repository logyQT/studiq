import type { RequestContext } from '@studiq/authz';
import { FeatureResolver } from '@studiq/server/services/feature.resolver';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  createServiceClient,
  seedOrgMembership,
} from '#test/integration/helpers';

const suiteId = crypto.randomUUID().slice(0, 8);

// Regression tests for issue #124: org_role_features had RLS enabled with zero
// policies, so every user-session query silently returned [] (service_role
// bypasses RLS, which is why nothing noticed). These tests sign in a REAL user
// with the anon key — the exact access path feature.resolver.ts uses in
// production — and assert the rows are visible, scoped to the caller's own
// organizations. org_limits carried the same bug but was dropped in #229; org
// capacity now resolves from `organizations.plan → plan_limits` through the
// same user session, so the limits read path is covered here too.

const PASSWORD = 'Rls4Test!';

function anonSession(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client.auth.signInWithPassword({ email, password: PASSWORD }).then(({ error }) => {
    if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
    return client;
  });
}

describe(`org_role_features RLS`, () => {
  const tag = `${suiteId}-${Date.now()}`;
  const memberEmail = `rls-member-${tag}@dev.local`;
  const outsiderEmail = `rls-outsider-${tag}@dev.local`;

  let service: SupabaseClient;
  let org1: string; // the member's org
  let org2: string; // a foreign org neither user belongs to
  let hubOrg: string; // the member's org on a paid plan (limit RLS probe)
  let org1MemberRole: string;
  let org2AdminRole: string;
  let hubMemberRole: string;
  let memberId: string;
  let outsiderId: string;
  let memberSession: SupabaseClient;
  let outsiderSession: SupabaseClient;

  async function createOrg(name: string): Promise<string> {
    const { data, error } = await service
      .from('organizations')
      .insert({ name })
      .select('id')
      .single();
    if (error || !data) throw new Error(`org create failed: ${error?.message}`);
    return data.id;
  }

  async function roleId(orgId: string, roleName: string): Promise<string> {
    const { data, error } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', roleName)
      .single();
    if (error || !data) throw new Error(`role ${roleName} not found: ${error?.message}`);
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
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    service = createServiceClient();

    org1 = await createOrg(`rls-org1-${tag}`);
    org2 = await createOrg(`rls-org2-${tag}`);
    hubOrg = await createOrg(`rls-org-hub-${tag}`);
    org1MemberRole = await roleId(org1, 'member');
    org2AdminRole = await roleId(org2, 'admin');
    hubMemberRole = await roleId(hubOrg, 'member');

    // A paid plan makes org-derived limits differ from the member's personal
    // (`base`) plan, so an RLS-hidden `organizations` row cannot masquerade
    // as a correct answer in the LimitsResolver test below.
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
    await cleanupOrganizationDeep(org2).catch(() => {});
    await cleanupOrganizationDeep(hubOrg).catch(() => {});
    if (memberId) await service.auth.admin.deleteUser(memberId).catch(() => {});
    if (outsiderId) await service.auth.admin.deleteUser(outsiderId).catch(() => {});
  });

  it('member session reads their org role feature rows (the bug: always [])', async () => {
    const { data, error } = await memberSession
      .from('org_role_features')
      .select('feature_key, is_enabled')
      .eq('org_role_id', org1MemberRole);

    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);

    // Exactly what the service-role client sees — RLS no longer hides rows.
    const { data: expected } = await service
      .from('org_role_features')
      .select('feature_key, is_enabled')
      .eq('org_role_id', org1MemberRole);
    expect(data).toEqual(expected);
  });

  it('role features stay inside the caller org: no cross-org or non-member reads', async () => {
    const { data: foreign } = await memberSession
      .from('org_role_features')
      .select('id')
      .eq('org_role_id', org2AdminRole);
    expect(foreign).toEqual([]);

    const { data: outsiderRows } = await outsiderSession.from('org_role_features').select('id');
    expect(outsiderRows).toEqual([]);
  });

  it('FeatureResolver uses the org-role entitlement for a non-seated member', async () => {
    const resolver = new FeatureResolver(async () => memberSession);
    const ctx: RequestContext = {
      traceId: `rls-${suiteId}`,
      userId: memberId,
      accountType: 'STUDENT',
      orgRoleId: org1MemberRole,
      activeOrgId: org1,
      url: '/api/v1/features/me',
      method: 'GET',
      groupIds: [],
      permissionScopes: {},
    };

    const { features } = await resolver.resolveFeatures(ctx);

    // The member role's org_role_features rows are the entitlement:
    // ['flashcards', 'quiz', 'documents'] (org trigger filters the launch
    // plan down to basic features for this role). Without the RLS fix the
    // query returns [], the resolver falls through to the org plan and
    // over-grants member.manage / org.manage / group.manage instead.
    expect(features).toEqual(['flashcards', 'quiz', 'documents']);
  });

  it('LimitsResolver resolves org capacity from a real member session (RLS path)', async () => {
    const resolver = new LimitsResolver(async () => memberSession);
    const ctx: RequestContext = {
      traceId: `rls-limits-${suiteId}`,
      userId: memberId,
      accountType: 'STUDENT',
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
    await expect(resolver.getEffectiveLimit(ctx, 'max_flashcards')).resolves.toBe(2000);
  });

  it('LimitsResolver cannot read a foreign org plan through RLS', async () => {
    const resolver = new LimitsResolver(async () => outsiderSession);
    const ctx: RequestContext = {
      traceId: `rls-limits-outsider-${suiteId}`,
      userId: outsiderId,
      accountType: 'STUDENT',
      orgRoleId: null,
      activeOrgId: hubOrg,
      url: '/api/v1/decks',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };

    // Not a member of the hub org: its plan row must stay invisible, so only
    // the outsider's own `base` plan (max_flashcards 100) applies.
    await expect(resolver.getEffectiveLimit(ctx, 'max_flashcards')).resolves.toBe(100);
  });
});
