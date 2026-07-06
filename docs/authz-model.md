# Authorization & Visibility Model

## 1. Two Orthogonal Axes

| Axis | Purpose | Mechanism | Where |
|------|---------|-----------|-------|
| **Permission** | *Who can act* on a resource | Scope hierarchy | `can()` / `checkPermission()` |
| **Visibility** | *Who can see* a resource | `visibility` column + group assignments | Access views / service queries |
| **Feature** | *Who can access* a product area | Boolean toggle | `hasFeature()` / `requireFeature()` |

They are independent. A user can have `deck.update: 'own'` scope while a deck's visibility is `'group'`.
Features gate product areas (AI Chat, Manage panel), NOT resource permissions.

---

## 2. Scope Hierarchy

```
own < group < organization < any
```

Higher scopes imply lower scopes. `evaluateScope()` is a pure function shared by frontend and backend:

```
evaluateScope(scope, userId, resource):
  1. resource.createdBy === userId          → true   (owner always passes)
  2. scope === own                          → false  (only owner)
  3. user is in resource's groups           → true   (via access views, backend only)
  4. scope === group                        → false  (frontend: conservative)
  5. resource.orgId === resource.activeOrgId → true  (org match)
  6. scope === organization                 → false
  7. scope === any                          → true
```

### `ResourceAccess`

```typescript
interface ResourceAccess {
  createdBy: string;          // resource creator
  orgId: string | null;       // resource's organization_id
  activeOrgId: string | null; // user's active org context
}
```

The `organization` scope check compares the resource's org against the user's active org — not just presence of either.

---

## 3. Evaluation Pipeline

### Backend (server-side API route)

```
Controller:
  1. Validate input (Zod)
  2. requireFeature(ctx, 'ai.chat')     ← optional feature gate
  3. checkPermission(ctx, perm, resource) ← scope evaluation
  4. checkQuota(ctx.userId, 'deck.count') ← optional quota check
  5. service.method(data, ctx)
```

### Frontend (component)

```
Component:
  hasFeature('ai.chat')    ← feature check (show/hide area)
  can('deck.update', createdBy, orgId) ← permission check (show/hide button)
```

### What is NOT in the pipeline

- **Features are NOT checked inside `authz.evaluate()`** — they're a separate concern
- **Features do NOT gate resource permissions** — `deck.create` is never wrapped by a feature flag
- **`PERMISSION_FEATURE_MAP` does not exist** — removed entirely

---

## 4. Layer Architecture

### File structure

| File | Role | Server | Client |
|------|------|--------|--------|
| `src/lib/permissions.ts` | `Permission` enum, `PermissionScope`, `evaluateScope()`, `DEFAULT_ROLE_PERMISSIONS` | ✅ | ✅ |
| `src/lib/features.ts` | `FEATURES`, `DEFAULT_ROLE_FEATURES`, `getEnabledFeatures()`, `requireFeature()` | ✅ | ❌* |
| `src/lib/authz.ts` | Pure `evaluate()` orchestrator (calls `evaluateScope` only) | ✅ | ✅ |
| `src/lib/rbac.ts` | Server: DB lookups → `getScope()`, `checkPermission()`, `buildQueryFilter()` | ✅ | ❌ |
| `src/hooks/use-can.ts` | Client: `can(perm, createdBy?, orgId?)` → `evaluate()` with `/permissions/me` data | ❌ | ✅ |
| `src/hooks/use-feature.ts` | Client: `hasFeature(key)` → checks features array from `/permissions/me` | ❌ | ✅ |

*`features.ts` exports `FEATURES` and `DEFAULT_ROLE_FEATURES` consts for client import, but `getEnabledFeatures()` and `requireFeature()` are server-only (DB queries for overrides).

### Unified endpoint: `GET /api/v1/permissions/me`

Returns both permissions and features in a single call:

```json
{
  "permissions": {
    "deck.create": "own",
    "deck.update": "own",
    "flashcard.read": "organization",
    "topic.read": "organization",
    ...
  },
  "features": ["ai.chat", "org.manage"]
}
```

`features` is an array of enabled feature keys (only truthy values present). `permissions` is a map of permission key → scope (or null if denied).

---

## 5. Permissions

### `Permission` enum

20 resource permissions — no `ai.chat`, no `org.manage`:

