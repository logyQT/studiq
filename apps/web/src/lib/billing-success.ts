import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import { resolveDashboardPath } from '@/lib/onboarding';

/**
 * The success page may land before Stripe delivers `checkout.session.completed`
 * (#662 X6). These constants keep the wait bounded: 8 attempts with 2 s between
 * attempts ≈ 14 s of waiting plus request latency (about 15 s end to end).
 */
export const BILLING_SUCCESS_POLL_INTERVAL_MS = 2_000;
export const BILLING_SUCCESS_POLL_ATTEMPTS = 8;

const ACTIVATED_STATUSES: readonly string[] = ['active', 'trialing', 'past_due'];

/** The subscription is live and the entitlement transaction has committed. */
export function isActivatedSubscription(view: BillingSubscriptionView): boolean {
  return (
    Boolean(view.planKey) &&
    Boolean(view.entitlementAppliedPlanKey) &&
    ACTIVATED_STATUSES.includes(view.status)
  );
}

export interface PollBillingActivationDeps {
  /** Fire the authenticated reconcile once; a failure is non-fatal. */
  reconcile: () => Promise<unknown>;
  readSubscription: () => Promise<BillingSubscriptionView>;
  /**
   * The plan the Checkout Session purchased (`plan_id` in `success_url`).
   * Without it an unrelated active plan would look like a successful
   * activation after a failed reconcile.
   */
  expectedPlanKey: string | null;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
}

export type PollBillingActivationResult =
  | { state: 'activated'; subscription: BillingSubscriptionView }
  | { state: 'timeout' }
  | { state: 'cancelled' };

/**
 * Reconcile once, then poll the shared read model until it shows a live plan or
 * the budget runs out. The webhook remains authoritative; this only closes the
 * redirect-before-delivery gap.
 */
export async function pollBillingActivation(
  deps: PollBillingActivationDeps,
): Promise<PollBillingActivationResult> {
  try {
    await deps.reconcile();
  } catch {
    // The webhook may already be in flight; the read-model poll still observes it.
  }

  for (let attempt = 0; attempt < BILLING_SUCCESS_POLL_ATTEMPTS; attempt += 1) {
    if (deps.isCancelled()) return { state: 'cancelled' };

    try {
      const view = await deps.readSubscription();
      // The committed-entitlement marker is written in the same transaction as
      // the entitlement apply. The billed mirror updates first, so it is not
      // proof on its own. Compare the marker rather than the effective planKey:
      // a seat/comped plan may legitimately differ from the purchased plan.
      const planMatches =
        deps.expectedPlanKey === null || view.entitlementAppliedPlanKey === deps.expectedPlanKey;
      if (!deps.isCancelled() && planMatches && isActivatedSubscription(view)) {
        return { state: 'activated', subscription: view };
      }
    } catch {
      // A transient read failure should not cancel the poll.
    }

    if (attempt < BILLING_SUCCESS_POLL_ATTEMPTS - 1) {
      await deps.sleep(BILLING_SUCCESS_POLL_INTERVAL_MS);
    }
  }

  return deps.isCancelled() ? { state: 'cancelled' } : { state: 'timeout' };
}

/** The dashboard (and therefore `<dashboard>/billing`) for an account type. */
export function dashboardPathForAccountType(accountType: unknown): '/app' | '/edu' | '/manage' {
  return resolveDashboardPath(typeof accountType === 'string' ? accountType : null);
}
