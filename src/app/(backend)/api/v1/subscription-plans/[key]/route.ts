import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { subscriptionPlanController } from '@/server/controllers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return toNextResponse(await subscriptionPlanController.getByKey(key));
}
