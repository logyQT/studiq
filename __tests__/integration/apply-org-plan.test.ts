import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// Issue #177: apply_org_plan() changes organizations.plan and re-syncs the
// org_role_features snapshot. Live limit resolution (organizations.plan ->
// plan_limits) is covered by limits-resolution.test.ts and org-features.test.ts;
// this file intentionally covers only the plan switch, the feature sync and the
// RPC guards.

describe('apply_org_plan()', () => {
  let service: SupabaseClient;
  let orgId: string;

  async function roleFeatures(roleName: string): Promise<string[]> {
    const { data, error } = await service
      .from('org_role_features')
      .select('feature_key, org_roles!inner(name, organization_id)')
      .eq('org_roles.organization_id', orgId)
      .eq('org_roles.name', roleName);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.feature_key).sort();
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
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('upgrades the plan and role features, and downgrades them back', async () => {
    expect(await plan()).toBe('launch');
    expect(await roleFeatures('admin')).not.toContain('role.builder');

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

    const down = await service.rpc('apply_org_plan', { p_org_id: orgId, p_plan: 'launch' });
    expect(down.error).toBeNull();

    expect(await plan()).toBe('launch');
    const adminFeatures = await roleFeatures('admin');
    expect(adminFeatures).not.toContain('role.builder');
    expect(adminFeatures).not.toContain('branding');
    // org.manage marks an org admin for FeatureResolver and is never revoked
    expect(adminFeatures).toContain('org.manage');
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
