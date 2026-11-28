import {
  AccountType,
  ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  isEntitlementProfile,
  isLimitKey,
  LEARNER_ENTITLEMENTS,
  LIMIT_KEYS,
  LIMITS,
  type EntitlementKey,
  type EntitlementProfile,
  type LimitKey,
  type PlanSource,
  type RequestContext,
  type ResolvedEntitlements,
} from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { warn } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { createClient } from '@studiq/server/lib/supabase/server';
import { mapSupabaseError } from '@studiq/server/lib/supabase-errors';
import { getSeatPlanKey } from '@studiq/server/services/seat.plan';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
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

/**
 * A `plan_entitlements` row with its plan embed: `subscription_plans(scope)`
 * rides the `plan_key` FK, so the batched catalog read also tells each layer
 * plan's scope without an extra query (phase 4a, D34).
 */
type PlanEntitlementRow = {
  plan_key: string;
  entitlement_key: string;
  subscription_plans: { scope: string } | null;
};

/** A `plan_limits` row. */
type PlanLimitRow = { plan_key: string; limit_key: string; limit_value: number };

/**
 * The single entitlement resolver (ADR-0015 §6.1/§6.2, phase 3a + 3b). It is
 * the only reader that composes `plan_entitlements` and `plan_limits` into a
 * resolved set (`limits.ts` and `subscription-plan.service.ts` read them for
 * their own narrow purposes), and it owns `org_roles.entitlement_profile`,
 * `entitlement_flags`, `user_feature_overrides`, `org_seat_*`,
 * `organizations.plan` and `profiles.personal_plan_key` as resolution inputs.
 * The role layer is `profile + seat`: phase 7 dropped the revoke store
 * (D27, premarket), and D38 stopped filtering a seat through the org ceiling —
 * the pool subscription is the purchase (#1511).
 *
 * Resolution order (§6.1):
 *
 *   1. Verified membership — `active_org_id` is a cookie hint; only a real
 *      `org_members` row makes it an org context. The same query embeds the
 *      org plan and the role profile (the membership row's FKs), so the whole
 *      org layer is one query.
 *   2. Role profile — `all` = the org plan ceiling, `learner` =
 *      `LEARNER_ENTITLEMENTS ∩ ceiling`, `none` = ∅. A missing ctx role id
 *      grants no entitlement; the org plan is still read, because limits use
 *      it for every member.
 *   3. Seat plan — every key of the seat plan (D38); consulted only inside a
 *      verified org (a stale seat row plus a forged cookie supplies nothing).
 *   4. Personal plan — outside an org, all its keys; inside an org only the
 *      `personalPortable` whitelist (D3).
 *   5. User overrides — an active row is the final word on its key in both
 *      directions (D26); expired rows are ignored (#382).
 *   6. Flags — surface keys only: a missing row or `is_enabled = false`
 *      removes the key (fail closed, D8); baseline keys are never gated (D9);
 *      keys an active override owns are skipped (D26).
 *   7. Limits — the §6.2 truth table, composed in `composeLimits` from one
 *      batched `plan_limits` read: `scope:'user'` keys take
 *      `max(org, seat, personal)` with `-1` short-circuiting; `scope:'org'`
 *      keys come from the verified org's plan only (0 outside one). A missing
 *      `plan_limits` row is `0` (blocked) in every path.
 *   8. Quota-0 exclusion — an entitlement whose quota limit resolves to `0` is
 *      not effective, so the API and the UI agree (§6.1).
 *
 * A read that fails fails the whole resolution (`assertRead`, #1435): a failed
 * read must never resolve as "no rows" and answer from another layer.
 *
 * The whole resolution is at most seven queries — one per table read
 * (`org_members` + embeds, `org_seat_assignments` + embed, `profiles`,
 * `plan_entitlements`, `plan_limits`, `user_feature_overrides`,
 * `entitlement_flags`) — and never fans out per limit key. The result is
 * ordered by `ENTITLEMENT_KEYS`.
 */
