import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const QuestionTypeEnum = z.enum(['mcq', 'true_false', 'open']);
export const DifficultyEnum = z.enum(['easy', 'medium', 'hard']);

export const CreateQuestionSchema = registry.register(
  'CreateQuestionRequest',
  z.object({
    subjectId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    type: QuestionTypeEnum,
    content: z
      .string()
      .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG }),
    explanation: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    difficulty: DifficultyEnum.default('medium'),
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
    subjectId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    type: QuestionTypeEnum.optional(),
    content: z
      .string()
      .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(255, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    explanation: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    difficulty: DifficultyEnum.optional(),
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
  }),
);

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;
