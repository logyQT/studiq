import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { StudentInsightsQuerySchema } from '@studiq/server/models/student-insights.model';
import {
  type StudentInsightsService,
  studentInsightsService,
} from '@studiq/server/services/student-insights.service';

export class StudentInsightsController {
  constructor(private studentInsightsService: StudentInsightsService) {}

  async getInsights(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = StudentInsightsQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.studentInsightsService.getInsights(ctx, parsed.data.days);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}

export const studentInsightsController = wrapService(
  new StudentInsightsController(studentInsightsService),
  'student-insights.controller',
);
