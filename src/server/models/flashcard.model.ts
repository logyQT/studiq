import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const CreateFlashcardSchema = registry.register(
  'CreateFlashcardRequest',
  z.object({
    topicIds: z.array(uuid).optional(),
    spaceIds: z.array(uuid).optional(),
    front: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    back: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const BulkCreateFlashcardsSchema = registry.register(
  'BulkCreateFlashcardsRequest',
  z.object({
    topicIds: z.array(uuid).optional(),
    spaceIds: z.array(uuid).optional(),
    cards: z
      .array(
        z.object({
          front: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
          back: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
        }),
      )
      .min(1),
  }),
);

export const UpdateFlashcardSchema = registry.register(
  'UpdateFlashcardRequest',
  z.object({
    topicIds: z.array(uuid).optional(),
    spaceIds: z.array(uuid).optional(),
    front: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
    back: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
  }),
);

export type CreateFlashcardInput = z.infer<typeof CreateFlashcardSchema>;
export type BulkCreateFlashcardsInput = z.infer<typeof BulkCreateFlashcardsSchema>;
export type UpdateFlashcardInput = z.infer<typeof UpdateFlashcardSchema>;
