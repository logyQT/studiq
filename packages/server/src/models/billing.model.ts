import { registry, z } from '@studiq/server/lib/zod';
import { OptionalLocaleSchema } from './locale.model';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';

/**
 * The owner scope a billing request may ask for (#1493 follow-up).
 *
 * `/app/billing` and `/edu/billing` are the personal surfaces: they must read
 * and act on the caller's **own** subscription even when the caller holds
 * `org.billing.manage` in the active organization. A request that names no
 * scope keeps the org-first owner (the `/manage/billing` dashboard). Only the
 * literal is accepted, so the client can select `personal` but can never name
 * another owner.
 */
export const BillingScopeSchema = z
  .literal('personal', { error: ValidationErrorCode.INVALID_INPUT })
  .optional();

/** `?scope=personal` on the billing read. An unknown scope is a 422. */
export const BillingScopeQuerySchema = registry.register(
  'BillingScopeQuery',
  z.object({
    scope: BillingScopeSchema,
  }),
);

export type BillingScopeQuery = z.infer<typeof BillingScopeQuerySchema>;

/**
 * Query of `GET /api/v1/stripe/portal` (#662 §7.1). The owner is never part of
 * the request: it comes from the authenticated context and, on a personal
 * surface, the `scope` literal. Only the render language is client-controlled,
 * and only as a two-value enum.
 */
export const BillingPortalQuerySchema = registry.register(
  'BillingPortalQuery',
  z.object({
    locale: OptionalLocaleSchema,
    scope: BillingScopeSchema,
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
    scope: BillingScopeSchema,
  }),
);

/**
 * `POST /api/v1/billing/change-plan/preview` body. The same resolution and
 * validation as the confirmed change; the response is a read-only amount.
 */
export const ChangePlanPreviewSchema = registry.register(
  'ChangePlanPreviewRequest',
  z.object({
    planKey: z
      .string()
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    scope: BillingScopeSchema,
  }),
);

/**
 * `POST /api/v1/billing/cancel` body (#662 §7.3): `cancel: true` schedules
 * cancellation at period end, `false` reactivates before it takes effect.
 */
export const CancelSubscriptionSchema = registry.register(
  'CancelSubscriptionRequest',
  z.object({
    cancel: z.boolean({ error: ValidationErrorCode.REQUIRED }),
    scope: BillingScopeSchema,
  }),
);

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
