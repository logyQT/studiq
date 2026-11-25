import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { SubscriptionPlanService } from '@studiq/server/services/subscription-plan.service';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #1484: the public pricing read advertises what a buyer receives. It mirrors
// the resolver's flag gate (D8/D9) and drops a key the TS catalog does not
// know. Both halves need real rows to prove, and the catalogue tables are
// shared state: CI runs the integration suite with `--no-file-parallelism`
// (`verify.yml`), which is the mode this file requires.
//
// Every row this file writes is removed in a `finally` and the removal is
// asserted, so a failed assertion cannot leave the catalogue changed.

const ROGUE_KEY = 'voice.probe';
/** A plan and a surface key that plan already carries (`quiz.templates`). */
const SWITCH_PLAN = 'guide';
const SWITCH_KEY = 'quiz.templates';

function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

describe('public pricing read (#1484)', () => {
  let admin: SupabaseClient<Database>;
  let service: SubscriptionPlanService;

  async function rogueRowCounts(): Promise<number[]> {
    const results = await Promise.all([
      admin.from('entitlement_catalog').select('key').eq('key', ROGUE_KEY),
      admin.from('entitlement_flags').select('key').eq('key', ROGUE_KEY),
      admin.from('plan_entitlements').select('entitlement_key').eq('entitlement_key', ROGUE_KEY),
    ]);
    return results.map(({ data, error }) => {
      if (error) throw new Error(`rogue row count failed: ${error.message}`);
      return dbRows(data).length;
    });
  }

  async function deleteRogueRows(): Promise<void> {
    // Plan rows first: the flag FK cascades, so deleting the flag row would
    // take the plan row silently. The catalog row goes last (its FK has no
    // cascade, and it refuses a delete while a plan row still points at it).
    await admin.from('plan_entitlements').delete().eq('entitlement_key', ROGUE_KEY);
    await admin.from('entitlement_flags').delete().eq('key', ROGUE_KEY);
    await admin.from('entitlement_catalog').delete().eq('key', ROGUE_KEY);
  }

  async function insertRogueRows(): Promise<void> {
    const { error: catalogError } = await admin.from('entitlement_catalog').insert({
      key: ROGUE_KEY,
      category: 'surface',
      scope: 'personal',
      seat_eligible: true,
      personal_portable: true,
      quota_limit_key: null,
    });
    if (catalogError) throw new Error(`rogue catalog insert failed: ${catalogError.message}`);

    const { error: flagError } = await admin.from('entitlement_flags').insert({
      key: ROGUE_KEY,
      name: 'Pricing probe',
      description: 'Integration probe for #1484',
      is_enabled: true,
    });
    if (flagError) throw new Error(`rogue flag insert failed: ${flagError.message}`);

    const { error: planError } = await admin
      .from('plan_entitlements')
      .insert({ plan_key: 'hub', entitlement_key: ROGUE_KEY });
    if (planError) throw new Error(`rogue plan row insert failed: ${planError.message}`);
  }

  async function setFlag(key: string, isEnabled: boolean | null): Promise<void> {
    const { error } = await admin
      .from('entitlement_flags')
      .update({ is_enabled: isEnabled })
      .eq('key', key);
    if (error) throw new Error(`flag update failed: ${error.message}`);
  }

  beforeAll(async () => {
    admin = createServiceClient();
    service = new SubscriptionPlanService(() => Promise.resolve(admin));
    // A previous failed run must not decide this one.
    await deleteRogueRows();
  });

  afterAll(async () => {
    await deleteRogueRows();
  });

  it('drops a DB-ahead key: the catalog filter hides an enabled, planned row', async () => {
    const baseline = await rogueRowCounts();
    expect(baseline, 'the probe key starts absent from every table').toEqual([0, 0, 0]);

    try {
      await insertRogueRows();
      // Control: the row is planned and its flag is enabled, so only
      // `isEntitlementKey` can drop it.
      expect(await rogueRowCounts()).toEqual([1, 1, 1]);

      const plans = expectSuccess(await service.listActive());
      expect(plans.flatMap((plan) => plan.features)).not.toContain(ROGUE_KEY);
    } finally {
      await deleteRogueRows();
    }

    expect(await rogueRowCounts(), 'the probe rows are gone again').toEqual(baseline);
  });

  it('drops a kill-switched surface key, then shows it again after the restore', async () => {
    const { data: before, error } = await admin
      .from('entitlement_flags')
      .select('is_enabled')
      .eq('key', SWITCH_KEY)
      .single();
    if (error) throw new Error(`flag read failed: ${error.message}`);

    expect(
      expectSuccess(await service.listActive()).find((plan) => plan.key === SWITCH_PLAN)?.features,
      'the control: the key is advertised while the flag is on',
    ).toContain(SWITCH_KEY);

    try {
      await setFlag(SWITCH_KEY, false);

      const plans = expectSuccess(await service.listActive());
      expect(plans.flatMap((plan) => plan.features)).not.toContain(SWITCH_KEY);

      const detail = expectSuccess(await service.getByKey(SWITCH_PLAN));
      expect(detail.features).not.toContain(SWITCH_KEY);
    } finally {
      await setFlag(SWITCH_KEY, before.is_enabled);
    }

    const { data: after, error: afterError } = await admin
      .from('entitlement_flags')
      .select('is_enabled')
      .eq('key', SWITCH_KEY)
      .single();
    if (afterError) throw new Error(`flag read after restore failed: ${afterError.message}`);
    expect(after.is_enabled, 'the flag row is back to its baseline').toBe(before.is_enabled);

    expect(
      expectSuccess(await service.listActive()).find((plan) => plan.key === SWITCH_PLAN)?.features,
      'the restore brings the key back',
    ).toContain(SWITCH_KEY);
  });
});
