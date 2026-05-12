import { z, registry } from '@/lib/zod';
import { AppErrorCode } from '@/lib/errors';

const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const CreateFlashcardSchema = registry.register(
  'CreateFlashcardRequest',
  z.object({
    topicIds: z.array(uuid).optional(),
    front: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
    back: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
  }),
);

export const BulkCreateFlashcardsSchema = registry.register(
  'BulkCreateFlashcardsRequest',
  z.object({
    topicIds: z.array(uuid).optional(),
    cards: z.array(
      z.object({
        front: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
        back: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
      }),
    ).min(1),
  }),
);

export const UpdateFlashcardSchema = registry.register(
  'UpdateFlashcardRequest',
  z.object({
    topicIds: z.array(uuid).optional(),
    front: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }).optional(),
    back: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }).optional(),
  }),
);

export const CreateTopicSchema = registry.register(
  'CreateFlashcardTopicRequest',
  z.object({
    name: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
  }),
);

export const UpdateTopicSchema = registry.register(
  'UpdateFlashcardTopicRequest',
  z.object({
    name: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }).optional(),
  }),
);

export const CreateSpaceSchema = registry.register(
  'CreateFlashcardSpaceRequest',
  z.object({
    name: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
    description: z.string().optional(),
    flashcardIds: z.array(uuid).optional(),
  }),
);

export const UpdateSpaceSchema = registry.register(
  'UpdateFlashcardSpaceRequest',
  z.object({
    name: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }).optional(),
    description: z.string().optional(),
    flashcardIds: z.array(uuid).optional(),
  }),
);

export type CreateFlashcardInput = z.infer<typeof CreateFlashcardSchema>;
export type BulkCreateFlashcardsInput = z.infer<typeof BulkCreateFlashcardsSchema>;
export type UpdateFlashcardInput = z.infer<typeof UpdateFlashcardSchema>;
export type CreateTopicInput = z.infer<typeof CreateTopicSchema>;
export type UpdateTopicInput = z.infer<typeof UpdateTopicSchema>;
export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof UpdateSpaceSchema>;
