import { registry, z } from '@studiq/server/lib/zod';
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
    locale: z.enum(['pl', 'en'], { error: ValidationErrorCode.INVALID_INPUT }).optional(),
  }),
);

export type CreateCheckoutSessionBody = z.infer<typeof CreateCheckoutSessionSchema>;
