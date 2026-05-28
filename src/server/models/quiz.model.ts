import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const GenerateQuizSchema = registry.register(
  'GenerateQuizRequest',
  z.object({
    subjectId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    questionTypes: z
      .array(z.enum(['mcq', 'true_false', 'open']))
      .min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).optional(),
    questionCount: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_FEW })
      .max(50, { error: ValidationErrorCode.TOO_MANY }),
  }),
);

export type GenerateQuizInput = z.infer<typeof GenerateQuizSchema>;
