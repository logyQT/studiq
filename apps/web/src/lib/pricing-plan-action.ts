export type PlanAction = 'none' | 'register' | 'checkout' | 'change-plan' | 'contact';

/**
 * The one action a pricing row carries, decided in one place because the row
 * otherwise states the precedence in JSX nesting.
 *
 * A reader with an active subscription cannot start a second checkout — the
 * server refuses one subscription per owner — so their upgrade, downgrade and
 * proration belong to the billing page. The current plan's own row carries no
 * action: the badge says the reader already has it.
 */
export function pricingPlanAction(input: {
  signedIn: boolean;
  isCurrent: boolean;
  isFree: boolean;
  contactOnly: boolean;
  hasActivePlan: boolean;
}): PlanAction {
  // Campus is a sales conversation in every state, including for a subscriber.
  if (input.contactOnly) return 'contact';
  if (!input.signedIn) return 'register';
  if (input.isFree) return 'none';
  if (input.isCurrent) return 'none';
  if (input.hasActivePlan) return 'change-plan';
  return 'checkout';
}
