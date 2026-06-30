import { ActivityQuerySchema } from '@/server/models/activity.model';
import { activityService } from '@/server/services/activity.service';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class ActivityController {
  async getActivity(ctx: RequestContext, query: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = ActivityQuerySchema.safeParse(query);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const data = await activityService.getClassActivity(ctx, parsed.data);
      return { success: true, statusCode: 200, data };
    }, ctx);
  }
}

export const activityController = new ActivityController();
