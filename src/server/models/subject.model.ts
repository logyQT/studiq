import { z, registry } from '@/lib/zod';
import { AppErrorCode } from '@/lib/errors';

export const CreateSubjectSchema = registry.register(
  'CreateSubjectRequest',
  z.object({
    name: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }),
    description: z.string().optional(),
    universityId: z.string().uuid().optional(),
  }),
);

export const UpdateSubjectSchema = registry.register(
  'UpdateSubjectRequest',
  z.object({
    name: z.string().min(1, { error: AppErrorCode.INVALID_INPUT }).optional(),
    description: z.string().optional(),
  }),
);

export type CreateSubjectInput = z.infer<typeof CreateSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof UpdateSubjectSchema>;
