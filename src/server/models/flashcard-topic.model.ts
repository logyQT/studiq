import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateTopicSchema = registry.register(
  'CreateFlashcardTopicRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const UpdateTopicSchema = registry.register(
  'UpdateFlashcardTopicRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
  }),
);

export type CreateTopicInput = z.infer<typeof CreateTopicSchema>;
export type UpdateTopicInput = z.infer<typeof UpdateTopicSchema>;
