import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { rateLimitResponse } from '@studiq/server/lib/rate-limit-response';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * Reconcile performs two live Stripe reads and can activate a plan. The success
 * page calls it once per load (only the read model is polled), but a scripted
 * replay is still authenticated traffic that would burn the Stripe read budget.
 * This is a **per-process** burst guard, not a global quota: it complements,
 * and does not replace, a shared store if the deployment scales out.
 */
const rateLimiter = createRateLimiter(60_000, 20);

/**
 * Success-page reconcile (#662 X6): verifies the Checkout Session belongs to
 * the caller, then reuses the idempotent webhook activation path. The webhook
 * remains authoritative; this only closes the redirect-before-delivery gap.
 */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const limit = rateLimiter.check(ctx.userId);
    if (!limit.allowed) return rateLimitResponse(limit);

    const body: unknown = await req.json();
    return toNextResponse(await billingController.reconcileCheckout(ctx, body));
  });
}
