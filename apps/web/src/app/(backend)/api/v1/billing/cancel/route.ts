import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { rateLimitResponse } from '@studiq/server/lib/rate-limit-response';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/** Cancel/reactivate writes the provider subscription; per-user burst guard. */
const rateLimiter = createRateLimiter(60_000, 10);

/** Schedule cancellation at period end, or reactivate before it takes effect. */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const limit = rateLimiter.check(ctx.userId);
    if (!limit.allowed) return rateLimitResponse(limit);

    const body: unknown = await req.json();
    return toNextResponse(await billingController.cancelSubscription(ctx, body));
  });
}
