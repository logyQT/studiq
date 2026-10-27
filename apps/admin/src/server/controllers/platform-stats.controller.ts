import { DailyStatsQuerySchema } from '@admin/server/models/platform-stats.model';
import {
  type PlatformStatsService,
  platformStatsService,
} from '@admin/server/services/platform-stats.service';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';

export class PlatformStatsController {
  constructor(private platformStatsService: PlatformStatsService) {}

  async getPlatformStats(): Promise<ControllerResponse> {
    const result = await this.platformStatsService.getPlatformStats();
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getDailyStats(query: unknown): Promise<ControllerResponse> {
    const parsed = DailyStatsQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.platformStatsService.getDailyStats(parsed.data.days);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}

export const platformStatsController = wrapService(
  new PlatformStatsController(platformStatsService),
  'platform-stats.controller',
);
