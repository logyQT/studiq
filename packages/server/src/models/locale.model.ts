import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { z } from '@studiq/server/lib/zod';

/**
 * Optional language for text generated for a reader (`pl` when omitted).
 *
 * Shared by the write endpoints that let the client pick the render language
 * (`#604`, `#662`) so the enum and its validation error live in one place.
 */
export const OptionalLocaleSchema = z
  .enum(['pl', 'en'], { error: ValidationErrorCode.INVALID_INPUT })
  .optional();
