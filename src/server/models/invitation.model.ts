import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateInviteSchema = registry.register(
  'CreateInviteRequest',
  z.object({
    email: z
      .email({ error: ValidationErrorCode.EMAIL_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    targetOrgRoleId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
    organizationId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  }),
);

export const BulkInviteSchema = registry.register(
  'BulkInviteRequest',
  z.object({
    invitations: z.array(CreateInviteSchema).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export const InvitationListQuerySchema = registry.register(
  'InvitationListQuery',
  z.object({
    isAccepted: z.coerce.boolean().optional().default(false),
  }),
);

export const UpdateInviteSchema = registry.register(
  'UpdateInviteRequest',
  z.object({
    targetOrgRoleId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  }),
);

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;
export type BulkInviteInput = z.infer<typeof BulkInviteSchema>;
export type InvitationListQuery = z.infer<typeof InvitationListQuerySchema>;
export type UpdateInviteInput = z.infer<typeof UpdateInviteSchema>;
