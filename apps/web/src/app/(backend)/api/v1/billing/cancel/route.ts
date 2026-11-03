import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/** Schedule cancellation at period end, or reactivate before it takes effect. */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body: unknown = await req.json();
    return toNextResponse(await billingController.cancelSubscription(ctx, body));
  });
}
