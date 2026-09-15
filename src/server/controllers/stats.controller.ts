import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { type StatsService, statsService } from '@/server/services/stats.service';

export class StatsController {
  constructor(private statsService: StatsService) {}

  async getTeacherStats(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.statsService.getTeacherStats(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getStudentStats(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.statsService.getStudentStats(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getActivity(
    ctx: RequestContext,
    range?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ControllerResponse> {
    const result = await this.statsService.getActivity(ctx, range, startDate, endDate);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getWeakPoints(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.statsService.getWeakPoints(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const statsController = wrapService(new StatsController(statsService), 'stats.controller');
