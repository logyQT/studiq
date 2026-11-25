import { ENTITLEMENTS, isEntitlementKey } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { SubscriptionPlanService } from '@studiq/server/services/subscription-plan.service';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #1484: the public pricing read advertises what a buyer receives. It drops a
// key the TS catalog does not know and a surface key whose kill switch is off
// (the resolver's D8/D9 rule). This file asserts that invariant against the
// real catalogue.
//
// Read-only by design. `catalog-invariants` and `plan-catalog` assert the
// database catalogue exactly and run in a parallel file, so a temporary rogue
// row here would be a cross-file race. The repo recorded that hazard twice and
// chose the other route: `entitlement-deploy-order.test.ts:27-31` does not
// write `entitlement_catalog`, and `plan-catalog.test.ts:405-412` replays its
// migration inside a rolled-back transaction instead of deleting rows. The
// negative cell (rogue row present → absent from the list) is pinned by
// `__tests__/unit/services/subscription-plan.service.test.ts` and by served QA;
// a shared-catalogue write cannot pin it here without racing those files. That
// is the repo's recorded rule, not an omission.

type FlagStates = ReadonlyMap<string, boolean | null>;

function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return [...a].toSorted().join('\u0000') === [...b].toSorted().join('\u0000');
}

function advertisedKeys(plans: ReadonlyArray<{ features: string[] }>): string[] {
  return plans.flatMap((plan) => plan.features);
}

describe('public pricing read (#1484)', () => {
  let admin: SupabaseClient<Database>;
  let service: SubscriptionPlanService;

  async function readPlanRows(): Promise<Map<string, string[]>> {
    const { data, error } = await admin
      .from('plan_entitlements')
      .select('plan_key, entitlement_key');
    if (error) throw new Error(`[pricing] plan_entitlements read failed: ${error.message}`);

    const rowsByPlan = new Map<string, string[]>();
    for (const row of dbRows(data)) {
      const keys = rowsByPlan.get(row.plan_key) ?? [];
      keys.push(row.entitlement_key);
      rowsByPlan.set(row.plan_key, keys);
    }
    return rowsByPlan;
  }

  async function readFlagStates(): Promise<FlagStates> {
    const { data, error } = await admin.from('entitlement_flags').select('key, is_enabled');
    if (error) throw new Error(`[pricing] entitlement_flags read failed: ${error.message}`);
    return new Map(dbRows(data).map((row) => [row.key, row.is_enabled]));
  }

  beforeAll(() => {
    admin = createServiceClient();
    service = new SubscriptionPlanService(() => Promise.resolve(admin));
  });

  it('advertises no key the TS catalog does not know', async () => {
    const plans = expectSuccess(await service.listActive());

    expect(advertisedKeys(plans).filter((key) => !isEntitlementKey(key))).toEqual([]);
  });

  it('advertises a surface key only when its flag row is enabled', async () => {
    const plans = expectSuccess(await service.listActive());
    const flags = await readFlagStates();

    const advertisedSurface = advertisedKeys(plans).filter(
      (key) => isEntitlementKey(key) && ENTITLEMENTS[key].category === 'surface',
    );

    // A missing flag row fails closed, so only an explicit `true` may advertise.
    expect(advertisedSurface.filter((key) => flags.get(key) !== true)).toEqual([]);
  });

  it('advertises exactly the plan rows the catalog and the flags allow', async () => {
    // Snapshot the rows on both sides of the read. Another integration file
    // creates a temporary active plan (`seats.test.ts`), so a plan whose rows
    // move while this test runs has no single expected set. Every plan that
    // stayed put is still checked, and at least one must be.
    const rowsBefore = await readPlanRows();
    const flagsBefore = await readFlagStates();
    const plans = expectSuccess(await service.listActive());
    const rowsAfter = await readPlanRows();
    const flagsAfter = await readFlagStates();

    let checked = 0;
    for (const plan of plans) {
      const before = rowsBefore.get(plan.key) ?? [];
      const after = rowsAfter.get(plan.key) ?? [];
      const flagsStable = after.every((key) => flagsBefore.get(key) === flagsAfter.get(key));
      if (!sameKeys(before, after) || !flagsStable) continue;
      checked += 1;

      const expected = after
        .filter(
          (key) =>
            isEntitlementKey(key) &&
            (ENTITLEMENTS[key].category !== 'surface' || flagsAfter.get(key) === true),
        )
        .toSorted();

      expect(plan.features.toSorted(), plan.key).toEqual(expected);
    }

    expect(checked, 'at least one advertised plan had a stable row set').toBeGreaterThan(0);
  });
});
