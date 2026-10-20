import { stripeController } from '@studiq/server/controllers/stripe.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

// Excluded from the proxy's catch-all auth rule (a real Stripe webhook is
// unauthenticated), but the mock webhook acts on a user's plan, so it
// authenticates the caller itself.
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await stripeController.handleWebhook(ctx, body));
  });
}
