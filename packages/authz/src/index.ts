// @studiq/authz — Authorization primitives for StudiQ.
//
// Pure types, constants, and evaluation logic for RBAC, feature flags,
// and permissions. No Supabase or app-specific dependencies.

// ── Feature flags ───────────────────────────────────────────────────────────
export {
  ADMIN_ONLY_FEATURES,
  FEATURES,
  type FeatureKey,
  type FeatureResolution,
  isFeatureKey,
  rolloutBucket,
} from './features';
// ── Permissions ─────────────────────────────────────────────────────────────
export {
  DEFAULT_ROLE_PERMISSIONS,
  evaluateScope,
  Permission,
  type PermissionKey,
  type PermissionScope,
  type ResourceAccess,
} from './lib/permissions';

// ── Request context ─────────────────────────────────────────────────────────
export type { RequestContext } from './lib/request-context';
// ── Types ───────────────────────────────────────────────────────────────────
export { AccountType, type Nullable } from './types';
