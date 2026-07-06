import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { subscriptionPlanController } from '@/server/controllers/subscription-plan.controller';

export async function GET(_req: NextRequest) {
  return toNextResponse(await subscriptionPlanController.listPublic());
}
