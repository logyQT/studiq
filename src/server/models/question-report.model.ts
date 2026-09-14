import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

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
