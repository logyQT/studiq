import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateDeckSchema = registry.register(
  'CreateFlashcardDeckRequest',
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

export const UpdateDeckSchema = registry.register(
  'UpdateFlashcardDeckRequest',
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

export const BatchDeleteDeckSchema = registry.register(
  'BatchDeleteDeckRequest',
  z.object({
    ids: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const DeckListQuerySchema = registry.register(
  'DeckListQuery',
  z.object({
    q: z.string().optional(),
    owner: z.enum(['all', 'mine', 'org', 'shared']).optional().default('all'),
    sortBy: z.enum(['created_at', 'name']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  }),
);

export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;
export type UpdateDeckInput = z.infer<typeof UpdateDeckSchema>;
export type BatchDeleteDeckInput = z.infer<typeof BatchDeleteDeckSchema>;
export type DeckListQuery = z.infer<typeof DeckListQuerySchema>;
