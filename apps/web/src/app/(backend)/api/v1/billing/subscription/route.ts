import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNoStoreNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

// The shared billing read model (#662 §7.4). The proxy returns for every
// `/api/*` request before it reaches a handler, so `withAuth` below is the only
// gate.
export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) =>
    toNoStoreNextResponse(await billingController.getSubscription(ctx)),
  );
}
