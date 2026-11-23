import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { requireEntitlement } from '@studiq/server/lib/entitlements';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { StudentInsightsQuerySchema } from '@studiq/server/models/student-insights.model';
import {
  type StudentInsightsService,
  studentInsightsService,
} from '@studiq/server/services/student-insights.service';

export class StudentInsightsController {
  constructor(private service: StudentInsightsService) {}

  async getInsights(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    // Study-time/retention/mastery insights are the diagnostic half of the
    // stats surface (phase 5d): the paid `stats.insights` gate is the first
    // statement — this method had no permission check, and none is added.
    await requireEntitlement(ctx, 'stats.insights');
    const parsed = StudentInsightsQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.getInsights(ctx, parsed.data.days);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}

export const studentInsightsController = wrapService(
  new StudentInsightsController(studentInsightsService),
  'student-insights.controller',
);
