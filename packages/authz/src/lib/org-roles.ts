// Organization role primitives.
//
// The role *name* is the stable identifier ("admin", "teacher", "member");
// `org_roles.display_name` is user-editable, so authorization decisions must
// compare against the name. Keeping the literal here means the checkout page
// and the billing service cannot drift apart.

import type { EntitlementProfile } from '../entitlements';
import { PERMISSIONS, type CatalogScope, type PermissionCatalogKey } from './permissions';

/** Role name that grants organization-wide administration (billing included). */
export const ORG_ADMIN_ROLE = 'admin';

export function isOrgAdminRole(roleName: string | null | undefined): boolean {
  return roleName === ORG_ADMIN_ROLE;
}

/** The three system roles every organization carries (ADR-0015 §4.2). */
export const SYSTEM_ROLE_NAMES = ['admin', 'teacher', 'member'] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

export interface SystemRoleTemplate {
  displayName: string;
  description: string;
  entitlementProfile: EntitlementProfile;
  /** Catalog key → the scope the seeded row carries. */
  permissions: Partial<Record<PermissionCatalogKey, CatalogScope>>;
}

type PermissionKeyList = readonly PermissionCatalogKey[];

const CATALOG_KEY_SET: ReadonlySet<string> = new Set<string>(Object.keys(PERMISSIONS));

const catalogKeys = Object.keys(PERMISSIONS).filter((key): key is PermissionCatalogKey =>
  CATALOG_KEY_SET.has(key),
);

const CONTENT_KEYS: PermissionKeyList = catalogKeys.filter(
  (key) => PERMISSIONS[key].category === 'content',
);
const GROUP_KEYS: PermissionKeyList = catalogKeys.filter(
  (key) => PERMISSIONS[key].category === 'group',
);
const ORG_KEYS: PermissionKeyList = catalogKeys.filter(
  (key) => PERMISSIONS[key].category === 'org',
);

function scoped(keys: PermissionKeyList, scope: CatalogScope): Record<string, CatalogScope> {
  return Object.fromEntries(keys.map((key) => [key, scope]));
}

/**
 * The seeded system-role matrix (ADR-0015 §4.2). `seed_system_role_permissions`
 * in `20261119180000_authority_entitlement_profile.sql` mirrors these rules and
 * `__tests__/integration/entitlement-profile.test.ts` pins the two together, so
 * a catalog key added here without a matching SQL predicate fails the suite.
 *
 * The member row grants `stats.read` at `own` rather than `group`, following
 * §4.2's matrix; the Teacher row grants it at `group`. Nothing reads the key
 * until phase 5, so neither scope is load-bearing yet.
 */
export const SYSTEM_ROLE_TEMPLATES: Record<SystemRoleName, SystemRoleTemplate> = {
  admin: {
    displayName: 'Admin',
    description: 'Org manager — settings, members, roles',
    entitlementProfile: 'all',
    permissions: {
      ...scoped(CONTENT_KEYS, 'organization'),
      ...scoped(GROUP_KEYS, 'organization'),
      ...scoped(ORG_KEYS, 'organization'),
    },
  },
  teacher: {
    displayName: 'Teacher',
    description: 'Educator — CRUD over own content',
    entitlementProfile: 'all',
    // Every content key, `assignment.*` included, stays at own scope — except
    // `stats.read`, which ADR §4.2 gives at group scope.
    permissions: {
      ...scoped(
        CONTENT_KEYS.filter((key) => key !== 'stats.read'),
        'own',
      ),
      'stats.read': 'group',
      ...scoped(GROUP_KEYS, 'group'),
    },
  },
  member: {
    displayName: 'Student',
    description: 'Base learner — read own + group content, create own',
    entitlementProfile: 'learner',
    // The staff-only assessment family is not a member permission.
    permissions: {
      ...Object.fromEntries(
        CONTENT_KEYS.filter((key) => !key.startsWith('assignment.')).map((key) => [
          key,
          key === 'stats.read' ? 'own' : key.endsWith('.read') ? 'group' : 'own',
        ]),
      ),
      'group.read': 'group',
    },
  },
};
