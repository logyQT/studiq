import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { UNIVERSITY_ROLES } from '@/types';
import { NameSchema } from '@/server/models';

export const CreateInviteSchema = registry.register(
  'CreateInviteRequest',
  z.object({
    name: NameSchema,
    email: z.email({ error: ValidationErrorCode.EMAIL_INVALID }),
    role: z.enum(UNIVERSITY_ROLES, {
      error: ValidationErrorCode.INVALID_ROLE,
    }),
    universityId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  }),
);

export const BulkInviteSchema = registry.register(
  'BulkInviteRequest',
  z.object({
    invitations: z.array(CreateInviteSchema).min(1),
  }),
);

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;
export type BulkInviteInput = z.infer<typeof BulkInviteSchema>;
