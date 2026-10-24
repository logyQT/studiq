import type { RequestContext } from '@studiq/authz';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  seedOrgMembership,
  TEST_USERS,
} from '#test/integration/helpers';

// Issue #177: apply_org_plan() changes organizations.plan and re-syncs the
// org_role_features snapshot. Limits are no longer snapshotted (#229) — they
// are derived live from organizations.plan -> plan_limits, so the same call
// must immediately change what LimitsResolver reports.

describe('apply_org_plan()', () => {
  let service: SupabaseClient;
  let orgId: string;
  let adminRoleId: string;

  async function roleFeatures(roleName: string): Promise<string[]> {
    const { data, error } = await service
      .from('org_role_features')
      .select('feature_key, org_roles!inner(name, organization_id)')
      .eq('org_roles.organization_id', orgId)
      .eq('org_roles.name', roleName);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.feature_key).sort();
  }

  /**
   * Probe the live limit through the real resolver (service-role client). The
   * caller is a real member of this org and belongs to no seat, so this
   * exercises the org-plan path only.
   *
   * `TEST_USERS.TEACHER` has personal plan `lite` (max_students 5, max_groups 1)
   * — both at or below the launch/hub org values, so `Math.max(personal, org)`
   * is still decided by the org plan. The seeded student is `base`
   * (max_students -1 = unlimited), which would silently break the assertions.
   */
  async function limit(key: string): Promise<number> {
    const resolver = new LimitsResolver(async () => service);
    const ctx: RequestContext = {
      traceId: 'apply-org-plan',
      userId: TEST_USERS.TEACHER.id,
      accountType: 'EDUCATOR',
      activeOrgId: orgId,
      orgRoleId: adminRoleId,
      url: '/api/v1/features/me',
      method: 'GET',
      groupIds: [],
      permissionScopes: {},
    };
    return resolver.getEffectiveLimit(ctx, key);
  }

  async function plan(): Promise<string> {
    const { data } = await service.from('organizations').select('plan').eq('id', orgId).single();
    return data?.plan;
  }

  beforeAll(async () => {
    service = createServiceClient();
    const { data, error } = await service
      .from('organizations')
      .insert({ name: `apply-org-plan-${Date.now()}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`org create failed: ${error?.message}`);
    orgId = data.id;

    const { data: role, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (roleError || !role) throw new Error(`admin role lookup failed: ${roleError?.message}`);
    adminRoleId = role.id;

    // `getEffectiveLimit` trusts `activeOrgId` only for a verified `org_members`
    // row (#230), so seed the real membership the probe ctx models.
    await seedOrgMembership({
      organizationId: orgId,
      userId: TEST_USERS.TEACHER.id,
      orgRoleId: adminRoleId,
    });
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('upgrades the plan, role features and limits, and downgrades them back', async () => {
    expect(await plan()).toBe('launch');
    expect(await roleFeatures('admin')).not.toContain('role.builder');
    expect(await limit('max_students')).toBe(5);
    expect(await limit('max_groups')).toBe(3);

    const up = await service.rpc('apply_org_plan', { p_org_id: orgId, p_plan: 'hub' });
    expect(up.error).toBeNull();

    expect(await plan()).toBe('hub');
    expect(await roleFeatures('admin')).toEqual(
      expect.arrayContaining(['role.builder', 'branding', 'quiz.builder']),
    );
    // teacher never gets member.manage / role.builder; member only the learner features
    expect(await roleFeatures('teacher')).not.toContain('role.builder');
    expect(await roleFeatures('member')).not.toContain('quiz.builder');
    expect(await roleFeatures('member')).toContain('branding');
    expect(await limit('max_students')).toBe(50);
    expect(await limit('max_groups')).toBe(20);

    const down = await service.rpc('apply_org_plan', { p_org_id: orgId, p_plan: 'launch' });
    expect(down.error).toBeNull();

    expect(await plan()).toBe('launch');
    const adminFeatures = await roleFeatures('admin');
    expect(adminFeatures).not.toContain('role.builder');
    expect(adminFeatures).not.toContain('branding');
    // org.manage marks an org admin for FeatureResolver and is never revoked
    expect(adminFeatures).toContain('org.manage');
    expect(await limit('max_students')).toBe(5);
    expect(await limit('max_groups')).toBe(3);
  });

  it('rejects an unknown organization or plan', async () => {
    const badPlan = await service.rpc('apply_org_plan', { p_org_id: orgId, p_plan: 'nope' });
    expect(badPlan.error).not.toBeNull();

    const badOrg = await service.rpc('apply_org_plan', {
      p_org_id: '00000000-0000-4000-8000-0000000000ff',
      p_plan: 'hub',
    });
    expect(badOrg.error).not.toBeNull();
    expect(await plan()).toBe('launch');
  });

  it('is not callable with the anon key', async () => {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await anon.rpc('apply_org_plan', { p_org_id: orgId, p_plan: 'campus' });
    expect(error).not.toBeNull();
    expect(await plan()).toBe('launch');
  });
});
