import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';

/** The student plan the landing page presents as "Premium" (the popular one on /pricing/student). */
export const LANDING_PREMIUM_KEY = 'ace';

export type LandingPricing = {
  /** Free student plan (price 0). */
  free: PlanInfo | null;
  /** The headline paid student plan. */
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
 */
export function pickLandingPlans(student: PlanInfo[], manager: PlanInfo[]): LandingPricing {
  const free = student.find((p) => p.priceMonthly === 0) ?? null;
  const premium = student.find((p) => p.key === LANDING_PREMIUM_KEY) ?? cheapestPaid(student);

  return { free, premium, organizationFrom: cheapestPaid(manager) };
}

/** `19,99 zł` / `$19.99` in the visitor locale, always in the currency of the plan itself. */
export function formatPlanPrice(plan: PlanInfo, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: plan.priceMonthly % 100 === 0 ? 0 : 2,
  }).format(plan.priceMonthly / 100);
}
