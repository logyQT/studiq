import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { ActivityQuerySchema } from '@studiq/server/models/activity.model';
import { type ActivityService, activityService } from '@studiq/server/services/activity.service';

export class ActivityController {
  constructor(private activityService: ActivityService) {}

  async getActivity(ctx: RequestContext, query: unknown): Promise<ControllerResponse> {
    const parsed = ActivityQuerySchema.safeParse(query);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.activityService.getClassActivity(ctx, parsed.data);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const activityController = wrapService(
  new ActivityController(activityService),
  'activity.controller',
);
