import { subscriptionPlanController } from '@studiq/server/controllers/subscription-plan.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(_req: NextRequest) {
  return withAuth(_req, async (ctx) => {
    return toNextResponse(await subscriptionPlanController.getMyPersonalPlan(ctx));
  });
}
