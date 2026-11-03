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
