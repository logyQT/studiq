import { billingController } from '@studiq/server/controllers/billing.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * Owner/customer/subscription/price are resolved server-side (#662 §9.2); the
 * body only carries the target plan key.
 */
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body: unknown = await req.json();
    return toNextResponse(await billingController.changePlan(ctx, body));
  });
}