export class EntitlementResolver {
  /**
   * Per-request memo, keyed on the `RequestContext` object. `withAuth` builds
   * exactly one ctx per request and hands the same object to every controller
   * and service, so one resolution serves `requireEntitlement` + limit checks in
   * the same request. A `WeakMap` (not a field on ctx) needs no change to the
   * shared `RequestContext` type, cannot leak into ctx serialization or logs,
   * and dies with the request's ctx — no cross-request cache exists in
   * phase 3. The promise is cached, so concurrent callers share one
   * resolution; a rejected promise is dropped from the map so a later call in
   * the same request can retry.
   */
  private readonly memo = new WeakMap<RequestContext, Promise<ResolvedEntitlements>>();

  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  resolveEntitlements(ctx: RequestContext): Promise<ResolvedEntitlements> {
    const cached = this.memo.get(ctx);
    if (cached) return cached;
    const pending = this.resolve(ctx);
    this.memo.set(ctx, pending);
    pending.catch(() => this.memo.delete(ctx));
    return pending;
  }

  /**
   * A failed read is not an empty one (#1435): `dbRows` would turn it into `[]`
   * and the resolver would answer from another layer: a revoked override comes
   * back, every limit reads 0, a paid feature looks flagged off. Every read
   * fails the request instead (span annotation, then a mapped `AppError` or a
   * `DatabaseError`), and the rejected resolution is evicted from the memo.
   */
  private assertRead(error: PostgrestError | null): void {
    if (error) mapSupabaseError(error);
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
      flagsOff: [],
    };
    const planSources: PlanSource[] = [];

    // ── 1. Verified membership + the org layer, one embedded query ────────
    // `active_org_id` is a client cookie: only a real `org_members` row makes
    // it a tenant scope (same rule as `withAuth`). The embed rides that row's
    // FKs, so the org plan and the role profile arrive with the proof of
    // membership in a single query.
    const orgId = ctx.activeOrgId;
    let inOrg = false;
    let orgPlanKey: string | null = null;
    let entitlementProfile: EntitlementProfile = 'none';

    if (orgId) {
      const { data: membership, error: membershipError } = await supabase
        .from('org_members')
        .select('organization_id, organizations(plan), org_roles(entitlement_profile)')
        .eq('organization_id', orgId)
        .eq('user_id', ctx.userId)
        .maybeSingle();
      this.assertRead(membershipError);

      if (membership) {
        inOrg = true;
        orgPlanKey = dbNested(membership.organizations)?.plan ?? null;
        // The role layer needs a ctx role id (withAuth always sets it for a
        // real membership); the embedded role is the membership's own row, so
        // a forged `orgRoleId` cannot widen it.
        const role = ctx.orgRoleId ? dbNested(membership.org_roles) : null;
        if (role && isEntitlementProfile(role.entitlement_profile)) {
          entitlementProfile = role.entitlement_profile;
        }
      }
    }

    // ── 2. Seat plan, one embedded query, only inside a verified org ──────
    // Membership is verified first: a stale seat row plus a forged or left
    // `active_org_id` must never supply limits or entitlements (phase 3b).
    let seatPlanKey: string | null = null;
    if (inOrg && ctx.orgRoleId) {
      const seat = await getSeatPlanKey(ctx, supabase);
      // A failed read is not "not seated": falling through would hand a seated
      // member the personal/org plan (or a looser limit) while the database is
      // down (#1373). Throw, so the request fails and the memo drops the promise.
      if (!seat.success) throw new AppError(seat.error);
      seatPlanKey = seat.data;
    }

    // ── 3. Personal plan key ──────────────────────────────────────────────
    const { data: personalProfile, error: profileError } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();
    this.assertRead(profileError);
    const personalPlanKey = personalProfile?.personal_plan_key ?? null;

    // ── 4. Batched catalog reads: every layer plan in one query each ──────
    // The personal plan is always in the batch: its `scope` decides whether it
    // applies inside the org (phase 4a, D34).
    const layerPlanKeys = [
      inOrg ? orgPlanKey : null,
      inOrg && ctx.orgRoleId ? seatPlanKey : null,
      personalPlanKey,
    ].filter((key): key is string => key != null);
    const planKeys = [...new Set(layerPlanKeys)];

