import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { stripeController } from '@/server/controllers/stripe.controller';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await stripeController.createPortalSession(ctx));
  });
}
