import { AccountType, type RequestContext, SYSTEM_ROLE_TEMPLATES } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';

const suiteId = crypto.randomUUID().slice(0, 8);

describe(`Org Features (trigger)`, () => {
  const PREFIX = 'of-test-org-';
  let orgId: string;
  let student: TestUserFixture;

  beforeAll(async () => {
    student = await createTestUser({ role: 'student' });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();

    const supabase = createTypedServiceClient();
    const name = `${PREFIX}${suiteId}-${Date.now()}`;

    const { data: org } = await supabase.from('organizations').insert({ name }).select().single();

    if (!org) throw new Error('Failed to create org');
    orgId = org.id;
  });

  afterEach(async () => {
    if (orgId) {
      await cleanupOrganizationDeep(orgId);
    }
  });

  it('creates default roles with correct names', async () => {
    const supabase = createTypedServiceClient();

    const { data: roles } = await supabase
      .from('org_roles')
      .select('name, is_system')
      .eq('organization_id', orgId)
      .order('name');

    expect(roles).toHaveLength(3);
    expect(roles).toEqual([
      { name: 'admin', is_system: true },
      { name: 'member', is_system: true },
      { name: 'teacher', is_system: true },
    ]);
  });

  it('seeds the system-role permission matrix for all roles', async () => {
    const supabase = createTypedServiceClient();

    const { data: roles } = await supabase
      .from('org_roles')
      .select('id, name')
      .eq('organization_id', orgId);

    const roleIds: Record<string, string> = Object.fromEntries(
      (roles ?? []).map((r) => [r.name, r.id]),
    );

    for (const [roleName, template] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
      const roleId = roleIds[roleName];
      if (!roleId) throw new Error(`[setup] org role ${roleName} not seeded`);
      const { data: perms } = await supabase
        .from('org_role_permissions')
        .select('permission_key, scope')
        .eq('org_role_id', roleId);

      const actual = Object.fromEntries((perms ?? []).map((p) => [p.permission_key, p.scope]));
      expect(actual).toEqual(template.permissions);
    }
  });

  it('writes no org_role_features rows for any role (profiles are the role layer)', async () => {
    const supabase = createTypedServiceClient();

    // ADR-0015 phase 3c (D19/D27): the trigger seeds roles, profiles and
    // permissions only. `org_role_features` is revokes-only, so a fresh org has
    // zero rows and the resolver reads `org_roles.entitlement_profile`.
    const { data: features, error } = await supabase
      .from('org_role_features')
      .select('feature_key, is_enabled, org_roles!inner(organization_id)')
      .eq('org_roles.organization_id', orgId);

    expect(error).toBeNull();
    expect(features).toEqual([]);
  });

  it('derives org limits from plan_limits (no snapshot)', async () => {
    const supabase = createTypedServiceClient();
    const resolver = new EntitlementResolver(() => Promise.resolve(supabase));

    // The org defaults to the 'launch' plan. Limits are no longer copied into
    // an org_limits snapshot (#229) — they resolve live from the plan template.
    const { data: adminRole } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (!adminRole) throw new Error('admin role missing');

    await seedOrgMembership({
      organizationId: orgId,
      userId: student.id,
      orgRoleId: adminRole.id,
    });

    // A real membership ctx, exactly as withAuth builds it for an org member.
    const ctx: RequestContext = {
      traceId: 'org-features',
      userId: student.id,
      accountType: AccountType.STUDENT,
      activeOrgId: orgId,
      orgRoleId: adminRole.id,
      url: '/api/v1/me/entitlements',
      method: 'GET',
      groupIds: [],
      permissionScopes: {},
    };

    // base (personal) = 100/50/10 and launch (org) = 100/50/10, so the values
    // are unchanged — the point is that they resolve from the live plan.
    const { limits } = await resolver.resolveEntitlements(ctx);
    expect(limits.max_flashcards).toBe(100);
    expect(limits.max_questions).toBe(50);
    expect(limits.max_decks).toBe(10);
  });

  it('resolves the org plan for a member even when ctx.orgRoleId is null', async () => {
    const supabase = createTypedServiceClient();
    const resolver = new EntitlementResolver(() => Promise.resolve(supabase));

    // The org_members row — not the ctx role id — decides the org branch, so a
    // member whose ctx lost its role id must still resolve the org plan.
    const { data: adminRole } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (!adminRole) throw new Error('admin role missing');

    await seedOrgMembership({
      organizationId: orgId,
      userId: student.id,
      orgRoleId: adminRole.id,
    });

    const ctx: RequestContext = {
      traceId: 'org-features-null-role',
      userId: student.id,
      accountType: AccountType.STUDENT,
      activeOrgId: orgId,
      orgRoleId: null,
      url: '/api/v1/me/entitlements',
      method: 'GET',
      groupIds: [],
      permissionScopes: {},
    };

    const { limits } = await resolver.resolveEntitlements(ctx);
    expect(limits.max_flashcards).toBe(100);
    expect(limits.max_questions).toBe(50);
    expect(limits.max_decks).toBe(10);
  });
});
