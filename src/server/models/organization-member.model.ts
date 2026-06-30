import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';
import { ORGANIZATION_ROLES } from '@/types';

export const ChangeRoleSchema = registry.register(
  'ChangeRoleRequest',
  z.object({
    targetUserId: z
      .uuid({ error: ValidationErrorCode.UUID_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    newRole: z.enum(ORGANIZATION_ROLES, { error: ValidationErrorCode.INVALID_ROLE }),
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
