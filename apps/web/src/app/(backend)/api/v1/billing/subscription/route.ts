import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The shared billing read model (#662 §7.4). `/api/v1/billing/*` is already
 * covered by the authenticated API catch-all in `routes.config.ts`, but the
 * handler is still wrapped in `withAuth` because the proxy skips `/api/*`.
 */
export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await billingController.getSubscription(ctx)));
}
