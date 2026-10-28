import { platformStatsController } from '@admin/server/controllers/platform-stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const query = Object.fromEntries(new URL(req.url).searchParams);
  const response = toNextResponse(await platformStatsController.getDailyStats(query));
  // Aggregates over every tenant: never cached by a browser or an intermediary.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
