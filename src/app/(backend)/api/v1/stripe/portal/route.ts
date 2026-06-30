import { NextRequest } from 'next/server';
import { stripeController } from '@/server/controllers/stripe.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await stripeController.createPortalSession(ctx));
  });
}
