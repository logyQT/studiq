import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateUniversitySchema = registry.register(
  'CreateUniversityRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.NAME_REQUIRED })
      .min(3, { error: ValidationErrorCode.NAME_TOO_SHORT }),
    slug: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .min(2, { error: ValidationErrorCode.INVALID_INPUT })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT }),
  }),
);

export type CreateUniversityInput = z.infer<typeof CreateUniversitySchema>;
