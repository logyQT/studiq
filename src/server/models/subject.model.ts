import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const SubjectSchema = registry.register(
  'Subject',
  z.object({
    id: z.string().uuid(),
    university_id: z.string().uuid().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    created_by: z.string().uuid(),
    created_at: z.string(),
  }),
);

export const CreateSubjectSchema = registry.register(
  'CreateSubjectRequest',
  z.object({
    name: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    description: z.string().optional(),
    universityId: z.string().uuid().optional(),
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
