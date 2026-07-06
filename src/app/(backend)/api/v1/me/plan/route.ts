import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { subscriptionPlanController } from '@/server/controllers/subscription-plan.controller';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await subscriptionPlanController.getMyPlan(ctx));
  });
}
