# Latest Progress

## Phase 1 ✅ — Core Modules
- `src/lib/permissions.ts` — Permission enum (20 resource permissions), PermissionScope (`'own'|'group'|'organization'|'any'`), `evaluateScope()`, `DEFAULT_ROLE_PERMISSIONS`, `ResourceAccess`
- `src/lib/features.ts` — FEATURES constant, FeatureKey type, DEFAULT_ROLE_FEATURES, `getEnabledFeatures()`, `requireFeature()`
- `src/lib/authz.ts` — pure `evaluate()` orchestrator, re-exports from permissions.ts
- Changes: no `'granted'`, no `ai.chat`/`org.manage` in Permission enum, member read = `'group'` (was `'organization'`)

## Phase 2 ✅ — Server Authz (rbac.ts)

## Phase 3 ✅ — Frontend Hooks
- `use-permissions.ts` — `features` type changed from `Record<string, boolean>` to `string[]`
- `use-can.ts` — removed `PERMISSION_FEATURE_MAP`, removed feature gating, added `resourceOrgId` parameter, uses `evaluate()` from `@/lib/authz`
- `use-feature.ts` — now reads from `/permissions/me` data via `usePermissions()` instead of a separate endpoint
- Rewrote `src/lib/rbac.ts` — imports from `@/lib/authz` + `@/lib/permissions`
- `checkPermission()` delegates to `authz.evaluate()`
- `buildQueryFilter()` — `'organization'` scope returns `{ organization_id: ctx.activeOrgId }` (no visibility filter, direct path), `'group'` uses `_useRpc`
- Removed `'granted'` case, removed duplicate Permission enum definition
