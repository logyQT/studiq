import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { subscriptionPlanController } from '@/server/controllers/subscription-plan.controller';

export async function GET(_req: NextRequest) {
  return withAuth(_req, async (ctx) => {
    return toNextResponse(await subscriptionPlanController.getMyPersonalPlan(ctx));
  });
}
