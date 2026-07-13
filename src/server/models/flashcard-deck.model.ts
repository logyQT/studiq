import { createListQuerySchema } from '@/lib/query-list';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateDeckSchema = registry.register(
  'CreateFlashcardDeckRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(128, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    flashcardIds: z.array(z.uuid()).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
    visibility: z.enum(['personal', 'group']).optional(),
  }),
);

export const UpdateDeckSchema = registry.register(
  'UpdateFlashcardDeckRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(128, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    flashcardIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
    suspended: z.boolean().optional(),
    visibility: z.enum(['personal', 'group']).optional(),
  }),
);

export const BatchDeleteDeckSchema = registry.register(
  'BatchDeleteDeckRequest',
  z.object({
    ids: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const DeckListQuerySchema = registry.register(
  'DeckListQuery',
  createListQuerySchema({
    sortColumns: ['created_at', 'updated_at', 'name'] as const,
    maxLimit: 500,
  }).extend({
    owner: z.enum(['all', 'mine', 'group', 'shared']).optional().default('all'),
    includeSuspended: z.coerce.boolean().optional().default(false),
  }),
);

export const BulkCreateDeckSchema = registry.register(
  'BulkCreateDeckRequest',
  z.object({
    decks: z
      .array(
        z.object({
          name: z
            .string({ error: ValidationErrorCode.REQUIRED })
            .nonempty({ error: ValidationErrorCode.REQUIRED })
            .min(1, { error: ValidationErrorCode.TOO_SHORT })
            .max(128, { error: ValidationErrorCode.TOO_LONG }),
          description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
          visibility: z.enum(['personal', 'group']).optional(),
        }),
      )
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;
export type UpdateDeckInput = z.infer<typeof UpdateDeckSchema>;
export type BatchDeleteDeckInput = z.infer<typeof BatchDeleteDeckSchema>;
export type BulkCreateDeckInput = z.infer<typeof BulkCreateDeckSchema>;
export const BatchToggleSuspendSchema = registry.register(
  'BatchToggleSuspendRequest',
  z.object({
    deckIds: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
    suspended: z.boolean(),
  }),
);

export type BatchToggleSuspendInput = z.infer<typeof BatchToggleSuspendSchema>;
export type DeckListQuery = z.infer<typeof DeckListQuerySchema>;

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
  created_by: string;
  organization_id: string;
  updated_at?: string;
  suspended?: boolean;
  visibility?: 'personal' | 'group';
  groupIds?: string[];
}
