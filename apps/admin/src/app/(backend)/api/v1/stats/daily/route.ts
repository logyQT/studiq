import { platformStatsController } from '@admin/server/controllers/platform-stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return toNextResponse(await platformStatsController.getDailyStats(query));
}
