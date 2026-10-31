import type { BillingLocale, PaymentOwner } from '@studiq/server/lib/payment/payment-gateway';

/** Checkout retries inside this window reuse one Stripe session. */
export const CHECKOUT_BUCKET_MS = 30 * 60 * 1000;

/**
 * Stripe measures the 30-minute minimum from when it receives the request, so
 * a value exactly 30 minutes ahead can fail validation after network latency.
 */
const CHECKOUT_EXPIRY_MARGIN_SECONDS = 60;

/**
 * Deterministic idempotency key for `checkout.sessions.create`: every input
 * that changes the Stripe parameters is part of the key, so a reused key always
 * carries identical parameters (Stripe rejects mismatches).
 *
 * - owner id: organization or user the plan is bought for
 * - purchaser id: only meaningful for an organization, where two admins can
 *   check out for the same organization
 * - plan + locale
 * - 30-minute bucket: retries and double-clicks collapse onto one session
 */
export function checkoutIdempotencyKey(
  owner: PaymentOwner,
  planKey: string,
  locale: BillingLocale,
  nowMs: number = Date.now(),
): string {
  const ownerKey = owner.type === 'org' ? owner.orgId : owner.userId;
  const purchaser = owner.type === 'org' ? owner.userId : '';
  const bucket = Math.floor(nowMs / CHECKOUT_BUCKET_MS);
  return `checkout:${owner.type}:${ownerKey}:${purchaser}:${planKey}:${locale}:${bucket}`;
}

/**
 * Expiry that is identical for every retry inside one idempotency bucket and
 * always comfortably clears Stripe's 30-minute minimum (up to ~60 min ahead,
 * well under the 24-hour maximum). Callers must pass the same `nowMs` snapshot
 * they used for the idempotency key.
 */
export function checkoutExpiresAt(nowMs: number = Date.now()): number {
  const bucketEndMs = (Math.floor(nowMs / CHECKOUT_BUCKET_MS) + 1) * CHECKOUT_BUCKET_MS;
  return Math.floor((bucketEndMs + CHECKOUT_BUCKET_MS) / 1000) + CHECKOUT_EXPIRY_MARGIN_SECONDS;
}
