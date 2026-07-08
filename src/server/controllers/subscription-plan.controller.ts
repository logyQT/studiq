import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import type { SubscriptionPlanService } from '@/server/services/subscription-plan.service';

export class SubscriptionPlanController {
  constructor(private subscriptionPlanService: SubscriptionPlanService) {}

  async listPublic(): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.listActive();
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getMyPlan(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.getMyPlan(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
