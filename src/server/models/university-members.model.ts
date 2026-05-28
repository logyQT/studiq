import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { UNIVERSITY_ROLES } from '@/types';

export const ChangeRoleSchema = registry.register(
  'ChangeRoleRequest',
  z.object({
    targetUserId: z
      .uuid({ error: ValidationErrorCode.UUID_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    newRole: z.enum(UNIVERSITY_ROLES, { error: ValidationErrorCode.INVALID_ROLE }),
  }),
);

export const RemoveMemberSchema = registry.register(
  'RemoveMemberRequest',
  z.object({
    targetUserId: z
      .uuid({ error: ValidationErrorCode.UUID_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
  }),
);

export type ChangeRoleInput = z.infer<typeof ChangeRoleSchema>;
export type RemoveMemberInput = z.infer<typeof RemoveMemberSchema>;
