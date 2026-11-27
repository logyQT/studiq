export type PlanAction = 'none' | 'register' | 'current' | 'checkout' | 'change-plan';

/**
 * The one action a pricing row carries, decided in one place because the row
 * otherwise states the precedence in JSX nesting.
 *
 * A reader with an active subscription cannot start a second checkout — the
 * server refuses one subscription per owner — so their upgrade, downgrade and
 * proration belong to the billing page. The current plan's own row carries a
 * disabled "current plan" action: an empty action cell reads as a broken row,
 * and the label names the state without repeating the badge beside it.
 * `isCurrent` comes before `isFree`, so a reader on the free plan gets that
 * disabled action too.
 *
 * `hasActivePlan` is tri-state: `null` means the plan read is still pending or
 * failed. A failed read must not claim the reader has no subscription, so the
 * row prints no action until the answer is known (the prices stay).
 *
 * `isSelfServe` is the plan's own answer (B3): a plan that is not publicly
 * listable, or whose billing mode is not self-serve, has no checkout, no
 * register and no change-plan path. It is absent for a caller that has no plan,
 * which keeps every existing surface unchanged.
 *
 * The predicate order is `isSelfServe → register → purchaseBlocked → current →
 * null → hasActivePlan → isFree → checkout`. A subscriber's free row is a
 * downgrade, not a second checkout, so `hasActivePlan` sits above `isFree`; a
 * reader with no subscription keeps `none` on a free row, because a checkout
 * there would buy nothing. `purchaseBlocked` is a manager on the individual
 * ladder: they hold no personal plan and the checkout refuses one (ADR-0007).
 */
export function pricingPlanAction(input: {
  signedIn: boolean;
  isCurrent: boolean;
  isFree: boolean;
  hasActivePlan: boolean | null;
  purchaseBlocked?: boolean;
  /** The plan is public and its billing mode allows checkout (B3). */
  isSelfServe?: boolean;
}): PlanAction {
  if (input.isSelfServe === false) return 'none';
  if (!input.signedIn) return 'register';
  if (input.purchaseBlocked) return 'none';
  if (input.isCurrent) return 'current';
  if (input.hasActivePlan === null) return 'none';
  // A subscriber moves between plans on the billing page: a free row is their
  // downgrade, and the server refuses a second subscription.
  if (input.hasActivePlan) return 'change-plan';
  // A reader with no subscription has nothing to check out on a free row.
  if (input.isFree) return 'none';
  return 'checkout';
}
