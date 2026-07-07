import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateOrgRoleSchema = registry.register(
  'CreateOrgRoleRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().nullable().optional(),
  }),
);

export const UpdateOrgRoleSchema = registry.register(
  'UpdateOrgRoleRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z.string().nullable().optional(),
  }),
);

export const RolePermissionEntrySchema = registry.register(
  'RolePermissionEntry',
  z.object({
    permissionName: z.string({ error: ValidationErrorCode.REQUIRED }),
    scope: z.enum(['own', 'group', 'organization'], {
      error: ValidationErrorCode.INVALID_INPUT,
    }),
  }),
);

export const SetRolePermissionsSchema = registry.register(
  'SetRolePermissionsRequest',
  z.object({
    permissions: z.array(RolePermissionEntrySchema),
  }),
);

export const OrgRoleIdParamsSchema = registry.register(
  'OrgRoleIdParams',
  z.object({
    id: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);

export type CreateOrgRoleInput = z.infer<typeof CreateOrgRoleSchema>;
export type UpdateOrgRoleInput = z.infer<typeof UpdateOrgRoleSchema>;
export type RolePermissionEntry = z.infer<typeof RolePermissionEntrySchema>;
export type SetRolePermissionsInput = z.infer<typeof SetRolePermissionsSchema>;
export type OrgRoleIdParams = z.infer<typeof OrgRoleIdParamsSchema>;

export interface OrgRole {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}
