import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  type AssessmentReviewService,
  assessmentReviewService,
} from '@studiq/server/services/assessment-review.service';

export class AssessmentReviewController {
  constructor(private service: AssessmentReviewService) {}

  async review(
    id: string,
    attemptId: string | undefined,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const result = await this.service.review(id, attemptId, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}

export const assessmentReviewController = wrapService(
  new AssessmentReviewController(assessmentReviewService),
  'assessment-review.controller',
);
