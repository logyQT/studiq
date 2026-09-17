import { subscriptionPlanController } from '@studiq/server/controllers/subscription-plan.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return toNextResponse(await subscriptionPlanController.getByKey(key));
}
