import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const CreateSpaceSchema = registry.register(
  'CreateFlashcardSpaceRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    description: z.string().optional(),
    flashcardIds: z.array(uuid).optional(),
  }),
);

export const UpdateSpaceSchema = registry.register(
  'UpdateFlashcardSpaceRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
    description: z.string().optional(),
    flashcardIds: z.array(uuid).optional(),
  }),
);

export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof UpdateSpaceSchema>;
