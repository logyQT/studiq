import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const GenerateQuizSchema = registry.register(
  'GenerateQuizRequest',
  z.object({
    subjectId: uuid.optional(),
    questionTypes: z.array(z.enum(['mcq', 'true_false', 'open'])).min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).optional(),
    questionCount: z.number().int().min(1).max(50),
  }),
);

export type GenerateQuizInput = z.infer<typeof GenerateQuizSchema>;
