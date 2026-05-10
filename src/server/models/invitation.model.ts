import { z, registry } from '@/lib/zod';
import { AppErrorCode } from '@/lib/errors';
import { UNIVERSITY_ROLES } from '@/types';
import { NameSchema } from '@/server/models';

export const CreateInviteSchema = registry.register(
  'CreateInviteRequest',
  z.object({
    name: NameSchema,
    email: z.email({ error: AppErrorCode.EMAIL_INVALID }),
    role: z.enum(UNIVERSITY_ROLES, {
      error: AppErrorCode.INVALID_INPUT,
    }),
    universityId: z.uuid({ error: AppErrorCode.INVALID_INPUT }).optional(),
  }),
);

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;
