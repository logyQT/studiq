import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// ADR-0015 phase 3c/7 (D19/D27/D31): `change_org_plan` moves
// `organizations.plan` and nothing else. The org layer is derived live —
// `plan_entitlements` / `plan_limits` plus `org_roles.entitlement_profile` — so
// there is no feature snapshot to write, and phase 7 dropped the legacy
// per-role table the old cases used as a revoke fixture. Live limit/feature
// resolution itself is covered by limits-resolution.test.ts and
// org-features.test.ts.

describe('change_org_plan()', () => {
  let service: SupabaseClient;
  let orgId: string;

  async function plan(): Promise<string | undefined> {
    const { data } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single()
      .overrideTypes<{ plan: string }, { merge: false }>();
    return data?.plan;
  }

  /**
   * The org's role-permission rows, as `role/name@key@scope`. A plan move must
   * leave this derived layer untouched: permissions are authority, not plan
   * data.
   */
  async function permissionFingerprint(): Promise<string[]> {
    const { data: roles, error: roleError } = await service
      .from('org_roles')
      .select('id, name')
      .eq('organization_id', orgId);
    if (roleError) throw new Error(roleError.message);
    const roleNames = new Map(dbRows(roles).map((role) => [role.id, role.name]));

    const { data, error } = await service
      .from('org_role_permissions')
      .select('org_role_id, permission_key, scope')
      .in('org_role_id', [...roleNames.keys()]);
    if (error) throw new Error(error.message);

    return dbRows(data)
      .map((row) => `${roleNames.get(row.org_role_id)}@${row.permission_key}@${row.scope}`)
      .toSorted();
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
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('moves the plan up and back down without writing a derived snapshot', async () => {
    expect(await plan()).toBe('launch');
    const before = await permissionFingerprint();
    expect(before.length).toBeGreaterThan(0);

    const up = await service.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'hub' });
    expect(up.error).toBeNull();
    expect(await plan()).toBe('hub');
    expect(await permissionFingerprint()).toEqual(before);

    const down = await service.rpc('change_org_plan', { p_org_id: orgId, p_plan: 'launch' });
    expect(down.error).toBeNull();
    expect(await plan()).toBe('launch');
    expect(await permissionFingerprint()).toEqual(before);
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
