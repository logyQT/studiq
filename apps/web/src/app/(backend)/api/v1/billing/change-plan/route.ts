import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { rateLimitResponse } from '@studiq/server/lib/rate-limit-response';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * A plan change resets the billing anchor and can issue an immediate invoice.
 * Per-user burst guard; per-process, like `/billing/reconcile`.
 */
const rateLimiter = createRateLimiter(60_000, 10);

/**
 * Owner/customer/subscription/price are resolved server-side (#662 §9.2); the
 * body only carries the target plan key.
 */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const limit = rateLimiter.check(ctx.userId);
    if (!limit.allowed) return rateLimitResponse(limit);

    const body: unknown = await req.json();
    return toNextResponse(await billingController.changePlan(ctx, body));
  });
}
