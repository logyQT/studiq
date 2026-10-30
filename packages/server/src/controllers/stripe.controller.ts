import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import { getPaymentGateway } from '@studiq/server/lib/payment/payment-gateway.factory';
import { isFailure } from '@studiq/server/lib/service-result';

export class StripeController {
  constructor(private readonly gateway: PaymentGateway) {}

  async createCheckoutSession(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const { planId, orgId } = body as Record<string, string | undefined>;

    if (!planId) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.gateway.createCheckoutSession({
      userId: ctx.userId,
      accountType: ctx.accountType,
      planKey: planId,
      ...(orgId ? { orgId } : {}),
      // Phase 1: the mock ignores it. Phase 2 replaces this with the
      // deterministic owner+plan+time-bucket key that collapses double clicks.
      idempotencyKey: randomUUID(),
    });

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
    // ever act on the caller's own account. This is the only place that reads
    // the body `user_id`; the gateway gets the authenticated id instead.
    if (user_id !== ctx.userId) return controllerResponse.error('FORBIDDEN');

    const result = await this.gateway.handleWebhook({
      kind: 'mock',
      ctx,
      event: {
        type,
        session_id,
        plan_id,
        ...(org_id ? { org_id } : {}),
      },
    });

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async createPortalSession(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.gateway.createPortalSession({
      userId: ctx.userId,
      accountType: ctx.accountType,
      activeOrgId: ctx.activeOrgId,
    });

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const stripeController = wrapService(
  new StripeController(getPaymentGateway()),
  'stripe.controller',
);
