import { stripeController } from '@studiq/server/controllers/stripe.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { rateLimitResponse } from '@studiq/server/lib/rate-limit-response';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * Each call creates a hosted Checkout Session and may create a Stripe Customer.
 * A per-user burst guard keeps a scripted retry loop from burning the provider
 * budget; it is per-process, like `/billing/reconcile`.
 */
const rateLimiter = createRateLimiter(60_000, 10);

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const limit = rateLimiter.check(ctx.userId);
    if (!limit.allowed) return rateLimitResponse(limit);

    const body: unknown = await req.json();
    return toNextResponse(await stripeController.createCheckoutSession(ctx, body));
  });
}
