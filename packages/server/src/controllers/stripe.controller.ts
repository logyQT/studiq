import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  type MockStripeService,
  mockStripeService,
} from '@studiq/server/services/mock-stripe.service';

export class StripeController {
  constructor(private mockStripeService: MockStripeService) {}

  async createCheckoutSession(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const { planId, orgId } = body as Record<string, string | undefined>;

    if (!planId) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.mockStripeService.createCheckoutSession(
      planId,
      ctx.accountType,
      ctx.userId,
      orgId,
    );

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async handleWebhook(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const event = body as Record<string, unknown>;
    const { type, session_id, plan_id, user_id, org_id } = event as {
      type: string;
      session_id: string;
      plan_id: string;
      user_id: string;
      org_id?: string;
    };

    if (!type || !session_id || !plan_id || !user_id) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    // The mock webhook is called by the checkout page itself, so it may only
    // ever act on the caller's own account.
    if (user_id !== ctx.userId) return controllerResponse.error('FORBIDDEN');

    const result = await this.mockStripeService.handleWebhook(
      {
        type,
        session_id,
        plan_id,
        user_id,
        org_id,
      },
      ctx.accountType,
    );

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success({ received: true });
  }

  async createPortalSession(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.mockStripeService.createPortalSession(ctx.userId);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const stripeController = wrapService(
  new StripeController(mockStripeService),
  'stripe.controller',
);
