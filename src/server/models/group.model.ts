import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateGroupSchema = registry.register(
  'CreateGroupRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().optional(),
  }),
);

export const UpdateGroupSchema = registry.register(
  'UpdateGroupRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z.string().optional(),
  }),
);

export const GroupMemberSchema = registry.register(
  'GroupMember',
  z.object({
    userId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
    role: z.enum(['teacher', 'member'], { error: ValidationErrorCode.INVALID_ROLE }),
  }),
);

export const SetGroupMembersSchema = registry.register(
  'SetGroupMembersRequest',
  z.object({
    members: z.array(GroupMemberSchema),
  }),
);

export const GroupIdParamsSchema = registry.register(
  'GroupIdParams',
  z.object({
    id: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;
export type GroupMemberInput = z.infer<typeof GroupMemberSchema>;
export type SetGroupMembersInput = z.infer<typeof SetGroupMembersSchema>;
export type GroupIdParams = z.infer<typeof GroupIdParamsSchema>;
