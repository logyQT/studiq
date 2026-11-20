import { GROUP_ROLES } from '@studiq/authz';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import { OptionalLocaleSchema } from './locale.model';

/**
 * The class target of an invitation (ADR-0015 §4.3/§10, D7): `groupId` names the
 * class, `groupRole` the role the invitee gets in it. The two are set together
 * — a class invite has both, an org invite neither (the pair CHECK on the table
 * enforces the same). `groupRole` is constrained to the `group_members.role`
 * values.
 */
const ClassInviteFields = {
  groupId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  groupRole: z.enum(GROUP_ROLES, { error: ValidationErrorCode.INVALID_ROLE }).optional(),
};

export const CreateInviteSchema = registry.register(
  'CreateInviteRequest',
  z
    .object({
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
      locale: OptionalLocaleSchema,
      ...ClassInviteFields,
    })
    // A class target carries both fields or neither: `group_id` without
    // `target_group_role` (or the reverse) is rejected here, before the service,
    // so the pair CHECK on the table is never the first line of defence.
    .superRefine((value, ctx) => {
      if ((value.groupId === undefined) !== (value.groupRole === undefined)) {
        ctx.addIssue({
          code: 'custom',
          message: ValidationErrorCode.INVALID_INPUT,
          path: [value.groupId === undefined ? 'groupRole' : 'groupId'],
        });
      }
    }),
);

export const BulkInviteSchema = registry.register(
  'BulkInviteRequest',
  z.object({
    // Bulk is the org-invitation surface: entries may not carry a class target
    // (the service refuses them with a 422 naming the entry), because the
    // batch's authority is one `org.invitation.manage` check for the whole
    // batch. Class invites go through the single POST.
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
export type InvitationListQuery = z.infer<typeof InvitationListQuerySchema>;
