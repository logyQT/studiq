import type { RequestContext } from '@studiq/authz';
import {
  controllerResponse,
  type ControllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CancelSubscriptionSchema,
  ChangePlanSchema,
  ReconcileCheckoutSchema,
} from '@studiq/server/models/billing.model';
import { type BillingService, billingService } from '@studiq/server/services/billing.service';

/**
 * Read model and subscription actions shared by the three dashboards (#662
 * phase 4). Every method delegates authorization to `BillingService`, which
 * resolves the owner from `RequestContext` and re-checks org admin membership.
 */
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  async getSubscription(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.billing.getSubscription(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async changePlan(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = ChangePlanSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.billing.changePlan(ctx, parsed.data.planKey);
    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async cancelSubscription(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CancelSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.billing.cancelSubscription(ctx, parsed.data.cancel);
    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async reconcileCheckout(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = ReconcileCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.billing.reconcileCheckout(ctx, parsed.data.sessionId);
    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}

export const billingController = wrapService(
  new BillingController(billingService),
  'billing.controller',
);
