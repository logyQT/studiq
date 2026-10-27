import { platformStatsController } from '@admin/server/controllers/platform-stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  return toNextResponse(await platformStatsController.getPlatformStats());
}
