import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateCheckoutSessionSchema,
  MockWebhookEventSchema,
} from '@studiq/server/models/stripe.model';
import {
  type MockStripeService,
  mockStripeService,
} from '@studiq/server/services/mock-stripe.service';

export class StripeController {
  constructor(private service: MockStripeService) {}

  async createCheckoutSession(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CreateCheckoutSessionSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const { planId, orgId } = parsed.data;

    const result = await this.service.createCheckoutSession(
      planId,
      ctx.accountType,
      ctx.userId,
      orgId,
    );

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async handleWebhook(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = MockWebhookEventSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const { type, session_id, plan_id, user_id, org_id } = parsed.data;

    // The mock webhook is called by the checkout page itself, so it may only
    // ever act on the caller's own account. This is the only place that reads
    // the body `user_id`; the service gets the authenticated id instead.
    if (user_id !== ctx.userId) return controllerResponse.error('FORBIDDEN');

    const result = await this.service.handleWebhook(
      { type, session_id, plan_id, org_id },
      ctx.accountType,
      ctx.userId,
    );

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success({ received: true });
  }

  async createPortalSession(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.createPortalSession(ctx.userId);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const stripeController = wrapService(
  new StripeController(mockStripeService),
  'stripe.controller',
);
