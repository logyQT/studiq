import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateClassroomSchema = registry.register(
  'CreateClassroomRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    slug: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(24, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
  }),
);

export type CreateClassroomInput = z.infer<typeof CreateClassroomSchema>;
