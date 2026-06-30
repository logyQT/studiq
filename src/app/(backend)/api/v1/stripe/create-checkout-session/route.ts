import { NextRequest } from 'next/server';
import { stripeController } from '@/server/controllers/stripe.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await stripeController.createCheckoutSession(ctx, body));
  });
}
