import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import { isFailure } from '@/lib/service-result';
import {
  type SubscriptionPlanService,
  subscriptionPlanService,
} from '@/server/services/subscription-plan.service';

export class SubscriptionPlanController {
  constructor(private subscriptionPlanService: SubscriptionPlanService) {}

  async listPublic(forAccountType?: string): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.listActive(forAccountType);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getMyPlan(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.getMyPlan(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getByKey(key: string): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.getByKey(key);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getMyPersonalPlan(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.getPersonalPlan(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
export const subscriptionPlanController = wrapService(
  new SubscriptionPlanController(subscriptionPlanService),
  'subscription-plan.controller',
);