    const entitlementsByPlan = new Map<string, Set<EntitlementKey>>();
    const limitsByPlan = new Map<string, Map<LimitKey, number>>();
    const scopeByPlan = new Map<string, string>();
    if (planKeys.length > 0) {
      const { data: entitlementRows, error: entitlementError } = await supabase
        .from('plan_entitlements')
        .select('plan_key, entitlement_key, subscription_plans(scope)')
        .in('plan_key', planKeys);
      this.assertRead(entitlementError);
      for (const row of dbRows(entitlementRows) as PlanEntitlementRow[]) {
        if (row.subscription_plans?.scope)
          scopeByPlan.set(row.plan_key, row.subscription_plans.scope);
        if (!isEntitlementKey(row.entitlement_key)) continue;
        const set = entitlementsByPlan.get(row.plan_key) ?? new Set<EntitlementKey>();
        set.add(row.entitlement_key);
        entitlementsByPlan.set(row.plan_key, set);
      }

      const { data: limitRows, error: limitError } = await supabase
        .from('plan_limits')
        .select('plan_key, limit_key, limit_value')
        .in('plan_key', planKeys);
      this.assertRead(limitError);
      for (const row of dbRows(limitRows) as PlanLimitRow[]) {
        if (!isLimitKey(row.limit_key)) continue;
        const map = limitsByPlan.get(row.plan_key) ?? new Map<LimitKey, number>();
        map.set(row.limit_key, row.limit_value);
        limitsByPlan.set(row.plan_key, map);
      }
    }

    // A personal plan applies outside an org always; inside a verified org it
    // applies unless its own `scope` is `organization` — that is the legacy
    // org-buyer mirror (D-ADR-0007), which must never add entitlements or
    // limits inside the org (D34). Only `personalPortable` keys carry anyway.
    const personalApplies = !inOrg || scopeByPlan.get(personalPlanKey ?? '') !== 'organization';

    // ── 5. Limits composition (§6.2 truth table) ───────────────────────────
    if (inOrg && !orgPlanKey) {
      warn('entitlement.resolver: organization has no plan', { organizationId: orgId });
    }
    // A manager holds no personal plan by design (ADR-0007); any other persona
    // without one is a provisioning fault worth a warning.
    if (personalApplies && !personalPlanKey && ctx.accountType !== AccountType.MANAGER) {
      warn('entitlement.resolver: profile has no personal plan', { userId: ctx.userId });
    }
    const limits = this.composeLimits({
      inOrg,
      orgPlanKey,
      seatPlanKey: inOrg && ctx.orgRoleId ? seatPlanKey : null,
      personalPlanKey: personalApplies ? personalPlanKey : null,
      limitsByPlan,
    });

    // ── 6 + 7 + 8. Org layer: profile and seat ────────────────────────────
    if (inOrg && orgPlanKey) {
      sources.org = { planKey: orgPlanKey, origin: 'org' };
      planSources.push(sources.org);
    }

    if (inOrg && orgPlanKey && ctx.orgRoleId) {
      const ceiling = entitlementsByPlan.get(orgPlanKey) ?? new Set<EntitlementKey>();
      this.applyProfile(enabled, entitlementProfile, ceiling);

      // A seat licence grants every key of the seat plan: the organization
      // bought those keys through the pool subscription, so the org ceiling
      // does not filter them (D38, #1511). `addPool` refuses a plan that is not
      // `scope='personal'` with every key `seatEligible`, and the catalog
      // invariant `seatEligible ⇒ personal` keeps that boundary: an org-scope
      // key — the only thing `seatEligible: false` marks — cannot ride a seat,
      // so a seat still cannot widen the org's scope.
      if (seatPlanKey) {
        for (const key of entitlementsByPlan.get(seatPlanKey) ?? []) {
          enabled.add(key);
        }
        sources.seat = { planKey: seatPlanKey, origin: 'seat' };
        planSources.push(sources.seat);
      }
    }

    // ── 9. Personal plan ──────────────────────────────────────────────────
    // Deliberately not a fallback: an org on the free `launch` tier grants no
    // `ai.chat`, and that must not silently void a StudiQ Pro the member paid
    // for. Inside an org only `personalPortable` keys carry over (D3), so a
    // personal purchase never escalates an org-layer decision.
    if (personalPlanKey && personalApplies) {
      for (const key of entitlementsByPlan.get(personalPlanKey) ?? []) {
        if (!inOrg || ENTITLEMENTS[key].personalPortable) enabled.add(key);
      }
      sources.personal = { planKey: personalPlanKey, origin: 'personal' };
      planSources.push(sources.personal);
    }

