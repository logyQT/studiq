import { createListQuerySchema } from '@studiq/server/lib/query-list';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const CreateQuestionReportSchema = registry.register(
  'CreateQuestionReportRequest',
  z.object({
    message: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(2000, { error: ValidationErrorCode.TOO_LONG }),
  }),
);
export type CreateQuestionReportInput = z.infer<typeof CreateQuestionReportSchema>;

export const CreateReportMessageSchema = registry.register(
  'CreateReportMessageRequest',
  z.object({
    body: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(2000, { error: ValidationErrorCode.TOO_LONG }),
  }),
);
export type CreateReportMessageInput = z.infer<typeof CreateReportMessageSchema>;

export const QuestionReportListQuerySchema = registry.register(
  'QuestionReportListQuery',
  createListQuerySchema({
    sortColumns: ['updated_at', 'created_at'] as const,
    sortByDefault: 'updated_at',
    defaultLimit: 24,
    maxLimit: 100,
  }).extend({
    status: z.enum(['all', 'open', 'resolved']).optional().default('all'),
  }),
);
export type QuestionReportListQuery = z.infer<typeof QuestionReportListQuerySchema>;

export const UpdateQuestionReportSchema = registry.register(
  'UpdateQuestionReportRequest',
  z.object({ status: z.enum(['open', 'resolved']) }),
);
export type UpdateQuestionReportInput = z.infer<typeof UpdateQuestionReportSchema>;
