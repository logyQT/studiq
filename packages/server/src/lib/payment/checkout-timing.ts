import type { PaymentOwner } from '@studiq/server/lib/payment/payment-gateway';

/** Checkout retries inside this window reuse one Stripe session. */
export const CHECKOUT_BUCKET_MS = 30 * 60 * 1000;

/**
 * Stripe measures the 30-minute minimum from when it receives the request, so
 * a value exactly 30 minutes ahead can fail validation after network latency.
 */
const CHECKOUT_EXPIRY_MARGIN_SECONDS = 60;

/**
 * Deterministic idempotency key for `checkout.sessions.create`: owner + plan +
 * a 30-minute time bucket. Retries and double-clicks collapse onto one session;
 * a new bucket produces a fresh session (the old one expires, §5.5).
 */
export function checkoutIdempotencyKey(
  owner: PaymentOwner,
  planKey: string,
  nowMs: number = Date.now(),
): string {
  const ownerKey = owner.type === 'org' ? owner.orgId : owner.userId;
  const bucket = Math.floor(nowMs / CHECKOUT_BUCKET_MS);
  return `checkout:${owner.type}:${ownerKey}:${planKey}:${bucket}`;
}

/**
 * Expiry that is identical for every retry inside one idempotency bucket and
 * always comfortably clears Stripe's 30-minute minimum (up to ~60 min ahead,
 * well under the 24-hour maximum).
 */
export function checkoutExpiresAt(nowMs: number = Date.now()): number {
  const bucketEndMs = (Math.floor(nowMs / CHECKOUT_BUCKET_MS) + 1) * CHECKOUT_BUCKET_MS;
  return Math.floor((bucketEndMs + CHECKOUT_BUCKET_MS) / 1000) + CHECKOUT_EXPIRY_MARGIN_SECONDS;
}
