import { createListQuerySchema } from '@studiq/server/lib/query-list';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const CreateTopicSchema = registry.register(
  'CreateTopicRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    visibility: z.enum(['personal', 'group']).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
  }),
);

export const UpdateTopicSchema = registry.register(
  'UpdateTopicRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    visibility: z.enum(['personal', 'group']).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
  }),
);

export const BatchDeleteTopicSchema = registry.register(
  'BatchDeleteTopicRequest',
  z.object({
    ids: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const TopicListQuerySchema = registry.register(
  'TopicListQuery',
  createListQuerySchema({
    sortColumns: ['created_at', 'name'] as const,
    maxLimit: 500,
    defaultLimit: 50,
  }).extend({
    owner: z.enum(['all', 'mine', 'shared', 'group']).optional().default('all'),
  }),
);

export const BulkCreateTopicSchema = registry.register(
  'BulkCreateTopicRequest',
  z.object({
    topics: z
      .array(
        z.object({
          name: z
            .string({ error: ValidationErrorCode.REQUIRED })
            .nonempty({ error: ValidationErrorCode.REQUIRED })
            .min(1, { error: ValidationErrorCode.TOO_SHORT })
            .max(64, { error: ValidationErrorCode.TOO_LONG }),
          visibility: z.enum(['personal', 'group']).optional(),
        }),
      )
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export type CreateTopicInput = z.infer<typeof CreateTopicSchema>;
export type UpdateTopicInput = z.infer<typeof UpdateTopicSchema>;
export type BatchDeleteTopicInput = z.infer<typeof BatchDeleteTopicSchema>;
export type BulkCreateTopicInput = z.infer<typeof BulkCreateTopicSchema>;
export type TopicListQuery = z.infer<typeof TopicListQuerySchema>;

export interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
  created_by: string;
  created_at?: string;
  visibility?: 'personal' | 'group';
}
