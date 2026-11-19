// @studiq/authz — Authorization primitives for StudiQ.
//
// Pure types, constants, and evaluation logic for RBAC, entitlement flags,
// and permissions. No Supabase or app-specific dependencies.

// ── Entitlement flags ───────────────────────────────────────────────────────
export {
  ADMIN_ONLY_ENTITLEMENTS,
  type Entitlement,
  ENTITLEMENT_KEYS,
  type EntitlementKey,
  type EntitlementResolution,
  ENTITLEMENTS,
  isEntitlementKey,
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
  DEFAULT_ROLE_PERMISSIONS,
  evaluateScope,
  PERMISSIONS,
  Permission,
  type PermissionCatalogKey,
  type PermissionCategory,
  type PermissionDefinition,
  type PermissionKey,
  type PermissionScope,
  type ResourceAccess,
} from './lib/permissions';
// ── Organization roles ──────────────────────────────────────────────────────
export { isOrgAdminRole, ORG_ADMIN_ROLE } from './lib/org-roles';

// ── Request context ─────────────────────────────────────────────────────────
export type { RequestContext } from './lib/request-context';
// ── Types ───────────────────────────────────────────────────────────────────
export { AccountType, type Nullable } from './types';
