import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const ChangeRoleSchema = registry.register(
  'ChangeRoleRequest',
  z.object({
    targetUserId: z
      .uuid({ error: ValidationErrorCode.UUID_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    newOrgRoleId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
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
