import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateFlashcardSchema = registry.register(
  'CreateFlashcardRequest',
  z.object({
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    deckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    front: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG }),
    back: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export const BulkCreateFlashcardsSchema = registry.register(
  'BulkCreateFlashcardsRequest',
  z.object({
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    deckIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    cards: z
      .array(
        z.object({
          front: z
            .string({ error: ValidationErrorCode.REQUIRED })
            .nonempty({ error: ValidationErrorCode.REQUIRED })
            .min(1, { error: ValidationErrorCode.TOO_SHORT })
            .max(255, { error: ValidationErrorCode.TOO_LONG }),
          back: z
            .string({ error: ValidationErrorCode.REQUIRED })
            .nonempty({ error: ValidationErrorCode.REQUIRED })
            .min(1, { error: ValidationErrorCode.TOO_SHORT })
            .max(255, { error: ValidationErrorCode.TOO_LONG }),
        }),
      )
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const UpdateFlashcardSchema = registry.register(
  'UpdateFlashcardRequest',
  z.object({
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    deckIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    front: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    back: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
  }),
);

export type CreateFlashcardInput = z.infer<typeof CreateFlashcardSchema>;
export type BulkCreateFlashcardsInput = z.infer<typeof BulkCreateFlashcardsSchema>;
export type UpdateFlashcardInput = z.infer<typeof UpdateFlashcardSchema>;
