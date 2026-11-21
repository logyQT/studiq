import {
  ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  isEntitlementProfile,
  LEARNER_ENTITLEMENTS,
  LIMIT_KEYS,
  type EntitlementKey,
  type EntitlementProfile,
  type PlanSource,
  type RequestContext,
  type ResolvedEntitlements,
} from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { createClient } from '@studiq/server/lib/supabase/server';
import { isOrgMember } from '@studiq/server/services/org-membership';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
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

type OverrideRow = { feature_key: string; is_enabled?: boolean | null; expires_at?: string | null };

/** A `plan_entitlements` row; `org_role_features` owns the `feature_key` name. */
type PlanEntitlementRow = { entitlement_key: string };

/** The limits half of the resolution; 3b replaces this with the in-resolver composition. */
export type EntitlementLimitsSource = Pick<LimitsResolver, 'getEffectiveLimit'>;

/**
 * The single entitlement resolver (ADR-0015 §6.1, phase 3a). It is the only
 * reader of `plan_entitlements`, `org_role_features` (revoke-only, D19),
 * `org_roles.entitlement_profile`, `entitlement_flags`, `user_feature_overrides`,
 * `org_seat_*`, `organizations.plan` and `profiles.personal_plan_key`.
 *
 * Resolution order (§6.1):
 *
 *   1. Verified membership — `active_org_id` is a cookie hint; only a real
 *      `org_members` row makes it an org context.
 *   2. Role profile — `all` = the org plan ceiling, `learner` =
 *      `LEARNER_ENTITLEMENTS ∩ ceiling`, `none` = ∅; no role = ∅ and no plan
 *      read.
 *   3. Revoke rows — `org_role_features` `is_enabled = false` only (D19).
 *   4. Seat plan — `planEntitlements(seat.plan) ∩ ceiling`.
 *   5. Personal plan — outside an org, all its keys; inside an org only the
 *      `personalPortable` whitelist (D3).
 *   6. User overrides — an active row is the final word on its key in both
 *      directions (D26); expired rows are ignored (#382).
 *   7. Flags — surface keys only: a missing row or `is_enabled = false`
 *      removes the key (fail closed, D8); baseline keys are never gated (D9);
 *      keys an active override owns are skipped (D26).
 *   8. Quota-0 exclusion — an entitlement whose quota limit resolves to `0` is
 *      not effective, so the API and the UI agree (§6.1).
 *
 * The result is ordered by `ENTITLEMENT_KEYS`.
 */
export class EntitlementResolver {
  /**
   * Per-request memo, keyed on the `RequestContext` object. `withAuth` builds
   * exactly one ctx per request and hands the same object to every controller
   * and service, so one resolution serves `requireFeature` + limit checks in
   * the same request. A `WeakMap` (not a field on ctx) needs no change to the
   * shared `RequestContext` type, cannot leak into ctx serialization or logs,
   * and dies with the request's ctx — no cross-request cache exists in
   * phase 3. The promise is cached, so concurrent callers share one
   * resolution; a rejected promise is dropped from the map so a later call in
   * the same request can retry.
   */
  private readonly memo = new WeakMap<RequestContext, Promise<ResolvedEntitlements>>();

  constructor(
    private clientFactory: () => Promise<SupabaseClient<Database>>,
    private limits: EntitlementLimitsSource = new LimitsResolver(clientFactory),
  ) {}

  resolveEntitlements(ctx: RequestContext): Promise<ResolvedEntitlements> {
    const cached = this.memo.get(ctx);
    if (cached) return cached;
    const pending = this.resolve(ctx);
    this.memo.set(ctx, pending);
    pending.catch(() => this.memo.delete(ctx));
    return pending;
  }

