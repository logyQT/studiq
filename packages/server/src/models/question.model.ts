import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const QuestionTypeEnum = z.enum(['mcq', 'true_false', 'open']);

export const CreateQuestionSchema = registry.register(
  'CreateQuestionRequest',
  z.object({
    bankId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    type: QuestionTypeEnum,
    content: z
      .string()
      .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG }),
    explanation: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    answers: z
      .array(
        z.object({
          content: z
            .string()
            .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
            .min(1, { error: ValidationErrorCode.TOO_SHORT })
            .max(255, { error: ValidationErrorCode.TOO_LONG }),
          isCorrect: z.boolean({ error: ValidationErrorCode.BOOL }),
          orderIndex: z
            .number({ error: ValidationErrorCode.NUMBER })
            .int({ error: ValidationErrorCode.INTEGER })
            .default(0),
        }),
      )
      .min(1, { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const UpdateQuestionSchema = registry.register(
  'UpdateQuestionRequest',
  z.object({
    bankId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    type: QuestionTypeEnum.optional(),
    content: z
      .string()
      .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    explanation: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    answers: z
      .array(
        z.object({
          id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
          content: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
          isCorrect: z.boolean({ error: ValidationErrorCode.BOOL }),
          orderIndex: z
            .number({ error: ValidationErrorCode.NUMBER })
            .int({ error: ValidationErrorCode.INTEGER })
            .default(0),
        }),
      )
      .optional(),
    visibility: z.enum(['personal', 'group']).optional(),
  }),
);

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;

export interface QuestionAnswer {
  id: string;
  question_id: string;
  content: string;
  is_correct: boolean;
  order_index: number;
}

export interface Question {
  id: string;
  organization_id: string | null;
  created_by: string;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  explanation: string | null;
  visibility?: 'personal' | 'group';
  difficulty: 'easy' | 'medium' | 'hard';
  created_at: string;
  updated_at: string;
  question_answers: QuestionAnswer[];
  topics?: Array<{ id: string; name: string }>;
}
