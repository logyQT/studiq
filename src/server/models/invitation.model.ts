import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { ORGANIZATION_ROLES } from '@/types';
import { NameSchema } from '@/server/models';

export const CreateInviteSchema = registry.register(
  'CreateInviteRequest',
  z.object({
    name: NameSchema,
    email: z
      .email({ error: ValidationErrorCode.EMAIL_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    role: z.enum(ORGANIZATION_ROLES, {
      error: ValidationErrorCode.INVALID_ROLE,
    }),
    organizationId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  }),
);

export const BulkInviteSchema = registry.register(
  'BulkInviteRequest',
  z.object({
    invitations: z.array(CreateInviteSchema).min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;
export type BulkInviteInput = z.infer<typeof BulkInviteSchema>;
