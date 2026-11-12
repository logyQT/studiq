import {
  EntitlementService,
  type EntitlementOwner,
} from '@studiq/server/services/entitlement.service';
import { readColumn } from '@studiq/server/lib/record';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asJson } from '#test/helpers/json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePlanRow {
  key: string;
  for_account_type: string | null;
  price_monthly: number;
  is_active: boolean;
  sort_order: number;
}

interface FakeAdminOptions {
  plans?: FakePlanRow[];
  rpcError?: { code: string; message: string } | null;
  rpcData?: unknown;
  updateError?: { code: string; message: string } | null;
  selectError?: { code: string; message: string } | null;
}

/**
 * Minimal Supabase stand-in for the two shapes `EntitlementService` uses:
 *
 * - `from('profiles').update(values).eq(column, value)` (a thenable);
 * - `from('subscription_plans').select(...).eq(...).order(...)` with either
 *   `.maybeSingle()` or a direct `await`.
 */
function createFakeAdmin(options: FakeAdminOptions = {}) {
  const plans = options.plans ?? [];
  const updates: Array<{
    table: string;
    values: Record<string, unknown>;
    column: string;
    value: unknown;
  }> = [];
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: options.rpcData ?? null, error: options.rpcError ?? null });

  const planQuery = () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        if (options.selectError) return { data: null, error: options.selectError };
        return { data: plans.find((plan) => plan.key === filters.key) ?? null, error: null };
      },
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
        const rows = plans.filter((plan) =>
          Object.entries(filters).every(([key, value]) => readColumn(plan, key) === value),
        );
        return Promise.resolve({ data: rows, error: options.selectError ?? null }).then(resolve);
      },
    };
    return chain;
  };

  const admin = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: (column: string, value: unknown) => {
              updates.push({ table, values, column, value });
              return { error: options.updateError ?? null };
            },
          }),
        };
      }
      return planQuery();
    }),
  };

  return { admin: asJson<SupabaseClient<Database>>(admin), updates, rpc };
}

const PLANS: FakePlanRow[] = [
  { key: 'base', for_account_type: 'student', price_monthly: 0, is_active: true, sort_order: 1 },
  { key: 'lite', for_account_type: 'educator', price_monthly: 0, is_active: true, sort_order: 2 },
  { key: 'launch', for_account_type: 'manager', price_monthly: 0, is_active: true, sort_order: 3 },
  { key: 'spark', for_account_type: 'student', price_monthly: 999, is_active: true, sort_order: 4 },
  {
    key: 'guide',
    for_account_type: 'educator',
    price_monthly: 1999,
    is_active: true,
    sort_order: 5,
  },
  { key: 'hub', for_account_type: 'manager', price_monthly: 9999, is_active: true, sort_order: 6 },
];

const USER: EntitlementOwner = { type: 'user', userId: 'u-1' };
const ORG: EntitlementOwner = { type: 'org', orgId: 'org-1' };

