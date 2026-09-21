import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const CreateOrganizationSchema = registry.register(
  'CreateOrganizationRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export const UpdateOrganizationSchema = registry.register(
  'UpdateOrganizationRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    logoUrl: z.url({ error: ValidationErrorCode.INVALID_INPUT }).optional(),
    brandColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, { error: ValidationErrorCode.INVALID_INPUT })
      .optional(),
  }),
);

export const OrganizationIdParamsSchema = registry.register(
  'OrganizationIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const OrganizationResponseSchema = registry.register(
  'OrganizationResponse',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    created_at: z.iso.datetime(),
  }),
);

export const AdminOrgListItemSchema = registry.register(
  'AdminOrgListItem',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    plan: z.string(),
    created_at: z.string(),
    member_count: z.number(),
    group_count: z.number(),
    role_count: z.number(),
  }),
);

export const OrgMemberSchema = registry.register(
  'OrgMember',
  z.object({
    id: z.string().uuid(),
    full_name: z.string().nullable(),
    email: z.string().email(),
    role_name: z.string(),
    joined_at: z.string(),
  }),
);

export const OrgGroupSchema = registry.register(
  'OrgGroup',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    member_count: z.number(),
    teacher_count: z.number(),
  }),
);

export const OrgRoleDetailSchema = registry.register(
  'OrgRoleDetail',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    is_system: z.boolean(),
    permission_count: z.number(),
  }),
);

export const AdminOrgDetailSchema = registry.register(
  'AdminOrgDetail',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    plan: z.string(),
    created_at: z.string(),
    members: z.array(OrgMemberSchema),
    groups: z.array(OrgGroupSchema),
    roles: z.array(OrgRoleDetailSchema),
  }),
);

export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>;
export type OrganizationIdParams = z.infer<typeof OrganizationIdParamsSchema>;
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;
export type AdminOrgListItem = z.infer<typeof AdminOrgListItemSchema>;
export type OrgMember = z.infer<typeof OrgMemberSchema>;
export type OrgGroup = z.infer<typeof OrgGroupSchema>;
export type OrgRoleDetail = z.infer<typeof OrgRoleDetailSchema>;
export type AdminOrgDetail = z.infer<typeof AdminOrgDetailSchema>;
