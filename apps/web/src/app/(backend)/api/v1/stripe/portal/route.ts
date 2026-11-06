import { stripeController } from '@studiq/server/controllers/stripe.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const locale = req.nextUrl.searchParams.get('locale') || undefined;

  return withAuth(req, async (ctx) => {
    return toNextResponse(await stripeController.createPortalSession(ctx, { locale }));
  });
}
