import { subscriptionPlanController } from '@studiq/server/controllers/subscription-plan.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') ?? undefined;
  const audience = req.nextUrl.searchParams.get('audience') ?? undefined;
  return toNextResponse(await subscriptionPlanController.listPublic({ scope, audience }));
}
