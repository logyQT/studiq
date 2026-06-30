import { mockStripeService } from '@/server/services/mock-stripe.service';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class StripeController {
  async createCheckoutSession(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const { planId, orgId } = body as Record<string, string | undefined>;

      if (!planId) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const result = await mockStripeService.createCheckoutSession(
        planId,
        ctx.userId,
        orgId,
      );

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async handleWebhook(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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

      await mockStripeService.handleWebhook({ type, session_id, plan_id, user_id, org_id });
      return { success: true, statusCode: 200, data: { received: true } };
    });
  }

  async createPortalSession(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const result = await mockStripeService.createPortalSession(ctx.userId);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const stripeController = new StripeController();