  private async resolve(ctx: RequestContext): Promise<ResolvedEntitlements> {
    const supabase = await this.clientFactory();
    const enabled = new Set<EntitlementKey>();
    const sources: ResolvedEntitlements['sources'] = {
      org: null,
      seat: null,
      personal: null,
      overrides: [],
      revokedOverrides: [],
      revokedRoleRows: [],
      flagsOff: [],
    };
    const planSources: PlanSource[] = [];

    // ── 1. Verified membership ────────────────────────────────────────────
    // `active_org_id` is a client cookie: only a real `org_members` row makes
    // it a tenant scope (same rule as `withAuth` and `LimitsResolver`).
    const orgId = ctx.activeOrgId;
    const inOrg = orgId != null && (await isOrgMember(supabase, orgId, ctx.userId));

    // ── 2 + 3 + 4. Org layer ─────────────────────────────────────────────
    let ceiling: Set<EntitlementKey> | null = null;

    if (inOrg && orgId && ctx.orgRoleId) {
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

      const { data: org } = await supabase
        .from('organizations')
        .select('plan')
        .eq('id', orgId)
        .maybeSingle();

      if (org?.plan) {
        ceiling = await this.planEntitlements(org.plan, supabase);
        this.applyProfile(enabled, entitlementProfile, ceiling);
        sources.org = { planKey: org.plan, origin: 'org' };
        planSources.push(sources.org);
      }

      // Legacy rows come after the profile so an explicit revoke wins over a
      // profile grant, exactly as the row semantics always did (D19). An
      // enabled row adds nothing: the profile is authoritative for every key
      // since the legacy management markers left the catalog (phase 2b-7).
      for (const row of (roleFeatures ?? []) as Array<{
        feature_key: string;
        is_enabled?: boolean | null;
      }>) {
        if (!isEntitlementKey(row.feature_key)) continue;
        if (row.is_enabled === false) {
          enabled.delete(row.feature_key);
          sources.revokedRoleRows.push(row.feature_key);
        }
      }

      // A seat plan intersects the ceiling: it can add a key the org plan
      // carries, never one it does not (§6.1).
      const seatPlanKey = await getSeatPlanKey(ctx, supabase);
      if (seatPlanKey && ceiling) {
        for (const key of await this.planEntitlements(seatPlanKey, supabase)) {
          if (ceiling.has(key)) enabled.add(key);
        }
        sources.seat = { planKey: seatPlanKey, origin: 'seat' };
        planSources.push(sources.seat);
      }
    }

    // ── 5. Personal plan ──────────────────────────────────────────────────
    // Deliberately not a fallback: an org on the free `launch` tier grants no
    // `ai.chat`, and that must not silently void a StudiQ Pro the member paid
    // for. Inside an org only `personalPortable` keys carry over (D3), so a
    // personal purchase never escalates an org-layer decision.
    const { data: personalProfile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();

    const personalPlanKey = personalProfile?.personal_plan_key ?? null;
    if (personalPlanKey && personalPlanApplies(ctx, inOrg)) {
      for (const key of await this.planEntitlements(personalPlanKey, supabase)) {
        if (!inOrg || ENTITLEMENTS[key].personalPortable) enabled.add(key);
      }
      sources.personal = { planKey: personalPlanKey, origin: 'personal' };
      planSources.push(sources.personal);
    }

    // ── 6. User overrides (final word on their keys, D26) ────────────────
    const { data: overrides } = await supabase
      .from('user_feature_overrides')
      .select('feature_key, is_enabled, expires_at')
      .eq('user_id', ctx.userId);

    // Expired rows (`expires_at <= now`) are kept as an audit trail but must
    // not grant or revoke anything (#382). One `now` for the whole batch keeps
    // the decision consistent across rows.
    const nowMs = Date.now();
    const overrideKeys = new Set<EntitlementKey>();
    for (const row of (overrides ?? []) as OverrideRow[]) {
      if (!isEntitlementKey(row.feature_key)) continue;
      if (!isUserOverrideActive(row.expires_at, nowMs)) continue;
      overrideKeys.add(row.feature_key);
      if (row.is_enabled === false) {
        enabled.delete(row.feature_key);
        sources.revokedOverrides.push(row.feature_key);
      } else {
        enabled.add(row.feature_key);
        sources.overrides.push(row.feature_key);
      }
    }

    // ── 7. Flag gate (kill switch only, fails closed) ────────────────────
    const { data: flags } = await supabase.from('entitlement_flags').select('key, is_enabled');
    const flagMap = new Map<string, boolean | null>(
      (flags ?? []).map((f) => [f.key, f.is_enabled]),
    );

    for (const key of Array.from(enabled)) {
      // Baseline keys are always on and never gated (D9).
      if (ENTITLEMENTS[key].category !== 'surface') continue;
      // An active override owns its key in both directions: a flag never cuts
      // an override-granted key (D26, making D12 explicit).
      if (overrideKeys.has(key)) continue;
      // A missing flag row fails closed (D8): the key is removed.
      if (flagMap.get(key) !== true) {
        enabled.delete(key);
        sources.flagsOff.push(key);
      }
    }

    // ── 8. Limits + quota-0 exclusion ─────────────────────────────────────
    // TEMPORARY(3b): the limits half still composes through `LimitsResolver`;
    // 3b moves the `max(org, seat, personal)` composition into this resolver.
    const limits: Record<string, number> = Object.fromEntries(
      await Promise.all(
        LIMIT_KEYS.map(
          async (limitKey) =>
            [limitKey, await this.limits.getEffectiveLimit(ctx, limitKey)] as const,
        ),
      ),
    );

    const entitlements = ENTITLEMENT_KEYS.filter((key) => {
      if (!enabled.has(key)) return false;
      const quota = ENTITLEMENTS[key].quota;
      return quota == null || limits[quota] !== 0;
    });

    const primary = sources.org?.planKey ?? sources.personal?.planKey ?? 'free';

    return {
      entitlements,
      limits,
      sources,
      plan: { primary, sources: planSources },
    };
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
    for (const row of (data ?? []) as PlanEntitlementRow[]) {
      if (isEntitlementKey(row.entitlement_key)) ceiling.add(row.entitlement_key);
    }
    return ceiling;
  }

  /**
   * The profile layer: `all` is the whole plan ceiling, `learner` is the fixed
   * member set, `none` resolves nothing. Both intersect the plan ceiling, so a
   * plan change narrows every role with no prune step.
   */
  private applyProfile(
    enabled: Set<EntitlementKey>,
    profile: EntitlementProfile,
    ceiling: ReadonlySet<EntitlementKey>,
  ): void {
    if (profile === 'none') return;
    const keys = profile === 'all' ? ENTITLEMENT_KEYS : LEARNER_ENTITLEMENTS;

    for (const key of keys) {
      if (ceiling.has(key)) enabled.add(key);
    }
  }
}
export const entitlementResolver = wrapService(
  new EntitlementResolver(createClient),
  'entitlement.resolver',
);
