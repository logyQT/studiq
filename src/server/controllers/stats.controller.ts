import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { statsService } from '@/server/services';

export class StatsController {
  async getTeacherStats(ctx: RequestContext, subjectId?: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const stats = await statsService.getTeacherStats(ctx, subjectId);

      return { success: true, statusCode: 200, data: stats };
    }, ctx);
  }

  async getStudentStats(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const stats = await statsService.getStudentStats(ctx);

      return { success: true, statusCode: 200, data: stats };
    }, ctx);
  }

  async getActivity(
    ctx: RequestContext,
    range?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = await statsService.getActivity(ctx, range, startDate, endDate);
      return { success: true, statusCode: 200, data };
    }, ctx);
  }

  async getWeakPoints(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = await statsService.getWeakPoints(ctx);
      return { success: true, statusCode: 200, data };
    }, ctx);
  }
}

export const statsController = new StatsController();
