import { createListQuerySchema } from '@studiq/server/lib/query-list';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

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
  createListQuerySchema({
    sortColumns: ['created_at', 'updated_at', 'name'] as const,
    maxLimit: 500,
  }).extend({
    owner: z.enum(['all', 'mine', 'group']).optional().default('all'),
    groupFilter: z.enum(['all', 'mine']).optional().default('all'),
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

export interface QuestionBank {
  id: string;
  name: string;
  description: string | null;
  question_count: number;
  created_by: string;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
  visibility?: 'personal' | 'group';
  groupIds?: string[];
}
