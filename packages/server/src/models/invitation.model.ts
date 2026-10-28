import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const CreateInviteSchema = registry.register(
  'CreateInviteRequest',
  z.object({
    email: z
      .email({ error: ValidationErrorCode.EMAIL_INVALID })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    targetOrgRoleId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
    // Target organization. Optional: defaults to the caller's active organization.
    // It may only select an org the caller is a member of (enforced in
    // InvitationService); it can never override the caller's tenant.
    organizationId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    // Language of the invitation e-mail (#604). The invitee has no account yet, so the
    // inviter's UI language is the best signal; omitted means Polish.
    locale: z.enum(['pl', 'en'], { error: ValidationErrorCode.INVALID_INPUT }).optional(),
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

export const AcceptInviteSchema = registry.register(
  'AcceptInviteRequest',
  z.object({
    // A bare 32-hex code or the `…/join?token=…` link „Kopiuj link” copies.
    // Normalisation happens in InvitationService, so every caller benefits.
    token: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .trim()
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(2048, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;
export type BulkInviteInput = z.infer<typeof BulkInviteSchema>;
export type InvitationListQuery = z.infer<typeof InvitationListQuerySchema>;
export type UpdateInviteInput = z.infer<typeof UpdateInviteSchema>;
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;
