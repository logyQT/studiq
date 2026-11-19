import {
  ENTITLEMENT_PROFILES,
  isPermissionCatalogKey,
  PERMISSIONS,
  type PermissionCatalogKey,
  type PermissionDefinition,
} from '@studiq/authz';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/** Every key of the closed permission catalog (ADR-0015 §4.1), in declaration order. */
export const CATALOG_PERMISSION_KEYS: readonly PermissionCatalogKey[] =
  Object.keys(PERMISSIONS).filter(isPermissionCatalogKey);

/** The catalog by name, `undefined` for a name the caller invented. */
const CATALOG: Record<string, PermissionDefinition | undefined> = PERMISSIONS;

const EntitlementProfileSchema = z.enum(ENTITLEMENT_PROFILES, {
  error: ValidationErrorCode.INVALID_INPUT,
});

export const CreateOrgRoleSchema = registry.register(
  'CreateOrgRoleRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().nullable().optional(),
    entitlementProfile: EntitlementProfileSchema.optional(),
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
    display_name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z.string().nullable().optional(),
    entitlementProfile: EntitlementProfileSchema.optional(),
  }),
);

export const RolePermissionEntrySchema = registry.register(
  'RolePermissionEntry',
  z.object({
    /** Checked against the closed catalog by `SetRolePermissionsSchema`. */
    permissionName: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    /** `null` revokes the grant; anything else is the scope the role holds. */
    scope: z
      .enum(['own', 'group', 'organization'], { error: ValidationErrorCode.INVALID_INPUT })
      .nullable(),
  }),
);

/**
 * The role editor's save contract: the payload **is** the role's whole permission
 * set, one entry per catalog key (ADR-0015 §9). `OrgRoleService.setPermissions`
 * replaces every row for the role, so a partial payload would delete the keys it
 * does not mention — the completeness and scope checks below are what make that
 * write safe (R12, D24).
 */
export const SetRolePermissionsSchema = registry.register(
  'SetRolePermissionsRequest',
  z
    .object({
      permissions: z.array(RolePermissionEntrySchema),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();

      value.permissions.forEach((entry, index) => {
        if (seen.has(entry.permissionName)) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissions', index, 'permissionName'],
            message: ValidationErrorCode.INVALID_INPUT,
          });
        }
        seen.add(entry.permissionName);

        // A permission name outside the catalog is located by the name itself, so
        // the 422 says which key the caller invented.
        const definition = CATALOG[entry.permissionName];
        const allowedScopes: readonly string[] = definition?.allowedScopes ?? [];
        if (!definition) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissions', entry.permissionName],
            message: ValidationErrorCode.INVALID_INPUT,
          });
        }

        if (entry.scope !== null && !allowedScopes.includes(entry.scope)) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissions', index, 'scope'],
            message: ValidationErrorCode.INVALID_INPUT,
          });
        }
      });

      // One issue per absent key, located by the key itself so the 422 names it.
      for (const key of CATALOG_PERMISSION_KEYS) {
        if (!seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissions', key],
            message: ValidationErrorCode.INVALID_INPUT,
          });
        }
      }
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
