/**
 * The two questions that decide whether a plan is sold self-serve (B3, #1495).
 *
 * They are separate on purpose:
 *
 * - `isPubliclyListable` and `billingModeAllowsSelfServe` need no organization:
 *   they answer "may this plan appear in a public read" and "may it be bought
 *   through checkout at all".
 * - Whether an unlisted plan may reach a particular organization is an
 *   assignment question, answered from `plan_assignments` by
 *   `StripeBillingRepository.planIsAssignedToOrg`.
 *
 * Adding a billing mode or a private-subscription path is a new arm here, never
 * a new `=== 'stripe'` comparison in a service, a controller or a component.
 *
 * The values arrive as plain strings because they are read from `text` columns;
 * the CHECK constraints in `20261127120000_plan_visibility_assignments.sql` and
 * the write schemas in `subscription-plan.model.ts` are the type boundary.
 */
export function billingModeAllowsSelfServe(mode: string): boolean {
  return mode === 'stripe';
}

export function isPubliclyListable(plan: { visibility: string }): boolean {
  return plan.visibility === 'public';
}

/**
 * The org-independent half of "can be bought on this page": the plan is public
 * and its billing mode allows checkout. `PlanInfo.selfServe` is this value, and
 * the pricing surfaces read only that boolean.
 *
 * An assigned unlisted plan with `stripe` is therefore a deliberate pair: the
 * checkout API accepts it for the assigned organization (`resolvePlanAssignment`
 * answers the other half), while `selfServe` stays `false` — the self-serve UI
 * prints no action for it, and the mock checkout form answers 404 because
 * `getByKey` hides it. The contract is sold by sales, then applied.
 */
export function isSelfServePlan(plan: { visibility: string; billingMode: string }): boolean {
  return isPubliclyListable(plan) && billingModeAllowsSelfServe(plan.billingMode);
}
