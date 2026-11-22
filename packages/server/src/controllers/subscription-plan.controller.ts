import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import type { PlanCatalogFilters } from '@studiq/server/services/subscription-plan.service';
import {
  type SubscriptionPlanService,
  subscriptionPlanService,
} from '@studiq/server/services/subscription-plan.service';

export class SubscriptionPlanController {
  constructor(private service: SubscriptionPlanService) {}

  /** No filters returns every active plan — the public pricing behaviour (D34). */
  async listPublic(filters: PlanCatalogFilters = {}): Promise<ControllerResponse> {
    const result = await this.service.listActive(filters);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getMyPlan(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getMyPlan(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getByKey(key: string): Promise<ControllerResponse> {
    const result = await this.service.getByKey(key);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getMyPersonalPlan(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getPersonalPlan(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
export const subscriptionPlanController = wrapService(
  new SubscriptionPlanController(subscriptionPlanService),
  'subscription-plan.controller',
);
