import { isLimitKey, ORG_LIMIT_KEYS, USER_LIMIT_KEYS } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// Issue #233 (Q2): a missing `plan_limits` row is `0` (blocked) in every path,
// so a gap in the seed would silently disable a plan. These tests make the gap
// loud: every active plan must define every catalog key its scope uses, and
// the DB may not contain keys the resolver ignores.
//
// One absence is deliberate: no organization plan carries
// `max_ai_tokens_per_day` since #1493. AI is an organization licence built in
// #1511, and a stale org quota would silently fund it, so the key is required
// on every personal plan and forbidden on every organization plan.
interface PlanRow {
  key: string;
  scope: string;
  sales_channels: string[];
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
      .select('key, scope, sales_channels')
      .eq('is_active', true);
    if (plansError) throw new Error(`[catalog] plan lookup failed: ${plansError.message}`);
    activePlans = dbRows(plans);

    const { data: limits, error: limitsError } = await service
      .from('plan_limits')
      .select('plan_key, limit_key');
    if (limitsError) throw new Error(`[catalog] plan_limits lookup failed: ${limitsError.message}`);
    planLimits = dbRows(limits);
  });

  function keysFor(planKey: string): Set<string> {
    return new Set(
      planLimits.filter((row) => row.plan_key === planKey).map((row) => row.limit_key),
    );
  }

  /**
   * A licence plan is a **partial** plan (D38, #1511): it sells `ai.chat` with
   * one quota row, and a missing row for any other key is a silent `0`, not a
   * gap in a full plan. Only a plan sold **exclusively** as a seat licence is
   * exempt: a `{individual, seat_pool}` plan is still sold individually, so it
   * must define every key it sells.
   */
  function isLicencePlan(plan: PlanRow): boolean {
    return (
      plan.scope === 'personal' &&
      plan.sales_channels.length > 0 &&
      plan.sales_channels.every((channel) => channel === 'seat_pool')
    );
  }

  /** The per-member limit keys `plan` is missing, licence exemption applied. */
  function missingLimitKeys(plan: PlanRow, keys: Set<string>): string[] {
    if (isLicencePlan(plan)) return [];
    const required = USER_LIMIT_KEYS.filter(
      (key) => !(plan.scope === 'organization' && key === 'max_ai_tokens_per_day'),
    );
    return required.filter((key) => !keys.has(key)).map((key) => `${plan.key}.${key}`);
  }

  it('every active plan defines every per-member limit key it sells', () => {
    const missing = activePlans.flatMap((plan) => missingLimitKeys(plan, keysFor(plan.key)));

    expect(missing).toEqual([]);
  });

  it('a both-channel plan is a full plan, not a licence (#233, #1511)', () => {
    const bothChannels: PlanRow = {
      key: 'both-channels',
      scope: 'personal',
      sales_channels: ['individual', 'seat_pool'],
    };
    const keys = new Set(['max_ai_tokens_per_day']);

    // Sold individually as well, so the missing keys are real gaps.
    expect(missingLimitKeys(bothChannels, keys)).toContain('both-channels.max_flashcards');

    // The seat_pool-only licence stays exempt: its one quota row is the sale.
    expect(missingLimitKeys({ ...bothChannels, sales_channels: ['seat_pool'] }, keys)).toEqual([]);
  });

  it('every licence plan defines the AI quota it sells (#1511)', () => {
    const licences = activePlans.filter(isLicencePlan);
    expect(licences.length).toBeGreaterThan(0);
    expect(
      licences
        .filter((plan) => !keysFor(plan.key).has('max_ai_tokens_per_day'))
        .map((plan) => plan.key),
    ).toEqual([]);
  });

  it('no active organization plan carries an AI quota (#1493 → #1511)', () => {
    const withQuota = activePlans
      .filter((plan) => plan.scope === 'organization')
      .filter((plan) => keysFor(plan.key).has('max_ai_tokens_per_day'))
      .map((plan) => plan.key);

    expect(withQuota).toEqual([]);
  });

  it('every active organization plan defines every org-scope limit key', () => {
    const organizationPlans = activePlans.filter((plan) => plan.scope === 'organization');
    expect(organizationPlans.length).toBeGreaterThan(0);

    const missing = organizationPlans.flatMap((plan) => {
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
