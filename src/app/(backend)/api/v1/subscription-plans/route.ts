import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { subscriptionPlanController } from '@/server/controllers/subscription-plan.controller';

export async function GET(req: NextRequest) {
  const forAccountType = req.nextUrl.searchParams.get('for') ?? undefined;
  return toNextResponse(await subscriptionPlanController.listPublic(forAccountType));
}
