import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * Success-page reconcile (#662 X6): verifies the Checkout Session belongs to
 * the caller, then reuses the idempotent webhook activation path. The webhook
 * remains authoritative; this only closes the redirect-before-delivery gap.
 */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body: unknown = await req.json();
    return toNextResponse(await billingController.reconcileCheckout(ctx, body));
  });
}
