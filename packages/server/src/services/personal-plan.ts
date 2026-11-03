import { AccountType, type RequestContext } from '@studiq/authz';

/**
 * Whether `profiles.personal_plan_key` is a real, independent entitlement for
 * this caller — used by both `FeatureResolver` and `LimitsResolver` so the two
 * always agree.
 *
 * Manager plans are organization plans mirrored onto the buyer (#228): a manager
 * who buys Hub for an org also gets `personal_plan_key = hub`, which *is* the
 * org's plan, not a second purchase. Inside an org it must add nothing, so a
 * stale or mirrored manager plan can never widen that org's entitlement.
 *
 * Student and educator plans (`pro`, `ace`, `creator`, …) are genuine personal
 * subscriptions. They apply inside an org too: a student paying for StudiQ Pro
 * keeps `ai.chat` even when the org sits on the free `launch` tier — the org's
 * plan is a floor, not a ceiling. Org-scoped *capacity* is unaffected because
 * only per-member keys and features consult this.
 */
export function personalPlanApplies(ctx: RequestContext, inVerifiedOrg: boolean): boolean {
  if (!inVerifiedOrg) return true;
  return ctx.accountType !== AccountType.MANAGER;
}