```typescript
export const Permission = {
  FLASHCARD_READ: 'flashcard.read',
  FLASHCARD_CREATE: 'flashcard.create',
  FLASHCARD_UPDATE: 'flashcard.update',
  FLASHCARD_DELETE: 'flashcard.delete',
  TOPIC_READ: 'topic.read',
  TOPIC_CREATE: 'topic.create',
  TOPIC_UPDATE: 'topic.update',
  TOPIC_DELETE: 'topic.delete',
  DECK_READ: 'deck.read',
  DECK_CREATE: 'deck.create',
  DECK_UPDATE: 'deck.update',
  DECK_DELETE: 'deck.delete',
  QUESTION_READ: 'question.read',
  QUESTION_CREATE: 'question.create',
  QUESTION_UPDATE: 'question.update',
  QUESTION_DELETE: 'question.delete',
  QUESTION_BANK_READ: 'question_bank.read',
  QUESTION_BANK_CREATE: 'question_bank.create',
  QUESTION_BANK_UPDATE: 'question_bank.update',
  QUESTION_BANK_DELETE: 'question_bank.delete',
} as const;
```

### `PermissionScope`

```typescript
export type PermissionScope = 'own' | 'group' | 'organization' | 'any';
```

`'granted'` removed — it was a vestige of features wearing a permission costume.

### `DEFAULT_ROLE_PERMISSIONS`

| Role | Read | Create | Update | Delete |
|------|------|--------|--------|--------|
| **member** (student) | **`group`** | `own` | `own` | `own` |
| **teacher** | `own` | `own` | `own` | `own` |
| **admin** (manager) | `organization` | `organization` | `organization` | `organization` |

- **member**: `read: 'group'` — sees own personal content + content shared with their groups (via RPC access functions).
- **teacher**: `read: 'own'` — sees only their own content. Sharing is done via `visibility: 'group'` + group assignment.
- **admin**: `read: 'organization'` — sees all org content, no visibility filter (direct query with just `org_id`).

### `evaluateScope()` pure function

```typescript
export function evaluateScope(
  scope: PermissionScope | null | undefined,
  userId: string,
  resource: ResourceAccess,
): boolean {
  if (!scope) return false;
  if (resource.createdBy === userId) return true;

  const level = SCOPE_ORDER[scope];
  if (level < 1) return false;  // 'own' — only creator

  // 'group' — backend checks via access views
  // frontend is conservative (returns false for non-owned)
  if (level < 2) return false;

  // 'organization' — compare resource org against user's active org
  if (resource.activeOrgId != null && resource.orgId === resource.activeOrgId) return true;
  if (level < 3) return false;

  // 'any'
  return true;
}
```

---

## 6. Features

### Definition

Features gate **product areas**, not resource permissions. They are simple booleans (on/off).

```typescript
export const FEATURES = ['ai.chat', 'org.manage'] as const;
export type FeatureKey = (typeof FEATURES)[number];
```

`ai.chat` = AI-powered flashcard generation. `org.manage` = Organization management panel.

### `DEFAULT_ROLE_FEATURES`

```typescript
export const DEFAULT_ROLE_FEATURES: Record<string, FeatureKey[]> = {
  member: ['ai.chat'],
  teacher: ['ai.chat', 'org.manage'],
  admin: ['ai.chat', 'org.manage'],
};
```

### Resolution order (`getEnabledFeatures()`)

```
1. Role defaults (from DEFAULT_ROLE_FEATURES)
2. User overrides (from user_feature_overrides table, if present)
3. Plan inclusion (from plan_features table, if implemented)
```

Overrides can add or remove features from the default list. The DB tables (`user_feature_overrides`, `plan_features`) already exist from the old system and are reused.

### Usage

```typescript
// Server: feature gate at controller level
requireFeature(ctx, 'ai.chat');  // throws FORBIDDEN if not enabled

// Client: check in UI
hasFeature('org.manage');  // boolean
```

Features are checked at the entry point of a feature (API route, page render), not inside `authz.evaluate()` or `checkPermission()`.

---

## 7. Permission vs Feature: When to Use Which

| Check | Example | Mechanism |
|-------|---------|-----------|
| "Can this user create a deck?" | Button: "Create Deck" | `can('deck.create')` → scope evaluation |
| "Can this user edit this deck?" | Button: "Edit" | `can('deck.update', deck.created_by, deck.organization_id)` → scope |
| "Can this user delete this flashcard?" | Button: "Delete" | `can('flashcard.delete', fc.created_by)` → scope |
| "Can this user access AI chat?" | Sidebar link: "AI Chat" | `hasFeature('ai.chat')` → boolean |
| "Can this user manage org settings?" | Page: Manage Panel | `hasFeature('org.manage')` → boolean |

The litmus test: if the check needs a `resource` context (createdBy, orgId), it's a **permission**. If it's a static area toggle, it's a **feature**.

---

## 8. `buildQueryFilter` — Read Scope → DB Filter

| Scope | Filter | Notes |
|-------|--------|-------|
| `any` | `{}` | No filtering |
| `organization` | `{ organization_id: ctx.activeOrgId }` | Direct query, no visibility filter — admin sees all |
| `group` | `{ _useRpc: true, organization_id: ctx.activeOrgId }` | RPC — own personal + content shared with user's groups |
| `own` | `{ created_by: ctx.userId, organization_id: ctx.activeOrgId }` (or without org if null) | Direct query, creator-scoped |

