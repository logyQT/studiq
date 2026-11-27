// @studiq/authz — Authorization primitives for StudiQ.
//
// Pure types, constants, and evaluation logic for RBAC, entitlement flags,
// and permissions. No Supabase or app-specific dependencies.

// ── Entitlement flags ───────────────────────────────────────────────────────
export {
  type Entitlement,
  type EntitlementKey,
  ENTITLEMENT_KEYS,
  type EntitlementProfile,
  ENTITLEMENT_PROFILES,
  ENTITLEMENTS,
  isEntitlementKey,
  isEntitlementProfile,
  LEARNER_ENTITLEMENTS,
  type PlanSource,
  type ResolvedEntitlements,
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
  isPersonalPermissionKey,
  PERMISSIONS,
  Permission,
  PERSONAL_PERMISSION_KEYS,
  type PermissionCatalogKey,
  type PermissionCategory,
  type PermissionDefinition,
  type PermissionKey,
  type PermissionScope,
  type ResourceAccess,
  resolveStoredScope,
  scopeCovers,
} from './lib/permissions';
// ── Organization roles ──────────────────────────────────────────────────────
export {
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
