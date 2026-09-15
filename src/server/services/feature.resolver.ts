import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { getSeatPlanKey } from '@/server/services/seat.plan';
import { AccountType } from '@/types';

// Canonical flat feature keys — the single source of truth for both the
// application AND the database. `feature_flags`, `plan_features`,
// `org_role_features` and `user_feature_overrides` all store these exact
// keys (no legacy snake_case aliases, no mapping layer).
export const FEATURES = [
  'ai.chat',
  'flashcards',
  'quiz',
  'quiz.builder',
  'documents',
  'org.manage',
  'group.manage',
  'member.manage',
  'role.builder',
  'advanced.stats',
] as const;
export type FeatureKey = (typeof FEATURES)[number];

const FEATURE_KEY_SET: ReadonlySet<string> = new Set<string>(FEATURES);

export function isFeatureKey(key: string): key is FeatureKey {
  return FEATURE_KEY_SET.has(key);
}

export interface FeatureResolution {
  /** Enabled feature keys, ordered by `FEATURES`. */
  features: FeatureKey[];
  /**
   * `X-Feature-Rollout` payload: the rollout percentage that was actually
   * applied for each enabled feature currently gated by a live rollout
   * (i.e. `rollout_percentage < 100`). Clients can expose this to users
   * (e.g. "you're in the 25% pilot of ai.chat").
   */
  rollout: Partial<Record<FeatureKey, number>>;
}

/**
 * Deterministic per-(key, user) rollout bucket in `0..99`. Stable across
 * requests (FNV-1a over `${key}:${userId}`), so a given user either always
 * sees a partially-rolled-out feature or never does — no flapping.
 */
export function rolloutBucket(userId: string, key: FeatureKey): number {
  let hash = 0x811c9dc5;
  const input = `${key}:${userId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash % 100;
}

type FeatureRow = { feature_key: string; is_enabled?: boolean };

export class FeatureResolver {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  /**
   * Resolve the feature set with the full precedence chain:
   *
   *   1. Plan entitlement  — seat plan (seated in org) → org role features
   *      (the role's plan-seeded entitlement; authoritative when present) →
   *      personal plan (no org context / nothing org-derived).
   *   2. Org role override — `org_role_features` rows for the user's role
   *      win over the underlying plan for that key.
   *   3. User override    — `user_feature_overrides` rows are the strongest
   *      layer: add/remove anything.
   *   4. Rollout %        — `feature_flags.rollout_percentage < 100` gates
   *      deterministically per (key, user_id).
   *   5. Global flag      — `feature_flags.is_enabled = false` is a hard
   *      kill switch ("Stop now") regardless of any entitlement layer.
   *
   * `SYS_ADMIN` is always granted the full `FEATURES` set.
   */
  async resolveFeatures(ctx: RequestContext): Promise<FeatureResolution> {
    if (ctx.accountType === AccountType.SYS_ADMIN) {
      return { features: Array.from(FEATURES), rollout: {} };
    }

    const supabase = await this.createClient();
    const enabled = new Set<FeatureKey>();

    // ── 1. Plan entitlement (base set) ───────────────────────────────────
    if (ctx.activeOrgId) {
      const seatPlanKey = await getSeatPlanKey(ctx, supabase);

      if (seatPlanKey) {
        // Seated user: seat plan entitles the feature set.
        await this.addPlanFeatures(enabled, seatPlanKey, supabase);
      } else if (ctx.orgRoleId) {
        // Not seated: the org role's features are the entitlement. Rows are
        // seeded by the org trigger from the org's plan with role filtering,
        // so this layer encodes plan gating AND role restrictions. When a
        // role has rows they are authoritative (missing keys = disabled).
        const { data: roleFeatures } = await supabase
          .from('org_role_features')
          .select('feature_key, is_enabled')
          .eq('org_role_id', ctx.orgRoleId);

        if (roleFeatures && roleFeatures.length > 0) {
          this.applyRows(enabled, roleFeatures);
        }
      }
    }

    // Personal plan fallback (no org, or nothing derived in org context).
    if (enabled.size === 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('personal_plan_key')
        .eq('id', ctx.userId)
        .maybeSingle();

      if (profile?.personal_plan_key) {
        await this.addPlanFeatures(enabled, profile.personal_plan_key, supabase);
      }
    }

    // ── 2 + 3. User overrides (strongest layer) ─────────────────────────
    const { data: overrides } = await supabase
      .from('user_feature_overrides')
      .select('feature_key, is_enabled')
      .eq('user_id', ctx.userId);

    this.applyRows(enabled, overrides ?? []);

    // ── 4 + 5. Rollout % + global flag gate ──────────────────────────────
    const { data: flags } = await supabase
      .from('feature_flags')
      .select('key, is_enabled, rollout_percentage');

    const flagMap = new Map<string, { is_enabled: boolean; rollout_percentage: number | null }>(
      (flags ?? []).map((f) => [f.key, f]),
    );
    const rollout: FeatureResolution['rollout'] = {};

    for (const key of Array.from(enabled)) {
      const flag = flagMap.get(key);
      // Missing catalog row → no gate (lenient default; seeds always create one).
      if (!flag) continue;
      if (!flag.is_enabled) {
        enabled.delete(key);
        continue;
      }
      const pct = flag.rollout_percentage ?? 100;
      if (pct < 100) {
        if (rolloutBucket(ctx.userId, key) >= pct) {
          enabled.delete(key);
        } else {
          rollout[key] = pct;
        }
      }
    }

    return { features: FEATURES.filter((k) => enabled.has(k)), rollout };
  }

  async getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
    const { features } = await this.resolveFeatures(ctx);
    return features;
  }

  async requireFeature(
    ctx: RequestContext,
    key: FeatureKey,
  ): Promise<ServiceResult<void, 'FORBIDDEN'>> {
    const enabled = await this.getEnabledFeatures(ctx);
    if (!enabled.includes(key)) {
      return failure('FORBIDDEN');
    }
    return success(undefined);
  }

  private async addPlanFeatures(
    enabled: Set<FeatureKey>,
    planKey: string,
    supabase: SupabaseClient,
  ): Promise<void> {
    const { data: pf } = await supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_key', planKey);

    this.applyRows(enabled, pf ?? []);
  }

  private applyRows(enabled: Set<FeatureKey>, rows: FeatureRow[]): void {
    for (const row of rows) {
      if (!isFeatureKey(row.feature_key)) continue;
      // Explicit `is_enabled: false` removes; true/undefined (plan_features
      // rows carry no is_enabled) adds.
      if (row.is_enabled === false) {
        enabled.delete(row.feature_key);
      } else {
        enabled.add(row.feature_key);
      }
    }
  }
}
