import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  TeacherDashboardQuerySchema,
  TeacherStatsQuerySchema,
} from '@studiq/server/models/stats.model';
import { type StatsService, statsService } from '@studiq/server/services/stats.service';

export class StatsController {
  constructor(private service: StatsService) {}

  async getTeacherStats(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = TeacherStatsQuerySchema.safeParse(query);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.getTeacherStats(ctx, parsed.data);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getStudentStats(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getStudentStats(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getTeacherQuizStats(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getTeacherQuizStats(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getActivity(
    ctx: RequestContext,
    range?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ControllerResponse> {
    const result = await this.service.getActivity(ctx, range, startDate, endDate);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getWeakPoints(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getWeakPoints(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getTeacherGroupPerformance(
    query: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = TeacherDashboardQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.getTeacherGroupPerformance(ctx, parsed.data.days);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getTeacherActivityFeed(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = TeacherDashboardQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.getTeacherActivityFeed(ctx, parsed.data.limit);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const statsController = wrapService(new StatsController(statsService), 'stats.controller');
