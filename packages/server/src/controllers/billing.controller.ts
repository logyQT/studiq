import type { RequestContext } from '@studiq/authz';
import {
  controllerResponse,
  type ControllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  BillingScopeQuerySchema,
  CancelSubscriptionSchema,
  ChangePlanSchema,
  ReconcileCheckoutSchema,
} from '@studiq/server/models/billing.model';
import { type BillingService, billingService } from '@studiq/server/services/billing.service';

/**
 * Read model and subscription actions shared by the three dashboards (#662
 * phase 4). Every method delegates authorization to `BillingService`, which
 * resolves the owner from `RequestContext` and requires `org.billing.manage` for
 * an org owner.
 *
 * A request may name `scope: 'personal'` (#1493 follow-up). That selects the
 * caller's own subscription on `/app/billing` and `/edu/billing`; it is a
 * server-side literal, never an owner id, and an unknown value is a 422.
 */
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * The optional `?scope=personal` shared by the query-scoped actions. An
   * unknown value is a 422, not a silent fallback to the org owner.
   */
  private personalScope(
    query: unknown,
  ): { success: true; personal: boolean } | { success: false; response: ControllerResponse } {
    const parsed = BillingScopeQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return {
        success: false,
        response: controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues),
      };
    }
    return { success: true, personal: parsed.data.scope === 'personal' };
  }

  async getSubscription(ctx: RequestContext, query: unknown = {}): Promise<ControllerResponse> {
    const scope = this.personalScope(query);
    if (!scope.success) return scope.response;

    const result = await this.billing.getSubscription(ctx, scope.personal);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async changePlan(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = ChangePlanSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.billing.changePlan(
      ctx,
      parsed.data.planKey,
      parsed.data.scope === 'personal',
    );
    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async cancelSubscription(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CancelSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.billing.cancelSubscription(
      ctx,
      parsed.data.cancel,
      parsed.data.scope === 'personal',
    );
    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  /**
   * Revert a scheduled downgrade ("keep current plan"). `?scope=personal`
   * selects the caller's own subscription; the customer and subscription still
   * come from the context and the mirror, never from the client.
   */
  async releaseScheduledPlan(
    ctx: RequestContext,
    query: unknown = {},
  ): Promise<ControllerResponse> {
    const scope = this.personalScope(query);
    if (!scope.success) return scope.response;

    const result = await this.billing.releaseScheduledChange(ctx, scope.personal);
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