`'group'` read scope uses RPC because the RPC functions handle visibility correctly (own personal + content shared via group associations). `'organization'` uses a direct query with just `organization_id` — no visibility filter, so admin sees all org content. `'own'` uses direct query because it only needs `created_by = userId`.

---

## 9. Visibility: Access Views

Not yet implemented (future). Currently visibility is handled by RPC functions in `61_content_groups.sql`. When access views are added:

```sql
CREATE VIEW deck_group_access AS
SELECT dg.deck_id, dg.group_id, gm.user_id
FROM deck_groups dg
JOIN group_members gm ON gm.group_id = dg.group_id;
```

These would replace the RPC internals but the service layer call pattern stays the same.

---

## 10. Default Role Configuration Summary

### member (student)

| Permission | Scope |
|-----------|-------|
| `*.read` | **`group`** |
| `*.create` | `own` |
| `*.update` | `own` |
| `*.delete` | `own` |
| **Feature: `ai.chat`** | enabled |

### teacher

| Permission | Scope |
|-----------|-------|
| `*.read` | `own` |
| `*.create` | `own` |
| `*.update` | `own` |
| `*.delete` | `own` |
| **Feature: `ai.chat`** | enabled |
| **Feature: `org.manage`** | enabled |

### admin

| Permission | Scope |
|-----------|-------|
| `*.read` | `organization` |
| `*.create` | `organization` |
| `*.update` | `organization` |
| `*.delete` | `organization` |
| **Feature: `ai.chat`** | enabled |
| **Feature: `org.manage`** | enabled |

---

## 11. Teacher Story (verification)

> Teacher1 in group A creates a deck with `visibility = 'group'` + group A.
> Students in group A see the deck. Students in group B don't.
> Teacher2 in group A does NOT see Teacher1's deck.
> Teacher1 can edit/delete their own deck. Teacher2 cannot.

| Check | Teacher1 → own deck | Teacher2 in group A → Teacher1's deck | Student A in group A | Admin in org A |
|-------|---------------------|---------------------------------------|---------------------|----------------|
| **Feature** | `ai.chat`: ✅ | `ai.chat`: ✅ | `ai.chat`: ✅ | `ai.chat`: ✅, `org.manage`: ✅ |
| **Scope** | `read: own`, `update: own` | `read: own`, `update: own` | `read: group` | `read: organization` |
| `createdBy === user`? | ✅ → allowed | ❌ | ❌ | ❌ |
| `orgId === activeOrgId`? | N/A (owner) | N/A (scope=own) | N/A (scope=group) | ✅ → direct path |
| In group A (via RPC)? | N/A (owner) | ❌ (scope=own) | ✅ | N/A (no filter) |
| **Result** | ✅ Can read, edit, delete | ❌ Can't see | ✅ Can read | ✅ Can read |

---

## 12. Implementation Phases

| Phase | What | Files |
|-------|------|-------|
| **1** ✅ | Create core modules | `permissions.ts`, `features.ts`, `authz.ts` |
| **2** ✅ | Rewrite server authz | `rbac.ts` |
| **3** ✅ | Rewrite frontend hooks | `use-can.ts`, `use-feature.ts`, `use-permissions.ts` |
| **4** | Update seed + classroom | `09_perms.sql`, `classroom.service.ts`, `permissions.controller.ts` |
| **5** | Delete old feature system | 15 files (services, controllers, models, routes) |
| **6** | Update frontend components | ~12 component files |
| **7** | Fix buildQueryFilter + evaluateScope | `rbac.ts`, `authz.ts` (nit-picks from audit) |

---

## 13. Key Design Decisions

1. **Features are NOT permission wrappers** — they gate product areas (AI Chat, Manage panel). Resource permissions (`deck.*`, `flashcard.*`) are never gated by features. Feature-gating flashcards was a mistake in the old model.

2. **`'granted'` scope removed** — was a vestige of `ai.chat`/`org.manage` wearing a permission costume. Features now handle this via boolean on/off.

3. **`ai.chat` and `org.manage` removed from Permission enum** — they're features, not permissions. Frontend uses `hasFeature()` not `can()`.

4. **`PERMISSION_FEATURE_MAP` removed** — permissions don't belong to features. Features and permissions are fully independent.

5. **Quotas (limits) are separate** — not part of authz or features. A `quotas.ts` module checks usage limits at the controller level. Free users get limited deck counts via quotas, not feature flags.

6. **`organization` read scope uses direct query** — no visibility filter, admin sees all org content. `group` scope uses RPC for visibility-aware queries (own personal + group-shared). The old direct path for `organization` scope was doubly wrong: it forced `visibility: 'group'` and used the wrong access logic.

7. **Pre-market** — we can rip things out and replace freely. No backward compat.
