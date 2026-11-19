// @studiq/authz — Authorization primitives for StudiQ.
//
// Pure types, constants, and evaluation logic for RBAC, entitlement flags,
// and permissions. No Supabase or app-specific dependencies.

// ── Entitlement flags ───────────────────────────────────────────────────────
export {
  ADMIN_ONLY_ENTITLEMENTS,
  type Entitlement,
  type EntitlementKey,
  ENTITLEMENT_KEYS,
  type EntitlementProfile,
  ENTITLEMENT_PROFILES,
  type EntitlementResolution,
  ENTITLEMENTS,
  isEntitlementKey,
  isEntitlementProfile,
  LEARNER_ENTITLEMENTS,
  LEGACY_MANAGEMENT_ENTITLEMENTS,
  ORG_SCOPED_ENTITLEMENTS,
  rolloutBucket,
  SURFACE_ENTITLEMENT_KEYS,
} from './entitlements';
// ── Limits ──────────────────────────────────────────────────────────────────
export {
  isLimitKey,
  LIMIT_KEYS,
  type LimitKey,
  LIMITS,
  ORG_LIMIT_KEYS,
  USER_LIMIT_KEYS,
} from './limits';
// ── Permissions ─────────────────────────────────────────────────────────────
export {
  type CatalogScope,
  evaluateScope,
  isCatalogScope,
  isPermissionCatalogKey,
  PERMISSIONS,
  Permission,
  type PermissionCatalogKey,
  type PermissionCategory,
  type PermissionDefinition,
  type PermissionKey,
  type PermissionScope,
  type ResourceAccess,
  scopeCovers,
} from './lib/permissions';
// ── Organization roles ──────────────────────────────────────────────────────
export {
  isOrgAdminRole,
  isRoleTemplateName,
  ORG_ADMIN_ROLE,
  ROLE_TEMPLATE_NAMES,
  ROLE_TEMPLATES,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_TEMPLATES,
  type RoleTemplate,
  type RoleTemplateName,
  type SystemRoleName,
} from './lib/org-roles';

// ── Request context ─────────────────────────────────────────────────────────
export { GROUP_ROLES, type GroupRole, isGroupRole } from './lib/request-context';
export type { RequestContext } from './lib/request-context';
// ── Types ───────────────────────────────────────────────────────────────────
export { AccountType, type Nullable } from './types';
