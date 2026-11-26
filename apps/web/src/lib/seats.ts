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
