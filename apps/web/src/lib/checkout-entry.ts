import type { BillingLocale, PaymentDriver } from '@studiq/server/lib/payment/payment-gateway';
import { ApiError } from '@/lib/api';

/**
 * What `/checkout` should render for the active payment driver (#662 §5.6).
 *
 * The simulated card form stays byte-for-byte identical for `mock`
 * (BIL-04/BIL-05/STU-52 depend on it), but a deep link in `stripe` mode must
 * never expose a form whose only possible outcome is a 400 from the public
 * webhook route.
 */
export type CheckoutEntry = 'mock-form' | 'stripe-redirect';

export function checkoutEntryFor(driver: PaymentDriver): CheckoutEntry {
  return driver === 'stripe' ? 'stripe-redirect' : 'mock-form';
}

/**
 * The initial state of the Stripe redirect card.
 *
 * A canceled hosted Checkout returns here with `?canceled=1`; starting another
 * session automatically would bounce the customer back to Stripe forever, so
 * cancellation is a terminal state with an explicit retry.
 */
export type CheckoutStartupStatus = 'starting' | 'canceled' | 'missing-plan';

export function initialCheckoutStatus(input: {
  planKey: string;
  canceled: boolean;
}): CheckoutStartupStatus {
  if (!input.planKey) return 'missing-plan';
  return input.canceled ? 'canceled' : 'starting';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The organization id is a user-editable query-string hint. The server always
 * re-checks admin membership, but forwarding a malformed id would fail the
 * request schema (422) before the service could ignore it for a personal plan.
 */
export function checkoutOrgIdFor(orgId: string | null | undefined): string | undefined {
  const trimmed = orgId?.trim();
  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export interface CheckoutSessionBody {
  planKey: string;
  orgId?: string;
  locale?: BillingLocale;
}

/**
 * The only fields the client may send to `create-checkout-session`. Owner,
 * amount, currency, price, customer and subscription are resolved server-side
 * (#662 §9.2), so there is deliberately no way to put them in this body.
 */
export function checkoutSessionBody(input: {
  planKey: string;
  orgId?: string | null;
  locale?: BillingLocale;
}): CheckoutSessionBody {
  const body: CheckoutSessionBody = { planKey: input.planKey };
  const orgId = checkoutOrgIdFor(input.orgId);
  if (orgId) body.orgId = orgId;
  if (input.locale) body.locale = input.locale;
  return body;
}

export interface CheckoutFailure {
  /** App error code when the failure came from our API; `null` for transport. */
  code: string | null;
  /** A retry can plausibly succeed (network/5xx/rate limit). */
  retryable: boolean;
  /** The owner already pays: send them to the billing page, not another attempt. */
  manageSubscription: boolean;
}

/**
 * Permanent domain refusals must not render a "try again" button: a user who
 * already has an active subscription (`CONFLICT`), a non-admin org buyer
 * (`FORBIDDEN`) or a malformed deep link (`UNPROCESSABLE_ENTITY`) would loop
 * forever. Everything else is treated as transient.
 */
export function checkoutFailureFor(error: unknown): CheckoutFailure {
  const code = error instanceof ApiError ? error.code : null;

  if (code === 'CONFLICT') return { code, retryable: false, manageSubscription: true };
  if (
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'NOT_FOUND' ||
    code === 'BAD_REQUEST' ||
    code === 'UNPROCESSABLE_ENTITY'
  ) {
    return { code, retryable: false, manageSubscription: false };
  }

  return { code, retryable: true, manageSubscription: false };
}

/**
 * `create-checkout-session` returns a Stripe-hosted URL. Never navigate to an
 * arbitrary string: a misconfigured/mocked server response must fail closed.
 */
export function isAllowedStripeCheckoutUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))
    );
  } catch {
    return false;
  }
}
