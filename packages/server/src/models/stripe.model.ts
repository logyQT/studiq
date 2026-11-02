import { registry, z } from '@studiq/server/lib/zod';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';

/**
 * Body of `POST /api/v1/stripe/create-checkout-session`. `orgId` is only sent
 * for an organization plan; the caller identity comes from the session, never
 * from the body.
 */
export const CreateCheckoutSessionSchema = registry.register(
  'CreateCheckoutSessionRequest',
  z.object({
    planId: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    orgId: z.string().optional(),
  }),
);
export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionSchema>;

/**
 * Body of the (mock) Stripe webhook: the fields of a
 * `checkout.session.completed` event the service is allowed to read.
 */
export const MockWebhookEventSchema = registry.register(
  'MockWebhookEventRequest',
  z.object({
    type: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    session_id: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    plan_id: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    user_id: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
    org_id: z.string().optional(),
  }),
);
export type MockWebhookEventInput = z.infer<typeof MockWebhookEventSchema>;