    // ── 10. User overrides (final word on their keys, D26) ────────────────
    const { data: overrides, error: overridesError } = await supabase
      .from('user_feature_overrides')
      .select('feature_key, is_enabled, expires_at')
      .eq('user_id', ctx.userId);
    this.assertRead(overridesError);

    // Expired rows (`expires_at <= now`) are kept as an audit trail but must
    // not grant or revoke anything (#382). One `now` for the whole batch keeps
    // the decision consistent across rows.
    const nowMs = Date.now();
    const overrideKeys = new Set<EntitlementKey>();
    for (const row of dbRows(overrides) as OverrideRow[]) {
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

    // ── 11. Flag gate (kill switch only, fails closed) ────────────────────
    const { data: flags, error: flagsError } = await supabase
      .from('entitlement_flags')
      .select('key, is_enabled');
    this.assertRead(flagsError);
    const flagMap = new Map<string, boolean | null>(
      dbRows(flags).map((f) => [f.key, f.is_enabled]),
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

    // ── 12. Quota-0 exclusion ─────────────────────────────────────────────
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

  /**
   * The §6.2 truth table, composed from the batched `plan_limits` rows:
   *
   * | Context                    | `scope:'user'`                      | `scope:'org'` |
   * | -------------------------- | ----------------------------------- | ------------- |
   * | No org (or unverified)     | personal plan                       | `0`           |
   * | Org member, unseated       | `max(org, personal)`, -1 wins       | org plan      |
   * | Org member, seated         | `max(org, seat, personal)`          | org plan      |
   * | Org-scope personal plan    | personal excluded (D34)             | org plan      |
   * | Non-member / forged cookie | personal plan                       | `0`           |
   * | Missing `plan_limits` row  | `0` + warn (org/personal); `0` for a seat | `0` + warn |
   *
   * A licence plan carries one quota row on purpose, so its missing keys are a
   * silent `0` (F6); the warning keeps its meaning for the org and personal
   * layers, which claim to be full plans.
   *
   * `inOrg` is always membership-verified, so a forged `active_org_id` lands in
   * the "no org" row even when a stale seat row exists.
   */
  private composeLimits(input: {
    inOrg: boolean;
    orgPlanKey: string | null;
    seatPlanKey: string | null;
    personalPlanKey: string | null;
    limitsByPlan: Map<string, Map<LimitKey, number>>;
  }): Record<string, number> {
    const { inOrg, orgPlanKey, seatPlanKey, personalPlanKey, limitsByPlan } = input;

    const limits: Record<string, number> = {};
    for (const limitKey of LIMIT_KEYS) {
      if (LIMITS[limitKey].scope === 'org') {
        // Org-scope capacity belongs to the verified org's plan only — never a
        // seat, never a personal plan; outside a verified org it is 0.
        limits[limitKey] =
          inOrg && orgPlanKey ? this.planLimitValue(limitsByPlan, orgPlanKey, limitKey) : 0;
        continue;
      }

      // Verified org or not, user-scope keys take the most permissive layer
      // that applies: outside an org the org/seat plans are already nulled
      // above, so only the personal plan can be a candidate. `-1`
      // short-circuits the max.
      const candidates = [orgPlanKey, personalPlanKey]
        .filter((key): key is string => key != null)
        .map((key) => this.planLimitValue(limitsByPlan, key, limitKey));
      // A seat sells the keys it carries; a missing row is 0, not a faulty
      // plan. A licence plan is a partial plan by design (one quota row), so
      // the "missing limit" warning would fire on every seated resolution.
      const seatValue = seatPlanKey ? limitsByPlan.get(seatPlanKey)?.get(limitKey) : undefined;
      if (seatValue !== undefined) candidates.push(seatValue);
      limits[limitKey] =
        candidates.length === 0 ? 0 : candidates.includes(-1) ? -1 : Math.max(...candidates);
    }
    return limits;
  }

  /** One plan's value for a key. A missing row is `0` (blocked) — never unlimited. */
  private planLimitValue(
    limitsByPlan: Map<string, Map<LimitKey, number>>,
    planKey: string,
    limitKey: LimitKey,
  ): number {
    const value = limitsByPlan.get(planKey)?.get(limitKey);
    if (value === undefined) {
      warn('entitlement.resolver: plan is missing a limit', { planKey, limitKey });
      return 0;
    }
    return value;
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
