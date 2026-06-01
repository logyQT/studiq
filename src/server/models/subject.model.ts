import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const SubjectSchema = registry.register(
  'Subject',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    university_id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).nullable(),
    name: z
      .string()
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).nullable(),
    created_by: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    created_at: z.string(),
  }),
);

export const CreateSubjectSchema = registry.register(
  'CreateSubjectRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    description: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
  }),
);

export const UpdateSubjectSchema = registry.register(
  'UpdateSubjectRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
    description: z.string().optional(),
  }),
);

export type CreateSubjectInput = z.infer<typeof CreateSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof UpdateSubjectSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
