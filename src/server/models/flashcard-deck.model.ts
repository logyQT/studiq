import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateSpaceSchema = registry.register(
  'CreateFlashcardSpaceRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    flashcardIds: z.array(z.uuid()).optional(),
  }),
);

export const UpdateSpaceSchema = registry.register(
  'UpdateFlashcardSpaceRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    flashcardIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
  }),
);

export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof UpdateSpaceSchema>;
