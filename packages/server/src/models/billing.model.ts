import { registry, z } from '@studiq/server/lib/zod';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';

/**
 * Query of `GET /api/v1/stripe/portal` (#662 §7.1). The owner is never part of
 * the request: it comes from the authenticated context. Only the render
 * language is client-controlled, and only as a two-value enum.
 */
export const BillingPortalQuerySchema = registry.register(
  'BillingPortalQuery',
  z.object({
    locale: z.enum(['pl', 'en'], { error: ValidationErrorCode.INVALID_INPUT }).optional(),
  }),
);

export type BillingPortalQuery = z.infer<typeof BillingPortalQuerySchema>;

/**
 * `POST /api/v1/billing/change-plan` body (#662 §2.5). Only the target plan key
 * is client-controlled: the owner, customer, subscription and price are all
 * resolved server-side from the authenticated context and the catalog.
 */
export const ChangePlanSchema = registry.register(
  'ChangePlanRequest',
  z.object({
    planKey: z
      .string()
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export type ChangePlanBody = z.infer<typeof ChangePlanSchema>;

/**
 * `POST /api/v1/billing/cancel` body (#662 §7.3): `cancel: true` schedules
 * cancellation at period end, `false` reactivates before it takes effect.
 */
export const CancelSubscriptionSchema = registry.register(
  'CancelSubscriptionRequest',
  z.object({
    cancel: z.boolean({ error: ValidationErrorCode.REQUIRED }),
  }),
);

export type CancelSubscriptionBody = z.infer<typeof CancelSubscriptionSchema>;

/**
 * `POST /api/v1/billing/reconcile` body (#662 X6). The Checkout Session id from
 * `success_url`; ownership is verified server-side before any activation.
 */
export const ReconcileCheckoutSchema = registry.register(
  'ReconcileCheckoutRequest',
  z.object({
    sessionId: z
      .string()
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(255, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export type ReconcileCheckoutBody = z.infer<typeof ReconcileCheckoutSchema>;
