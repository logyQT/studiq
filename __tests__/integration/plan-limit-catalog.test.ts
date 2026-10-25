import { isLimitKey, ORG_LIMIT_KEYS, USER_LIMIT_KEYS } from '@studiq/server/services/limit.catalog';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// Issue #233 (Q2): a missing `plan_limits` row is `0` (blocked) in every path,
// so a gap in the seed would silently disable a plan. These tests make the gap
// loud: every active plan must define every catalog key its audience uses, and
// the DB may not contain keys the resolver ignores.
interface PlanRow {
  key: string;
  for_account_type: string;
}

interface PlanLimitRow {
  plan_key: string;
  limit_key: string;
}

describe('plan limit catalog (#233)', () => {
  let service: SupabaseClient;
  let activePlans: PlanRow[];
  let planLimits: PlanLimitRow[];

  beforeAll(async () => {
    service = createServiceClient();

    const { data: plans, error: plansError } = await service
      .from('subscription_plans')
      .select('key, for_account_type')
      .eq('is_active', true);
    if (plansError) throw new Error(`[catalog] plan lookup failed: ${plansError.message}`);
    activePlans = plans ?? [];

    const { data: limits, error: limitsError } = await service
      .from('plan_limits')
      .select('plan_key, limit_key');
    if (limitsError) throw new Error(`[catalog] plan_limits lookup failed: ${limitsError.message}`);
    planLimits = limits ?? [];
  });

  function keysFor(planKey: string): Set<string> {
    return new Set(
      planLimits.filter((row) => row.plan_key === planKey).map((row) => row.limit_key),
    );
  }

  it('every active plan defines every per-member limit key', () => {
    const missing = activePlans.flatMap((plan) => {
      const keys = keysFor(plan.key);
      return USER_LIMIT_KEYS.filter((key) => !keys.has(key)).map((key) => `${plan.key}.${key}`);
    });

    expect(missing).toEqual([]);
  });

  it('every active manager plan defines every org-scope limit key', () => {
    const managerPlans = activePlans.filter((plan) => plan.for_account_type === 'manager');
    expect(managerPlans.length).toBeGreaterThan(0);

    const missing = managerPlans.flatMap((plan) => {
      const keys = keysFor(plan.key);
      return ORG_LIMIT_KEYS.filter((key) => !keys.has(key)).map((key) => `${plan.key}.${key}`);
    });

    expect(missing).toEqual([]);
  });

  it('stores no limit key outside the catalog', () => {
    const unknown = planLimits
      .filter((row) => !isLimitKey(row.limit_key))
      .map((row) => `${row.plan_key}.${row.limit_key}`);

    expect(unknown).toEqual([]);
  });
});
