/**
 * Seats left in a pool. Floored at zero: a row written before the
 * `org_seat_pools_total_not_below_assigned` constraint (or a cached one) can
 * still carry `total < assigned`, and the page must never show "-1" (#1068).
 */
export function availableSeats(total: number, assigned: number): number {
  return Math.max(0, total - assigned);
}
