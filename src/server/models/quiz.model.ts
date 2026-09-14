import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateQuizSchema = registry.register(
  'CreateQuizRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(200, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().max(2000, { error: ValidationErrorCode.TOO_LONG }).optional(),
  }),
);
export type CreateQuizInput = z.infer<typeof CreateQuizSchema>;

export const UpdateQuizSchema = registry.register('UpdateQuizRequest', CreateQuizSchema.partial());
export type UpdateQuizInput = z.infer<typeof UpdateQuizSchema>;

export const AddQuizQuestionsSchema = registry.register(
  'AddQuizQuestionsRequest',
  z.object({
    questionIds: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);
export type AddQuizQuestionsInput = z.infer<typeof AddQuizQuestionsSchema>;

export const ReorderQuizQuestionsSchema = registry.register(
  'ReorderQuizQuestionsRequest',
  z.object({
    questionIds: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);
export type ReorderQuizQuestionsInput = z.infer<typeof ReorderQuizQuestionsSchema>;

export const BulkSaveQuizQuestionSchema = z.object({
  question_id: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
  order_index: z.number().int().min(0, { error: ValidationErrorCode.INVALID_INPUT }),
  points: z.number().int().min(0, { error: ValidationErrorCode.INVALID_INPUT }),
});
export type BulkSaveQuizQuestion = z.infer<typeof BulkSaveQuizQuestionSchema>;

export const BulkSaveQuizSchema = registry.register(
  'BulkSaveQuizRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(200, { error: ValidationErrorCode.TOO_LONG }),
    description: z
      .string()
      .max(2000, { error: ValidationErrorCode.TOO_LONG })
      .nullable()
      .optional(),
    questions: z.array(BulkSaveQuizQuestionSchema),
  }),
);
export type BulkSaveQuizInput = z.infer<typeof BulkSaveQuizSchema>;

export const GenerateQuizSchema = registry.register(
  'GenerateQuizRequest',
  z.object({
    bankId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    questionTypes: z
      .array(z.enum(['mcq', 'true_false', 'open']))
      .min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    questionCount: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_FEW })
      .max(50, { error: ValidationErrorCode.TOO_MANY }),
  }),
);
export type GenerateQuizInput = z.infer<typeof GenerateQuizSchema>;
