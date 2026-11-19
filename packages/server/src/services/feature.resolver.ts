import type {
  EntitlementKey,
  EntitlementProfile,
  EntitlementResolution,
  RequestContext,
} from '@studiq/authz';
import {
  ADMIN_ONLY_ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  isEntitlementProfile,
  LEARNER_ENTITLEMENTS,
  LEGACY_MANAGEMENT_ENTITLEMENTS,
  ORG_SCOPED_ENTITLEMENTS,
  rolloutBucket,
} from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { personalPlanApplies } from '@studiq/server/services/personal-plan';
import { getSeatPlanKey } from '@studiq/server/services/seat.plan';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * A user override only applies while it has no expiry or its expiry is still in
 * the future. `expires_at <= now` is expired (#382); such rows are kept in
 * `user_feature_overrides` as an audit trail and simply ignored when resolving.
 */
export function isUserOverrideActive(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return true; // no expiry → permanent override
  const expiresAtMs = Date.parse(expiresAt);
  // A `timestamptz` column can never produce an unparseable value; if one ever
  // appeared, keep applying the row rather than silently dropping an admin's
  // explicit grant/revoke.
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs > now;
}

type FeatureRow = { feature_key: string; is_enabled?: boolean; expires_at?: string | null };

/** A `plan_entitlements` row; `org_role_features` owns the `feature_key` name. */
type PlanEntitlementRow = { entitlement_key: string };

export class FeatureResolver {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  /**
   * Resolve the entitlement set with the documented precedence:
   *
   *   1. Role profile      — `org_roles.entitlement_profile` intersected with
   *      the org plan ceiling: `all` → ceiling minus the four legacy management
   *      markers, `learner` → `LEARNER_ENTITLEMENTS ∩ ceiling`, `none` → nothing.
   *      A member with no verified role (`orgRoleId: null`) resolves nothing.
   *   2. Legacy rows       — `org_role_features` is read only for the four
   *      management markers (an enabled row adds one) and for explicit
   *      `is_enabled = false` revokes (a row removes any key). The profile is
   *      authoritative for non-marker keys (D18/D19), so a Teacher's `all`
   *      profile cannot pick up `member.manage`/`role.builder` from a row.
   *   3. Seat plan         — additive on top, then the three admin-only markers
   *      stripped for a non-admin role.
   *   4. Personal plan     — additive, inside an org only for personal-use keys
   *      (a purchase must not escalate structure privileges).
   *   5. User override     — add/remove anything; expired rows are ignored.
   *   6. Rollout % + flag  — `entitlement_flags.rollout_percentage < 100` gates
   *      deterministically per (key, user_id); `is_enabled = false` is a hard
   *      kill switch.
   */
  async resolveFeatures(ctx: RequestContext): Promise<EntitlementResolution> {
    const supabase = await this.clientFactory();
    const enabled = new Set<EntitlementKey>();

    // ── 1 + 2 + 3. Org layer ─────────────────────────────────────────────
    if (ctx.activeOrgId && ctx.orgRoleId) {
      const { data: role } = await supabase
        .from('org_roles')
        .select('entitlement_profile')
        .eq('id', ctx.orgRoleId)
        .maybeSingle();

      const entitlementProfile: EntitlementProfile =
        role && isEntitlementProfile(role.entitlement_profile) ? role.entitlement_profile : 'none';

      const { data: roleFeatures } = await supabase
        .from('org_role_features')
        .select('feature_key, is_enabled')
        .eq('org_role_id', ctx.orgRoleId);

      const rows: FeatureRow[] = roleFeatures ?? [];

      // `org.manage` marks an org admin. Only they may hold the structure
      // privileges in ADMIN_ONLY_ENTITLEMENTS through a seat; everyone else gets
      // them stripped once the seat plan is applied. (The personal layer is
      // bounded separately by ORG_SCOPED_ENTITLEMENTS — see below.)
      const isOrgAdmin = rows.some((r) => r.feature_key === 'org.manage' && r.is_enabled !== false);

      // A `none` profile has no ceiling read at all: custom roles resolve
      // nothing by construction.
      if (entitlementProfile !== 'none') {
        const { data: org } = await supabase
          .from('organizations')
          .select('plan')
          .eq('id', ctx.activeOrgId)
          .maybeSingle();

        if (org?.plan) {
          this.applyProfile(
            enabled,
            entitlementProfile,
            await this.planEntitlements(org.plan, supabase),
          );
        }
      }

      // Legacy rows come after the profile so an explicit revoke wins over a
      // profile grant, exactly as the row first-semantics always did.
      this.applyRows(enabled, rows, 'markers');

      const seatPlanKey = await getSeatPlanKey(ctx, supabase);
      if (seatPlanKey) {
        await this.addPlanFeatures(enabled, seatPlanKey, supabase);
        this.stripAdminOnlyForNonAdmin(enabled, isOrgAdmin);
      }
    }

    // ── 4. Personal plan (additive) ──────────────────────────────────────
    // Deliberately not a fallback: an org on the free `launch` tier grants no
    // `ai.chat`, and that must not silently void a StudiQ Pro the member paid
    // for. The union keeps the role layer authoritative for what the org
    // bought, while the personal plan adds what the member bought.
    const { data: personalProfile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();

    if (personalProfile?.personal_plan_key && personalPlanApplies(ctx, Boolean(ctx.activeOrgId))) {
      // Snapshot what the org itself entitled, so the personal layer can only
      // add personal-use features inside an org.
      const orgEntitled = new Set(enabled);
      await this.addPlanFeatures(enabled, personalProfile.personal_plan_key, supabase);
      if (ctx.activeOrgId) {
        for (const key of ORG_SCOPED_ENTITLEMENTS) {
          if (!orgEntitled.has(key)) enabled.delete(key);
        }
      }
    }

    // ── 5. User overrides (strongest layer) ─────────────────────────────
    const { data: overrides } = await supabase
      .from('user_feature_overrides')
      .select('feature_key, is_enabled, expires_at')
      .eq('user_id', ctx.userId);

    // Expired rows (`expires_at <= now`) are kept as an audit trail but must not
    // grant or revoke anything (#382). One `now` for the whole batch keeps the
    // decision consistent across rows.
    const nowMs = Date.now();
    const activeOverrides = ((overrides ?? []) as FeatureRow[]).filter((row) =>
      isUserOverrideActive(row.expires_at, nowMs),
    );

    this.applyRows(enabled, activeOverrides, 'any');

    // ── 6. Rollout % + global flag gate ──────────────────────────────────
    const { data: flags } = await supabase
      .from('entitlement_flags')
      .select('key, is_enabled, rollout_percentage');

    const flagMap = new Map<
      string,
      { is_enabled: boolean | null; rollout_percentage: number | null }
    >((flags ?? []).map((f) => [f.key, f]));
    const rollout: EntitlementResolution['rollout'] = {};

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

    return { features: ENTITLEMENT_KEYS.filter((k) => enabled.has(k)), rollout };
  }

  async getEnabledFeatures(ctx: RequestContext): Promise<EntitlementKey[]> {
    const { features } = await this.resolveFeatures(ctx);
    return features;
  }

  async requireFeature(
    ctx: RequestContext,
    key: EntitlementKey,
  ): Promise<ServiceResult<void, 'FORBIDDEN'>> {
    const enabled = await this.getEnabledFeatures(ctx);
    if (!enabled.includes(key)) {
      return failure('FORBIDDEN');
    }
    return success(undefined);
  }

  /** `plan_entitlements` for one plan, as a set of catalog keys. */
  private async planEntitlements(
    planKey: string,
    supabase: SupabaseClient<Database>,
  ): Promise<Set<EntitlementKey>> {
    const { data } = await supabase
      .from('plan_entitlements')
      .select('entitlement_key')
      .eq('plan_key', planKey);

    const ceiling = new Set<EntitlementKey>();
    this.applyPlanRows(ceiling, data ?? []);
    return ceiling;
  }

  /**
   * The profile layer: `all` is the ceiling minus the four legacy management
   * markers, `learner` is the fixed member set. Both intersect the plan ceiling,
   * so a plan change narrows every role with no prune step.
   */
  private applyProfile(
    enabled: Set<EntitlementKey>,
    profile: Exclude<EntitlementProfile, 'none'>,
    ceiling: ReadonlySet<EntitlementKey>,
  ): void {
    const keys =
      profile === 'all'
        ? ENTITLEMENT_KEYS.filter((key) => !LEGACY_MANAGEMENT_ENTITLEMENTS.includes(key))
        : LEARNER_ENTITLEMENTS;

    for (const key of keys) {
      if (ceiling.has(key)) enabled.add(key);
    }
  }

  private async addPlanFeatures(
    enabled: Set<EntitlementKey>,
    planKey: string,
    supabase: SupabaseClient<Database>,
  ): Promise<void> {
    for (const key of await this.planEntitlements(planKey, supabase)) {
      enabled.add(key);
    }
  }

  /** Plan rows carry no `is_enabled`: presence in the plan is the grant. */
  private applyPlanRows(enabled: Set<EntitlementKey>, rows: PlanEntitlementRow[]): void {
    for (const row of rows) {
      if (isEntitlementKey(row.entitlement_key)) enabled.add(row.entitlement_key);
    }
  }

  /**
   * Applies `is_enabled` rows. A `false` row always revokes (a per-role revoke is
   * a role decision); what an enabled row may grant depends on the writer —
   * overrides may add anything, `org_role_features` only a management marker
   * until phase 3 removes that writer (D19).
   */
  private applyRows(
    enabled: Set<EntitlementKey>,
    rows: FeatureRow[],
    grant: 'any' | 'markers',
  ): void {
    for (const row of rows) {
      if (!isEntitlementKey(row.feature_key)) continue;
      // Explicit `is_enabled: false` removes; true/undefined adds.
      if (row.is_enabled === false) {
        enabled.delete(row.feature_key);
      } else if (grant === 'any' || LEGACY_MANAGEMENT_ENTITLEMENTS.includes(row.feature_key)) {
        enabled.add(row.feature_key);
      }
    }
  }

  /**
   * Structure privileges belong to the org admin role only. Applied after every
   * plan layer inside an org, so neither a seat nor a personal purchase can
   * escalate a non-admin role.
   */
  private stripAdminOnlyForNonAdmin(enabled: Set<EntitlementKey>, isOrgAdmin: boolean): void {
    if (isOrgAdmin) return;
    for (const key of ADMIN_ONLY_ENTITLEMENTS) {
      enabled.delete(key);
    }
  }
}
export const featureResolver = wrapService(
  new FeatureResolver(createClient),
  'feature-resolver.service',
);
