import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// ADR-0015 phase 3c (D19/D27/D31): `change_org_plan` moves `organizations.plan`
// and nothing else. The org layer is derived live — `plan_entitlements` /
// `plan_limits` plus `org_roles.entitlement_profile` — so no grant snapshot is
// written. `org_role_features` is revokes-only: a hand-inserted
// `is_enabled = false` row survives a plan change and the old writer is gone.
// Live limit/feature resolution itself is covered by limits-resolution.test.ts,
// org-features.test.ts and entitlement-profile.test.ts.

describe('change_org_plan()', () => {
  let service: SupabaseClient;
  let orgId: string;
  let adminRoleId: string;

  async function plan(): Promise<string | undefined> {
    const { data } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single()
      .overrideTypes<{ plan: string }, { merge: false }>();
    return data?.plan;
  }

  async function roleFeatures(): Promise<{ feature_key: string; is_enabled: boolean }[]> {
    const { data, error } = await service
      .from('org_role_features')
      .select('feature_key, is_enabled, org_roles!inner(organization_id)')
      .eq('org_roles.organization_id', orgId)
      .overrideTypes<{ feature_key: string; is_enabled: boolean }[], { merge: false }>();
    if (error) throw new Error(error.message);
    return dbRows(data).map((row) => ({
      feature_key: row.feature_key,
      is_enabled: row.is_enabled,
    }));
  }

  beforeAll(async () => {
    service = createServiceClient();
    const { data, error } = await service
      .from('organizations')
      .insert({ name: `change-org-plan-${Date.now()}` })
      .select('id')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>();
    if (error) throw new Error(`org create failed: ${error.message}`);
    orgId = data.id;

    const { data: adminRole, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>();
    if (roleError) throw new Error(`admin role read failed: ${roleError.message}`);
    adminRoleId = adminRole.id;
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('moves the plan up and back down without writing a feature snapshot', async () => {
    expect(await plan()).toBe('launch');
    // A fresh org has no feature rows: the profile governs the role layer.
    expect(await roleFeatures()).toEqual([]);

    const up = await service.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'hub' });
    expect(up.error).toBeNull();
    expect(await plan()).toBe('hub');
    expect(await roleFeatures()).toEqual([]);

    const down = await service.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'launch' });
    expect(down.error).toBeNull();
    expect(await plan()).toBe('launch');
    expect(await roleFeatures()).toEqual([]);
  });

  it('leaves a hand-inserted revoke row in place across a plan change', async () => {
    const { error: insertError } = await service.from('org_role_features').insert({
      org_role_id: adminRoleId,
      feature_key: 'ai.chat',
      is_enabled: false,
    });
    expect(insertError).toBeNull();

    const { error } = await service.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'hub' });
    expect(error).toBeNull();

    expect(await roleFeatures()).toEqual([{ feature_key: 'ai.chat', is_enabled: false }]);

    // Leave the org as the other cases expect it.
    await service.from('org_role_features').delete().eq('org_role_id', adminRoleId);
    await service.from('organizations').update({ plan: 'launch' }).eq('id', orgId);
  });

  it('rejects an unknown organization or plan', async () => {
    const badPlan = await service.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'nope' });
    expect(badPlan.error?.code).toBe('P0002');

    const badOrg = await service.rpc('change_org_plan', {
      p_org_id: '00000000-0000-4000-8000-0000000000ff',
      p_plan: 'hub',
    });
    expect(badOrg.error?.code).toBe('P0002');
    expect(await plan()).toBe('launch');
  });

  it('is not callable with the anon key', async () => {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await anon.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'campus' });
    expect(error).not.toBeNull();
    expect(await plan()).toBe('launch');
  });

  it('no longer exposes apply_org_plan', async () => {
    // The generated types intentionally lack the dropped name; the integration
    // client is untyped, so the assertion is the database's answer.
    const { error } = await service.rpc('apply_org_plan', { p_org_id: orgId, p_plan: 'hub' });
    expect(error).not.toBeNull();
    expect(await plan()).toBe('launch');
  });
});
