import { stripeController } from '@studiq/server/controllers/stripe.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { getPaymentGateway } from '@studiq/server/lib/payment/payment-gateway.factory';
import { withAuth } from '@studiq/server/lib/with-auth';
import { withPublicTracing } from '@studiq/server/lib/with-public-tracing';
import type { NextRequest } from 'next/server';

/**
 * Stripe webhook (#662 §3.4). Excluded from the proxy's catch-all auth rule
 * because Stripe cannot send a Supabase session.
 *
 * The two drivers have deliberately different contracts:
 *
 * - `mock`: called by our own checkout page, so it authenticates the caller and
 *   only acts on that caller's own account.
 * - `stripe`: public, proved by the `stripe-signature` header over the **raw**
 *   body. `req.json()` must never run before verification.
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const gateway = getPaymentGateway();

  if (gateway.driver === 'mock') {
    return withAuth(req, async (ctx) => {
      const body = await req.json();
      return toNextResponse(await stripeController.handleWebhook(ctx, body));
    });
  }

  return withPublicTracing(req, async () => {
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');
    return toNextResponse(await stripeController.handleStripeWebhook(rawBody, signature));
  });
}
