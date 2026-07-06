import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { subscriptionPlanService } from '@/server/services';

export class SubscriptionPlanController {
  async listPublic(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const plans = await subscriptionPlanService.listActive();
      return { success: true, statusCode: 200, data: plans };
    });
  }

  async getMyPlan(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const plan = await subscriptionPlanService.getMyPlan(ctx);
      return { success: true, statusCode: 200, data: plan };
    }, ctx);
  }
}

export const subscriptionPlanController = new SubscriptionPlanController();
