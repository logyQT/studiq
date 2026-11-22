/**
 * Seats left in a pool. Floored at zero: a row written before the
 * `org_seat_pools_total_not_below_assigned` constraint (or a cached one) can
 * still carry `total < assigned`, and the page must never show "-1" (#1068).
 */
export function availableSeats(total: number, assigned: number): number {
  return Math.max(0, total - assigned);
}

/**
 * The plans a manager may buy seat licences of (D33): active, personal-scope
 * and `seatEligible` in the live catalog — read from the catalogue query, never
 * from a local copy (R37). Catalogue order is preserved.
 */
export function purchasableSeatPlans<
  T extends { isActive: boolean; scope: string; seatEligible: boolean },
>(plans: readonly T[]): T[] {
  return plans.filter((plan) => plan.isActive && plan.scope === 'personal' && plan.seatEligible);
}

/**
 * The pools a member may be offered in the assign dialog (D14/D33): the pool
 * plan's `audience` must equal the member's `accountType`. A pool whose plan is
 * missing from the catalogue resolves to no audience and is not offered —
 * fail closed — and an organization plan (`audience: null`) never matches.
 */
export function poolsForPersona<T extends { planKey: string }>(
  pools: readonly T[],
  plans: readonly { key: string; audience: string | null }[],
  accountType: string,
): T[] {
  const audienceByPlanKey = new Map(plans.map((plan) => [plan.key, plan.audience]));
  return pools.filter((pool) => audienceByPlanKey.get(pool.planKey) === accountType);
}
