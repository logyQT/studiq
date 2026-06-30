import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { stripeController } from '@/server/controllers/stripe.controller';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await stripeController.createCheckoutSession(ctx, body));
  });
}
