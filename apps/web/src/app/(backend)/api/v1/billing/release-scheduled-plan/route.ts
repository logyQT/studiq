import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * Revert a scheduled downgrade ("keep current plan", #662 §2.5).
 *
 * The request has no body: the owner comes from `RequestContext` and the
 * customer/subscription from the authenticated mirror. Detaching the provider
 * schedule never writes an entitlement, so the plan only changes when a later
 * webhook says it should.
 */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) =>
    toNextResponse(await billingController.releaseScheduledPlan(ctx)),
  );
}
