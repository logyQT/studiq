import { registry, z } from '@studiq/server/lib/zod';
import { OptionalLocaleSchema } from './locale.model';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';

/**
 * `POST /api/v1/stripe/create-checkout-session` body (#662 §5.1).
 *
 * The field is a catalog plan **key** (`spark`, `hub`, …), not a UUID. Amounts,
 * currencies, price ids and customer ids are resolved server-side and are not
 * accepted from the client.
 */
export const CreateCheckoutSessionSchema = registry.register(
  'CreateCheckoutSessionRequest',
  z.object({
    planKey: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    orgId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    locale: OptionalLocaleSchema,
  }),
);

/**
 * Body of the (mock) Stripe webhook: the fields of a
 * `checkout.session.completed` event the service is allowed to read. The
 * caller identity is checked against `ctx.userId`, never trusted from here.
 */
export const MockWebhookEventSchema = registry.register(
  'MockWebhookEventRequest',
  z.object({
    type: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    session_id: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    plan_id: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    user_id: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    org_id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  }),
);
