import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { UNIVERSITY_ROLES } from '@/types';

export const ChangeRoleSchema = registry.register(
  'ChangeRoleRequest',
  z.object({
    targetUserId: z.string({ error: ValidationErrorCode.INVALID_INPUT }).min(1),
    newRole: z.enum(UNIVERSITY_ROLES, { error: ValidationErrorCode.INVALID_ROLE }),
  }),
);

export const RemoveMemberSchema = registry.register(
  'RemoveMemberRequest',
  z.object({
    targetUserId: z.string({ error: ValidationErrorCode.INVALID_INPUT }).min(1),
  }),
);

export type ChangeRoleInput = z.infer<typeof ChangeRoleSchema>;
export type RemoveMemberInput = z.infer<typeof RemoveMemberSchema>;
