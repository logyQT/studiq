import { platformStatsController } from '@admin/server/controllers/platform-stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  const response = toNextResponse(await platformStatsController.getPlatformStats());
  // Aggregates over every tenant: never cached by a browser or an intermediary.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
