import { statsService } from '@/server/services';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

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
}

export const statsController = new StatsController();
