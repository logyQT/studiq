import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  type StudentOverviewService,
  studentOverviewService,
} from '@studiq/server/services/student-overview.service';

export class StudentOverviewController {
  constructor(private studentOverviewService: StudentOverviewService) {}

  async getOverview(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.studentOverviewService.getOverview(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}

export const studentOverviewController = wrapService(
  new StudentOverviewController(studentOverviewService),
  'student-overview.controller',
);
