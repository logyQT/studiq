import { z, registry } from '@/lib/zod';
import { AppErrorCode } from '@/lib/errors';

export const CreateUniversitySchema = registry.register(
  'CreateUniversityRequest',
  z.object({
    name: z
      .string({ error: AppErrorCode.NAME_REQUIRED })
      .min(3, { error: AppErrorCode.NAME_TOO_SHORT }),
    slug: z
      .string({ error: AppErrorCode.INVALID_INPUT })
      .min(2, { error: AppErrorCode.INVALID_INPUT })
      .regex(/^[a-z0-9-]+$/, { error: AppErrorCode.NAME_INVALID_FORMAT }),
  }),
);

export type CreateUniversityInput = z.infer<typeof CreateUniversitySchema>;
