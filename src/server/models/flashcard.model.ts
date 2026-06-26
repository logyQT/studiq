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
      .max(5000, { error: ValidationErrorCode.TOO_LONG }),
    back: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(5000, { error: ValidationErrorCode.TOO_LONG }),
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
            .max(5000, { error: ValidationErrorCode.TOO_LONG }),
          back: z
            .string({ error: ValidationErrorCode.REQUIRED })
            .nonempty({ error: ValidationErrorCode.REQUIRED })
            .min(1, { error: ValidationErrorCode.TOO_SHORT })
            .max(5000, { error: ValidationErrorCode.TOO_LONG }),
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
      .max(5000, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    back: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(5000, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
  }),
);

export type CreateFlashcardInput = z.infer<typeof CreateFlashcardSchema>;
export type BulkCreateFlashcardsInput = z.infer<typeof BulkCreateFlashcardsSchema>;
export type UpdateFlashcardInput = z.infer<typeof UpdateFlashcardSchema>;

export const LinkFlashcardSchema = registry.register(
  'LinkFlashcardRequest',
  z.object({
    deckIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const CopyFlashcardSchema = registry.register(
  'CopyFlashcardRequest',
  z.object({
    targetDeckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export const BatchDeleteSchema = registry.register(
  'BatchDeleteRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const BatchLinkSchema = registry.register(
  'BatchLinkRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
    deckIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const UnlinkFlashcardSchema = registry.register(
  'UnlinkFlashcardRequest',
  z.object({
    deckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export const BatchUnlinkSchema = registry.register(
  'BatchUnlinkRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
    deckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export const BatchTopicsSchema = registry.register(
  'BatchTopicsRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    operation: z.enum(['add', 'remove', 'set']).default('set'),
  }),
);

export const BatchMoveSchema = registry.register(
  'BatchMoveRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
    sourceDeckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    targetDeckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export const BatchCopySchema = registry.register(
  'BatchCopyRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
    targetDeckId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export const FlashcardSchema = registry.register(
  'Flashcard',
  z.object({
    id: z.string().uuid(),
    front: z.string(),
    back: z.string(),
    created_by: z.string().uuid(),
    university_id: z.string().uuid().nullable().optional(),
    created_at: z.string().optional(),
  }),
);

export type Flashcard = z.infer<typeof FlashcardSchema>;
export type LinkFlashcardInput = z.infer<typeof LinkFlashcardSchema>;
export type CopyFlashcardInput = z.infer<typeof CopyFlashcardSchema>;
export type BatchDeleteInput = z.infer<typeof BatchDeleteSchema>;
export type BatchLinkInput = z.infer<typeof BatchLinkSchema>;
export type UnlinkFlashcardInput = z.infer<typeof UnlinkFlashcardSchema>;
export type BatchUnlinkInput = z.infer<typeof BatchUnlinkSchema>;
export type BatchTopicsInput = z.infer<typeof BatchTopicsSchema>;
export type BatchMoveInput = z.infer<typeof BatchMoveSchema>;
export type BatchCopyInput = z.infer<typeof BatchCopySchema>;
