import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';

/**
 * The personal plan the landing teaser presents as "Plus". It is a named tier, not
 * the pricing page's recommendation: that list is `RECOMMENDED_PLAN_KEYS` in
 * `pricing-ladders.ts` and names Pro.
 */
const LANDING_PREMIUM_KEY = 'plus';

export type LandingPricing = {
  /** Free personal plan (price 0). */
  free: PlanInfo | null;
  /** The headline paid personal plan. */
  premium: PlanInfo | null;
  /** Cheapest paid organization plan, shown as "od ...". */
  organizationFrom: PlanInfo | null;
};

function cheapestPaid(plans: PlanInfo[]): PlanInfo | null {
  const paid = plans.filter((p) => p.priceMonthly > 0);
  if (paid.length === 0) return null;
  return paid.reduce((min, p) => (p.priceMonthly < min.priceMonthly ? p : min));
}

/**
 * Picks the three plans the landing teaser advertises from the real, DB-driven plans, so the
 * public page cannot disagree with /pricing (the teaser used hardcoded USD copy, #283).
 * There is one personal ladder since #1193, so `personal` is that list.
 */
export function pickLandingPlans(personal: PlanInfo[], organization: PlanInfo[]): LandingPricing {
  const free = personal.find((p) => p.priceMonthly === 0) ?? null;
  const premium = personal.find((p) => p.key === LANDING_PREMIUM_KEY) ?? cheapestPaid(personal);

  return { free, premium, organizationFrom: cheapestPaid(organization) };
}

/** `19,99 zł` / `$19.99` in the visitor locale, always in the currency of the plan itself. */
export function formatPlanPrice(plan: PlanInfo, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: plan.priceMonthly % 100 === 0 ? 0 : 2,
  }).format(plan.priceMonthly / 100);
}
