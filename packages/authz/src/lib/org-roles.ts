// Organization role primitives.
//
// The role *name* is the stable identifier ("admin", "teacher", "member");
// `org_roles.display_name` is user-editable. Nothing decides authority from a
// name any more (phase 6b-2 moved the last reader onto `org.billing.manage`);
// `ORG_ADMIN_ROLE` survives only where a database write names the ownership
// role.

import type { EntitlementProfile } from '../entitlements';
import { PERMISSIONS, type CatalogScope, type PermissionCatalogKey } from './permissions';

/** Role name that the ownership role is seeded under. */
export const ORG_ADMIN_ROLE = 'admin';

/** The three system roles every organization carries (ADR-0015 §4.2). */
export const SYSTEM_ROLE_NAMES = ['admin', 'teacher', 'member'] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

export interface RoleTemplate {
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
 * mirrors these rules; its newest definition is
 * `20261122140000_teacher_group_reads.sql` (3d re-created it, from the body
 * `20261119211000` owns), and `__tests__/integration/entitlement-profile.test.ts`
 * pins the two together, so a catalog key added here without a matching SQL
 * predicate fails the suite.
 *
 * Teacher reads at `group` and writes at `own` (D29): `group` is a superset of
 * `own` in the API layer, so every read that worked at `own` still works, and a
 * group-shared resource becomes readable too. `assignment.read` and `stats.read`
 * move with the other content reads.
 *
 * The member row grants `stats.read` at `own` rather than `group`, following
 * §4.2's matrix.
 */
export const SYSTEM_ROLE_TEMPLATES: Record<SystemRoleName, RoleTemplate> = {
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
    // Reads at `group`, writes at `own` (D29). `group` is a superset of `own`
    // in the API layer, so the read shift never narrows an own-scope caller.
    permissions: {
      ...Object.fromEntries(
        CONTENT_KEYS.map((key) => [key, key.endsWith('.read') ? 'group' : 'own']),
      ),
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

/** The read-only preset: every read key of the content and class families. */
const READ_KEYS: PermissionKeyList = [...CONTENT_KEYS, ...GROUP_KEYS].filter((key) =>
  key.endsWith('.read'),
);

/**
 * The editor's templates (ADR-0015 §4.2/§9, D17). A template is a **preset**, not
 * a fourth system role: the three `SYSTEM_ROLE_TEMPLATES` are seeded by the
 * trigger and cannot be renamed or deleted, while these are materialised as
 * ordinary custom roles by `POST /organization/roles`. Nothing here is a system
 * role, and `org.admin` is absent by D16 — ownership is not grantable.
 *
 * Every key and scope is drawn from `PERMISSIONS`, so a template cannot carry a
 * name the editor's closed catalog refuses; the absent `org.admin` and the DB
 * matrix equality are pinned by `__tests__/unit/lib/org-roles.test.ts` and
 * `__tests__/integration/org-role-templates.test.ts`.
 */
export const ROLE_TEMPLATE_NAMES = ['assistant', 'billing', 'read-only', 'blank'] as const;

export type RoleTemplateName = (typeof ROLE_TEMPLATE_NAMES)[number];

export const ROLE_TEMPLATES = {
  assistant: {
    displayName: 'Assistant',
    description: 'Front-desk staff — members, invitations, reports and content',
    entitlementProfile: 'none',
    permissions: {
      'org.member.manage': 'organization',
      'org.invitation.manage': 'organization',
      'org.report.manage': 'organization',
      ...scoped(CONTENT_KEYS, 'organization'),
    },
  },
  billing: {
    displayName: 'Billing',
    description: 'Billing staff — the organization plan and its seats',
    entitlementProfile: 'none',
    permissions: {
      'org.billing.manage': 'organization',
      'org.seat.manage': 'organization',
    },
  },
  'read-only': {
    displayName: 'Read-only',
    description: 'Auditor — read content, classes and the audit log',
    entitlementProfile: 'none',
    permissions: {
      ...scoped(READ_KEYS, 'organization'),
      'org.audit.read': 'organization',
    },
  },
  blank: {
    displayName: 'Blank',
    description: 'No permissions — a custom role built from scratch',
    entitlementProfile: 'none',
    permissions: {},
  },
} as const satisfies Record<RoleTemplateName, RoleTemplate>;

export function isRoleTemplateName(value: string): value is RoleTemplateName {
  return (ROLE_TEMPLATE_NAMES as readonly string[]).includes(value);
}
