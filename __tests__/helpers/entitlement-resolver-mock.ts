import { ENTITLEMENT_KEYS, type LimitKey, LIMIT_KEYS } from '@studiq/authz';
import type { MockSupabaseClient } from '#test/helpers/supabase-mock';
import { vi } from 'vitest';

/**
 * Shared mock for `EntitlementResolver` unit tests: one chain per table, shaped
 * the way the resolver queries it after phase 3b (the org layer and the seat
 * pool ride FK embeds on the `org_members` / `org_seat_assignments` rows, and
 * the catalogs are read batched with `.in('plan_key', …)`).
 */

export function chain(result: unknown) {
  // `in(column, values)` filters the seeded rows, so a read that drops a layer
  // key from its `plan_key` list loses that layer's rows instead of silently
  // resolving from the full catalog.
  let data = result;
  const resolved = () => ({ data, error: null });
  const terminal = vi.fn(() => Promise.resolve(resolved()));
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn((column: string, values: readonly unknown[]) => {
    if (Array.isArray(data)) {
      // `Array.isArray` narrows an `unknown` seed to `any[]`; re-typing it as
      // `unknown[]` keeps each row a checked value rather than an `any`.
      const rows: readonly unknown[] = data;
      data = rows.filter(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          values.includes(Object.getOwnPropertyDescriptor(row, column)?.value),
      );
    }
    return c;
  });
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: (value: unknown) => unknown) =>
    Promise.resolve(resolved()).then(onfulfilled);
  return c;
}

export type FlagRow = { key: string; is_enabled: boolean };

export function allFlagsOn(keys: readonly string[] = ENTITLEMENT_KEYS): FlagRow[] {
  return keys.map((key) => ({ key, is_enabled: true }));
}

/** Plan → entitlement keys, the default catalog the tests resolve against. */
const DEFAULT_PLAN_ENTITLEMENTS: Record<string, readonly string[]> = {
  base: ['flashcards', 'quiz'],
  ace: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
  pro: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
  hub: ['flashcards', 'quiz', 'ai.chat', 'quiz.builder', 'advanced.stats', 'branding'],
  launch: ['flashcards', 'quiz'],
  campus: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
  solo: ['flashcards', 'quiz'],
  seat: ['ai.chat', 'advanced.stats', 'quiz.builder'],
};

/** Plan → scope, as the `subscription_plans(scope)` embed reports it (phase 4a). */
const DEFAULT_PLAN_SCOPES: Record<string, string> = {
  base: 'personal',
  ace: 'personal',
  pro: 'personal',
  solo: 'personal',
  hub: 'organization',
  launch: 'organization',
  campus: 'organization',
  seat: 'personal',
};

/** Unlimited by default so the quota-0 filter passes; override per test. */
const DEFAULT_PLAN_LIMITS: Record<string, Record<string, number>> = Object.fromEntries(
  Object.keys(DEFAULT_PLAN_ENTITLEMENTS).map((plan) => [
    plan,
    Object.fromEntries(LIMIT_KEYS.map((key) => [key, -1])),
  ]),
);

export interface ResolverTablesOpts {
  /** `false` simulates a forged `active_org_id` (no `org_members` row). */
  member?: boolean;
  orgPlan?: string | null;
  roleProfile?: string | null;
  roleRows?: Array<{ feature_key: string; is_enabled?: boolean }>;
  seatPlanKey?: string | null;
  personalPlanKey?: string | null;
  planEntitlements?: Record<string, readonly string[]>;
  planScopes?: Record<string, string>;
  planLimits?: Record<string, Partial<Record<LimitKey, number>>>;
  overrides?: Array<{ feature_key: string; is_enabled: boolean; expires_at?: string | null }>;
  flags?: FlagRow[];
}

/** Wires `mock.from` to the resolver's post-3b query shapes. */
export function mockResolverTables(mock: MockSupabaseClient, opts: ResolverTablesOpts = {}): void {
  const planEntitlements = opts.planEntitlements ?? DEFAULT_PLAN_ENTITLEMENTS;
  const planScopes = { ...DEFAULT_PLAN_SCOPES, ...opts.planScopes };
  const planLimits = opts.planLimits ?? DEFAULT_PLAN_LIMITS;

  mock.from.mockImplementation((table: string) => {
    if (table === 'org_members') {
      if (opts.member === false) return chain(null);
      return chain({
        organization_id: 'org-1',
        organizations: { plan: opts.orgPlan ?? null },
        org_roles:
          opts.roleProfile == null
            ? null
            : {
                entitlement_profile: opts.roleProfile,
                org_role_features: opts.roleRows ?? [],
              },
      });
    }
    if (table === 'org_seat_assignments') {
      return chain(
        opts.seatPlanKey
          ? { pool_id: 'pool-1', org_seat_pools: { plan_key: opts.seatPlanKey } }
          : null,
      );
    }
    if (table === 'profiles') return chain({ personal_plan_key: opts.personalPlanKey ?? null });
    if (table === 'plan_entitlements') {
      return chain(
        Object.entries(planEntitlements).flatMap(([plan_key, keys]) =>
          keys.map((entitlement_key) => ({
            plan_key,
            entitlement_key,
            subscription_plans: { scope: planScopes[plan_key] ?? 'personal' },
          })),
        ),
      );
    }
    if (table === 'plan_limits') {
      return chain(
        Object.entries(planLimits).flatMap(([plan_key, limits]) =>
          Object.entries(limits).map(([limit_key, limit_value]) => ({
            plan_key,
            limit_key,
            limit_value,
          })),
        ),
      );
    }
    if (table === 'user_feature_overrides') return chain(opts.overrides ?? []);
    if (table === 'entitlement_flags') return chain(opts.flags ?? allFlagsOn());
    return chain(null);
  });
}
