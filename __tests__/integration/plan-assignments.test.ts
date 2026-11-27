import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser } from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// B3 (#1495): an unlisted plan is pinned to organizations through
// `plan_assignments`, `change_org_plan` refuses it everywhere else, and the
// table stays service-role only. The rule is enforced twice on purpose: the
// function refuses the plan move, and a `before delete` trigger refuses to
// orphan an organization that is still on the plan.
//
// `assign_plan_to_org` is the admin panel's one step: it pins the plan **and**
// moves the organization, because a pin without the move grants nothing.

const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PLAN_KEY = `contract_${tag}`;
const PASSWORD = 'PlanAssign!';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

describe('plan_assignments (B3)', () => {
  let service: SupabaseClient<Database>;
  let orgA: string;
  let orgB: string;

  async function orgPlan(orgId: string): Promise<string | undefined> {
    const { data, error } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    if (error) throw new Error(error.message);
    return data.plan;
  }

  async function assignedRows(): Promise<number> {
    const { data, error } = await service
      .from('plan_assignments')
      .select('plan_key')
      .eq('plan_key', PLAN_KEY);
    if (error) throw new Error(error.message);
    return data.length;
  }

  beforeAll(async () => {
    service = createServiceClient();

    const names = [`plan-assignments-a-${tag}`, `plan-assignments-b-${tag}`];
    const { error: orgError } = await service
      .from('organizations')
      .insert(names.map((name) => ({ name })));
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);

    const { data: orgs, error: readError } = await service
      .from('organizations')
      .select('id, name')
      .in('name', names);
    if (readError) throw new Error(`org read failed: ${readError.message}`);

    orgA = orgs.find((org) => org.name === names[0])?.id ?? '';
    orgB = orgs.find((org) => org.name === names[1])?.id ?? '';
    if (!orgA || !orgB) throw new Error('organization fixture is incomplete');

    const { error: planError } = await service.from('subscription_plans').insert({
      key: PLAN_KEY,
      name: 'Contract Plan',
      scope: 'organization',
      visibility: 'unlisted',
      billing_mode: 'invoice',
      price_monthly: 0,
    });
    if (planError) throw new Error(`plan create failed: ${planError.message}`);
  });

  afterAll(async () => {
    // `change_org_plan` and the trigger both refuse while a fixture is
    // inconsistent, so the cleanup unwinds in the same order the guards expect.
    if (orgA) await service.from('organizations').update({ plan: 'launch' }).eq('id', orgA);
    if (orgB) await service.from('organizations').update({ plan: 'launch' }).eq('id', orgB);
    await service.from('plan_assignments').delete().eq('plan_key', PLAN_KEY);
    await service.from('subscription_plans').delete().eq('key', PLAN_KEY);
    if (orgA) await cleanupOrganizationDeep(orgA);
    if (orgB) await cleanupOrganizationDeep(orgB);
  });

  it('refuses the unlisted plan for an organization that is not assigned to it', async () => {
    const { error } = await service.rpc('change_org_plan', { p_org_id: orgA, p_plan: PLAN_KEY });

    expect(error?.code).toBe('42501');
    expect(error?.message).toContain(PLAN_KEY);
    expect(error?.message).toContain(orgA);
    expect(await orgPlan(orgA)).toBe('launch');
  });

  it('refuses a personal plan for an organization through both writers', async () => {
    // `organizations.plan` is the organization ceiling, so a personal plan
    // there would grant personal entitlements to the organization.
    const moved = await service.rpc('change_org_plan', { p_org_id: orgB, p_plan: 'plus' });
    expect(moved.error?.code).toBe('22023');
    expect(moved.error?.message).toContain('plus');
    expect(moved.error?.message).toContain('personal');
    expect(await orgPlan(orgB)).toBe('launch');

    const assigned = await service.rpc('assign_plan_to_org', {
      p_plan_key: 'plus',
      p_org_id: orgB,
    });
    expect(assigned.error?.code).toBe('22023');
    expect(assigned.error?.message).toContain('personal');
    // The refusal runs before the pin: nothing was linked and nothing moved.
    expect(await orgPlan(orgB)).toBe('launch');
    const { data: pins, error: pinError } = await service
      .from('plan_assignments')
      .select('plan_key')
      .eq('plan_key', 'plus')
      .eq('organization_id', orgB);
    expect(pinError).toBeNull();
    expect(pins).toHaveLength(0);
  });

  it('is refused to anon and to a signed-in caller, and accepted with the service role', async () => {
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonCall = await anon.rpc('assign_plan_to_org', {
      p_plan_key: PLAN_KEY,
      p_org_id: orgB,
    });
    expect(anonCall.error?.code).toBe('42501');

    const user = await createTestUser({ role: 'student', password: PASSWORD });
    const session = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await session.auth.signInWithPassword({
      email: user.email,
      password: PASSWORD,
    });
    expect(signInError).toBeNull();

    const signedInCall = await session.rpc('assign_plan_to_org', {
      p_plan_key: PLAN_KEY,
      p_org_id: orgB,
    });
    expect(signedInCall.error?.code).toBe('42501');
    expect(await orgPlan(orgB)).toBe('launch');

    // The service role executes it, and the organization moves with the pin.
    const serviceCall = await service.rpc('assign_plan_to_org', {
      p_plan_key: PLAN_KEY,
      p_org_id: orgB,
    });
    expect(serviceCall.error).toBeNull();
    expect(await orgPlan(orgB)).toBe(PLAN_KEY);

    // Unwind orgB so the later cases see exactly one pin.
    const moveBack = await service.rpc('change_org_plan', {
      p_org_id: orgB,
      p_plan: 'launch',
    });
    expect(moveBack.error).toBeNull();
    const unpin = await service
      .from('plan_assignments')
      .delete()
      .eq('plan_key', PLAN_KEY)
      .eq('organization_id', orgB);
    expect(unpin.error).toBeNull();
  });

  it('links the plan and moves the organization in one call', async () => {
    const { error } = await service.rpc('assign_plan_to_org', {
      p_plan_key: PLAN_KEY,
      p_org_id: orgA,
    });

    expect(error).toBeNull();
    expect(await orgPlan(orgA)).toBe(PLAN_KEY);
    expect(await assignedRows()).toBe(1);
  });

  it('is idempotent: a second assign keeps one pin and the same plan', async () => {
    const { error } = await service.rpc('assign_plan_to_org', {
      p_plan_key: PLAN_KEY,
      p_org_id: orgA,
    });

    expect(error).toBeNull();
    expect(await orgPlan(orgA)).toBe(PLAN_KEY);
    expect(await assignedRows()).toBe(1);
  });

  it('accepts change_org_plan for the assigned organization', async () => {
    // The later moves still go through `change_org_plan`, which now passes the
    // assignment guard.
    const { error } = await service.rpc('change_org_plan', { p_org_id: orgA, p_plan: PLAN_KEY });

    expect(error).toBeNull();
    expect(await orgPlan(orgA)).toBe(PLAN_KEY);
  });

  it('refuses to unpin an organization that is on the plan', async () => {
    const { error } = await service
      .from('plan_assignments')
      .delete()
      .eq('plan_key', PLAN_KEY)
      .eq('organization_id', orgA);

    expect(error?.code).toBe('23503');
    expect(error?.message).toContain(PLAN_KEY);

    const { data: rows, error: readError } = await service
      .from('plan_assignments')
      .select('plan_key')
      .eq('plan_key', PLAN_KEY);
    expect(readError).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('refuses to delete a plan that an assignment still references', async () => {
    const { error } = await service.from('subscription_plans').delete().eq('key', PLAN_KEY);

    expect(error?.code).toBe('23503');
  });

  it('is unreadable to anon and to a signed-in caller, readable with the service role', async () => {
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonRead = await anon.from('plan_assignments').select('plan_key').limit(1);
    expect(anonRead.error?.code).toBe('42501');

    const user = await createTestUser({ role: 'student', password: PASSWORD });
    const session = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await session.auth.signInWithPassword({
      email: user.email,
      password: PASSWORD,
    });
    expect(signInError).toBeNull();

    const signedInRead = await session.from('plan_assignments').select('plan_key').limit(1);
    expect(signedInRead.error?.code).toBe('42501');

    const serviceRead = await service.from('plan_assignments').select('plan_key').limit(1);
    expect(serviceRead.error).toBeNull();
  });

  it('unpins and deletes once the organization is off the plan', async () => {
    const { error: moveError } = await service.rpc('change_org_plan', {
      p_org_id: orgA,
      p_plan: 'launch',
    });
    expect(moveError).toBeNull();

    const { error: unpinError } = await service
      .from('plan_assignments')
      .delete()
      .eq('plan_key', PLAN_KEY)
      .eq('organization_id', orgA);
    expect(unpinError).toBeNull();

    const { error: deleteError } = await service
      .from('subscription_plans')
      .delete()
      .eq('key', PLAN_KEY);
    expect(deleteError).toBeNull();
  });
});
