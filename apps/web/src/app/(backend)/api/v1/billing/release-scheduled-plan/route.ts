import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { rateLimitResponse } from '@studiq/server/lib/rate-limit-response';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * Revert a scheduled downgrade ("keep current plan", #662 §2.5).
 *
 * The request has no body: the owner comes from `RequestContext` and the
 * customer/subscription from the authenticated mirror. Detaching the provider
 * schedule never writes an entitlement, so the plan only changes when a later
 * webhook says it should. Same per-user burst guard as the other money routes.
 */
const rateLimiter = createRateLimiter(60_000, 10);

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const limit = rateLimiter.check(ctx.userId);
    if (!limit.allowed) return rateLimitResponse(limit);

    return toNextResponse(await billingController.releaseScheduledPlan(ctx));
  });
}