describe('EntitlementService', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes an organization plan only through apply_org_plan', async () => {
    const { admin, updates, rpc } = createFakeAdmin({ plans: PLANS });
    const service = new EntitlementService(() => admin);

    await expect(service.applyPlan(ORG, 'hub')).resolves.toEqual({
      success: true,
      data: undefined,
    });

    expect(rpc).toHaveBeenCalledWith('apply_org_plan', { p_org_id: 'org-1', p_plan: 'hub' });
    expect(updates).toHaveLength(0);
  });

  it('writes a personal plan to profiles.personal_plan_key', async () => {
    const { admin, updates } = createFakeAdmin({ plans: PLANS });
    const service = new EntitlementService(() => admin);

    await expect(service.applyPlan(USER, 'spark')).resolves.toMatchObject({ success: true });
    expect(updates).toEqual([
      {
        table: 'profiles',
        values: { personal_plan_key: 'spark' },
        column: 'id',
        value: 'u-1',
      },
    ]);
  });

  it('rejects an organization plan written to a profile (ADR-0007)', async () => {
    const { admin, updates, rpc } = createFakeAdmin({ plans: PLANS });
    const service = new EntitlementService(() => admin);

    await expect(service.applyPlan(USER, 'hub')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });

    expect(updates).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('billing.manager_plan_to_profile'),
    );
  });

  it('rejects an unknown plan instead of writing it', async () => {
    const { admin, updates } = createFakeAdmin({ plans: PLANS });
    const service = new EntitlementService(() => admin);

    await expect(service.applyPlan(USER, 'does-not-exist')).resolves.toEqual({
      success: false,
      error: 'BAD_REQUEST',
    });
    expect(updates).toHaveLength(0);
  });

  describe('downgradeToFree', () => {
    it.each([
      ['spark', 'base'],
      ['guide', 'lite'],
    ])('downgrades a %s personal plan to the %s free tier', async (previous, expected) => {
      const { admin, updates } = createFakeAdmin({ plans: PLANS });
      const service = new EntitlementService(() => admin);

      await expect(service.downgradeToFree(USER, previous)).resolves.toMatchObject({
        success: true,
      });
      expect(updates).toHaveLength(1);
      expect(updates[0]?.values).toEqual({ personal_plan_key: expected });
    });

    it('downgrades an organization to launch via apply_org_plan', async () => {
      const { admin, rpc } = createFakeAdmin({ plans: PLANS });
      const service = new EntitlementService(() => admin);

      await expect(service.downgradeToFree(ORG, 'hub')).resolves.toMatchObject({
        success: true,
      });
      expect(rpc).toHaveBeenCalledWith('apply_org_plan', {
        p_org_id: 'org-1',
        p_plan: 'launch',
      });
    });

    it('falls back to the account family when the previous plan is gone', async () => {
      const { admin, updates } = createFakeAdmin({ plans: PLANS });
      const service = new EntitlementService(() => admin);

      await expect(service.downgradeToFree(USER, 'retired-plan')).resolves.toMatchObject({
        success: true,
      });
      expect(updates[0]?.values).toEqual({ personal_plan_key: 'base' });
    });

    it('fails closed when no free plan exists for the family', async () => {
      const { admin, updates } = createFakeAdmin({
        plans: PLANS.filter((plan) => plan.key !== 'launch'),
      });
      const service = new EntitlementService(() => admin);

      await expect(service.downgradeToFree(ORG, 'hub')).resolves.toEqual({
        success: false,
        error: 'NOT_FOUND',
      });
      expect(updates).toHaveLength(0);
    });
  });

  describe('applyPlanFenced', () => {
    const fence = {
      stripeSubscriptionId: 'sub_1',
      eventCreated: 1_700_000_700,
      snapshotGeneration: 3,
    };

    it('writes an organization plan through the database fence', async () => {
      const { admin, rpc, updates } = createFakeAdmin({ plans: PLANS, rpcData: true });
      const service = new EntitlementService(() => admin);

      await expect(service.applyPlanFenced(ORG, 'hub', fence)).resolves.toEqual({
        success: true,
        data: 'applied',
      });
      expect(rpc).toHaveBeenCalledWith('apply_entitlement_fenced', {
        p_owner_type: 'org',
        p_owner_id: 'org-1',
        p_plan: 'hub',
        p_subscription_id: 'sub_1',
        p_event_created: 1_700_000_700,
        p_snapshot_generation: 3,
      });
      expect(updates).toHaveLength(0);
    });

    it('writes a personal plan through the database fence', async () => {
      const { admin, rpc } = createFakeAdmin({ plans: PLANS, rpcData: true });
      const service = new EntitlementService(() => admin);

      await expect(service.applyPlanFenced(USER, 'spark', fence)).resolves.toEqual({
        success: true,
        data: 'applied',
      });
      expect(rpc).toHaveBeenCalledWith('apply_entitlement_fenced', {
        p_owner_type: 'user',
        p_owner_id: 'u-1',
        p_plan: 'spark',
        p_subscription_id: 'sub_1',
        p_event_created: 1_700_000_700,
        p_snapshot_generation: 3,
      });
    });

    it('reports stale when the mirror has a newer event', async () => {
      const { admin } = createFakeAdmin({ plans: PLANS, rpcData: false });
      const service = new EntitlementService(() => admin);

      await expect(service.applyPlanFenced(USER, 'spark', fence)).resolves.toEqual({
        success: true,
        data: 'stale',
      });
    });

    it('rejects a manager plan before calling the fence (ADR-0007)', async () => {
      const { admin, rpc } = createFakeAdmin({ plans: PLANS, rpcData: true });
      const service = new EntitlementService(() => admin);

      await expect(service.applyPlanFenced(USER, 'hub', fence)).resolves.toEqual({
        success: false,
        error: 'FORBIDDEN',
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('downgrades through the same fence', async () => {
      const { admin, rpc } = createFakeAdmin({ plans: PLANS, rpcData: true });
      const service = new EntitlementService(() => admin);

      await expect(service.downgradeToFreeFenced(USER, 'spark', fence)).resolves.toEqual({
        success: true,
        data: 'applied',
      });
      expect(rpc).toHaveBeenCalledWith('apply_entitlement_fenced', {
        p_owner_type: 'user',
        p_owner_id: 'u-1',
        p_plan: 'base',
        p_subscription_id: 'sub_1',
        p_event_created: 1_700_000_700,
        p_snapshot_generation: 3,
      });
    });

    it('maps a fence RPC failure onto the service result', async () => {
      const { admin } = createFakeAdmin({
        plans: PLANS,
        rpcError: { code: '42501', message: 'permission denied' },
      });
      const service = new EntitlementService(() => admin);

      await expect(service.applyPlanFenced(ORG, 'hub', fence)).resolves.toEqual({
        success: false,
        error: 'FORBIDDEN',
      });
    });
  });

  it('maps a database failure onto the service result', async () => {
    const { admin } = createFakeAdmin({
      plans: PLANS,
      rpcError: { code: '42501', message: 'permission denied' },
    });
    const service = new EntitlementService(() => admin);

    await expect(service.applyPlan(ORG, 'hub')).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
  });
});
