import { subscriptionPlanController } from '@studiq/server/controllers/subscription-plan.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const forAccountType = req.nextUrl.searchParams.get('for') ?? undefined;
  return toNextResponse(await subscriptionPlanController.listPublic(forAccountType));
}
