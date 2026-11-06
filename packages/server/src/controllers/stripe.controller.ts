import type { RequestContext } from '@studiq/authz';
import {
  controllerResponse,
  type ControllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import { getPaymentGateway } from '@studiq/server/lib/payment/payment-gateway.factory';
import { isFailure } from '@studiq/server/lib/service-result';
import { BillingPortalQuerySchema } from '@studiq/server/models/billing.model';
import {
  CreateCheckoutSessionSchema,
  MockWebhookEventSchema,
} from '@studiq/server/models/stripe.model';
import { type BillingService, billingService } from '@studiq/server/services/billing.service';

type GatewayProvider = () => PaymentGateway;

export class StripeController {
  private readonly gatewayProvider: GatewayProvider;

  /**
   * Lazy on purpose: the controller module is imported by `next build`, which
   * must not require the production Stripe configuration (#662 workstream B).
   */
  constructor(
    gateway: PaymentGateway | GatewayProvider,
    private readonly billing: BillingService,
  ) {
    this.gatewayProvider = typeof gateway === 'function' ? gateway : () => gateway;
  }

  private get gateway(): PaymentGateway {
    return this.gatewayProvider();
  }

  async createCheckoutSession(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CreateCheckoutSessionSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const { planKey, orgId, locale } = parsed.data;

    // Domain validation, owner resolution and the Stripe price map live in
    // BillingService (#662 §5.2). The body never supplies an amount or id.
    const result = await this.billing.startCheckout(ctx, planKey, orgId, locale ?? 'pl');

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async handleWebhook(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = MockWebhookEventSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const { type, session_id, plan_id, user_id, org_id } = parsed.data;

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

  /**
   * Real Stripe webhook (#662 §3.4). The route has already read the raw body
   * and `stripe-signature`; verification happens in the gateway/service. This
   * method never touches a Supabase session and never reads a body `user_id`.
   */
  async handleStripeWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<ControllerResponse> {
    const result = await this.gateway.handleWebhook({ kind: 'stripe', rawBody, signature });

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async createPortalSession(ctx: RequestContext, query: unknown): Promise<ControllerResponse> {
    const parsed = BillingPortalQuerySchema.safeParse(query);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    // The owner is resolved from `ctx` inside BillingService; the portal call
    // re-checks org admin membership and the customer mapping there.
    const result = await this.billing.createPortalSession(ctx, parsed.data.locale ?? 'pl');

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const stripeController = wrapService(
  new StripeController(getPaymentGateway, billingService),
  'stripe.controller',
);
