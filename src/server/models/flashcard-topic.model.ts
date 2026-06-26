import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateTopicSchema = registry.register(
  'CreateFlashcardTopicRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export const UpdateTopicSchema = registry.register(
  'UpdateFlashcardTopicRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
  }),
);

export const BatchDeleteTopicSchema = registry.register(
  'BatchDeleteTopicRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const TopicListQuerySchema = registry.register(
  'TopicListQuery',
  z.object({
    q: z.string().optional(),
    owner: z.enum(['all', 'mine', 'shared']).optional().default('all'),
    sortBy: z.enum(['created_at', 'name']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  }),
);

export type CreateTopicInput = z.infer<typeof CreateTopicSchema>;
export type UpdateTopicInput = z.infer<typeof UpdateTopicSchema>;
export type BatchDeleteTopicInput = z.infer<typeof BatchDeleteTopicSchema>;
export type TopicListQuery = z.infer<typeof TopicListQuerySchema>;
