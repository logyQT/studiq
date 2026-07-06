import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateQuestionBankSchema = registry.register(
  'CreateQuestionBankRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(128, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    questionIds: z.array(z.uuid()).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
    visibility: z.enum(['personal', 'group']).optional(),
  }),
);

export const UpdateQuestionBankSchema = registry.register(
  'UpdateQuestionBankRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(128, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    questionIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    groupIds: z.array(z.string().uuid()).optional(),
    visibility: z.enum(['personal', 'group']).optional(),
  }),
);

export const BatchDeleteQuestionBankSchema = registry.register(
  'BatchDeleteQuestionBankRequest',
  z.object({
    ids: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const QuestionBankListQuerySchema = registry.register(
  'QuestionBankListQuery',
  z.object({
    q: z.string().optional(),
    owner: z.enum(['all', 'mine', 'group']).optional().default('all'),
    sortBy: z.enum(['created_at', 'updated_at', 'name']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(24),
  }),
);

export const BulkCreateQuestionBankSchema = registry.register(
  'BulkCreateQuestionBankRequest',
  z.object({
    banks: z
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

export type CreateQuestionBankInput = z.infer<typeof CreateQuestionBankSchema>;
export type UpdateQuestionBankInput = z.infer<typeof UpdateQuestionBankSchema>;
export type BatchDeleteQuestionBankInput = z.infer<typeof BatchDeleteQuestionBankSchema>;
export type BulkCreateQuestionBankInput = z.infer<typeof BulkCreateQuestionBankSchema>;
export type QuestionBankListQuery = z.infer<typeof QuestionBankListQuerySchema>;
