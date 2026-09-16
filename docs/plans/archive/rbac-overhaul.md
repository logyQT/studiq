# P1 Multi-Tenant RBAC Overhaul

**Status:** Spec (pre-implementation)
**Date:** 2026-07-03

---

## 0. Core Concepts — Two Separate Axes

```
account_type (JWT, global) → WHO YOU ARE
  student   — here to learn
  educator  — here to teach
  manager   — here to run organizations

org_role (per-org, in DB) → WHAT YOU CAN DO IN THIS ORG
  Fully composable per-org. Default roles: member, teacher, admin.
  Orgs can create custom roles with any name and permission mix.
```

No coupling between the two. An org can assign a `student` type an `admin` role if they want. Not our business.

---

## 1. Database Schema Changes

### 1a. New enum — `account_type`

Replaces `user_role`. The old enum is dropped entirely.

**File:** `supabase/schemas/00_enums.sql`

```sql
CREATE TYPE account_type AS ENUM ('student', 'educator', 'manager');
DROP TYPE IF EXISTS user_role;  -- in migration only
```

### 1b. New table — `org_roles`

**File:** new `supabase/schemas/56_org_roles.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | `gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL FK → organizations(id) ON DELETE CASCADE` | |
| `name` | `text NOT NULL` | e.g. `'member'`, `'teacher'`, `'admin'`, `'lab assistant'` |
| `description` | `text` | optional |
| `is_system` | `boolean DEFAULT false` | system roles can't be deleted/renamed |
| `UNIQUE` | `(organization_id, name)` | |

**Default roles seeded per org on creation:**

| Role | `is_system` | Description |
|------|-------------|-------------|
| `member` | `true` | Base learner — read org content, create own |
| `teacher` | `true` | Educator — full CRUD over org content |
| `admin` | `true` | Org manager — settings, members, roles, billing |

### 1c. New table — `org_role_permissions`

Replaces `role_permissions`. Maps each org role to atomic permissions with scopes.

**File:** `supabase/schemas/56_org_roles.sql` (same file)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `org_role_id` | `uuid NOT NULL FK → org_roles(id) ON DELETE CASCADE` | |
| `permission_name` | `text NOT NULL` | Refers to `permissions.name` (existing table) |
| `scope` | `text NOT NULL` | One of: `'own'`, `'organization'`, `'any'`, `'granted'` |
| `UNIQUE` | `(org_role_id, permission_name)` | |

**Scope meanings:**

| Scope | Query filter |
|-------|-------------|
| `own` | `created_by = userId` (+ `organization_id = activeOrgId` if in org) |
| `organization` | `organization_id = activeOrgId AND visibility = 'org'` |
| `any` | No filter (all resources) |
| `granted` | Boolean gate — no resource filter |

**Default permission matrix per org:**

| Permission | member | teacher | admin |
|---|---|---|---|
| `flashcard.read` | organization | organization | organization |
| `flashcard.create` | own | organization | organization |
| `flashcard.update` | own | organization | organization |
| `flashcard.delete` | own | own | organization |
| `topic.*` | same | same | organization |
| `deck.*` | same | same | organization |
| `question.*` | same | same | organization |
| `question_bank.*` | same | same | organization |
| `ai.chat` | — | granted | granted |
| `org.manage` | — | granted | granted |

### 1d. Modify — `org_members`

**File:** `supabase/schemas/05_org_members.sql`

```
DROP COLUMN role;                    -- was user_role type
ADD COLUMN org_role_id uuid NOT NULL REFERENCES org_roles(id);
```

### 1e. Modify — `organizations` (sub-orgs)

**File:** `supabase/schemas/03_organizations.sql`

```
ADD COLUMN parent_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
```

Supports arbitrary nesting (N levels). Frontend limits to 2 (org → sub-org) in P1.

### 1f. Modify — `invitations`

**File:** `supabase/schemas/07_invitations.sql`

```
RENAME COLUMN target_role TO target_org_role_id;
ALTER COLUMN target_org_role_id TYPE uuid;  -- FK → org_roles(id)
```

### 1g. Drop

```
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS org_role_display_names;  -- no code references
```

---

## 2. Authentication Flows

### 2a. Registration (`auth.service.ts`)

On signup:
- `supabase.auth.signUp()` with `options.data: { account_type }`
- After signup, `admin.updateUserById(user.id, { app_metadata: { account_type } })`
- The JWT now carries `app_metadata.account_type` instead of `app_metadata.role`

### 2b. Account type → post-signup flow

| Account type | After successful auth |
|---|---|
| `student` | Redirect to `/app`. No org. |
| `educator` | Redirect to `/onboarding/classroom-setup` (if no org) |
| `manager` | Redirect to `/onboarding/org-setup` (if no org) |

Detection: callback route checks whether user has any row in `org_members`. If not, redirects to onboarding.

### 2c. Educator onboarding (`/onboarding/classroom-setup`)

```
Screen 1 — "How will you use StudiQ?"
  [I'm part of a bigger organization]  → /join?type=educator (invite flow)
  [I'm a solo educator / entrepreneur] → Screen 2

Screen 2 — "Name your classroom"
  Name: [My Classroom]
  Slug: [my-classroom]    ← auto-generated from name, editable
  [Create Classroom]
```

On submit:
1. `POST /api/v1/organizations` → creates org with `parent_id: null`
2. Seed default roles (member, teacher, admin) into `org_roles`
3. Seed default permissions from matrix into `org_role_permissions`
4. Insert `org_members` row linking educator to `admin` role
5. Set `active_org_id` cookie
6. Redirect to `/edu`

### 2d. Manager onboarding (`/onboarding/org-setup`)

```
Screen 1 — Organization details
  Name: [University of ...]
  Slug: [auto-generated]

Screen 2 — Structure (optional)
  Add departments/sub-orgs upfront or skip

Screen 3 — Invite first members
```

Same flow as educator for org creation.

### 2e. `active_org_role` cookie — REMOVED

No longer set or read anywhere. The org role is loaded on each request from `org_members.org_role_id`.

**Files to modify:**
- `proxy.ts` — remove `active_org_role` read
- `with-auth.ts` — remove `active_org_role` read
- `orgs/switch/route.ts` — stop setting the cookie
- `invitations/accept/route.ts` — stop setting the cookie
- `teacher/classrooms/route.ts` — stop setting the cookie

### 2f. `handle_new_user` trigger

No longer creates personal orgs (already done in earlier migration). Only:
1. Creates profile (existing)
2. Accepts invitation if token present and creates `org_members` with `target_org_role_id`
3. Returns

No personal org, no role assignment — that's handled by the app layer.

---

## 3. TypeScript Type Changes

### 3a. `src/types/index.ts`

```typescript
export enum AccountType {
  STUDENT = 'student',
  EDUCATOR = 'educator',
  MANAGER = 'manager',
}

export type OrgRole = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
};

// REMOVE:
// - UserRole enum (entirely)
// - ORGANIZATION_ROLES constant
// - OrganizationRole type
// - any UserRole re-exports
```

### 3b. `src/lib/request-context.ts`

```typescript
export interface RequestContext {
  traceId: string;
  userId: string;
  accountType: AccountType;       // from JWT app_metadata.account_type
  orgRoleId: string | null;       // from org_members (loaded in with-auth)
  activeOrgId: string | null;     // from active_org_id cookie
  url: string;
  method: string;
}
// REMOVE role: UserRole
```

---

## 4. Permission Engine Rewrite (`src/lib/rbac.ts`)

### 4a. Scope resolution

```typescript
async function getScope(
  accountType: AccountType,
  orgRoleId: string | null,
  permission: string,
): Promise<PermissionScope | null> {
  // 1. Org context → check org_role_permissions
  if (orgRoleId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('org_role_permissions')
      .select('scope')
      .eq('org_role_id', orgRoleId)
      .eq('permission_name', permission)
      .maybeSingle();
    if (data) return data.scope as PermissionScope;
  }

  // 2. No org context → account_type defaults (minimal)
  if (accountType === AccountType.STUDENT || accountType === AccountType.EDUCATOR) {
    if (
      permission.endsWith('.read') || permission.endsWith('.create') ||
      permission.endsWith('.update') || permission.endsWith('.delete')
    ) {
      return 'own';
    }
  }

  // 3. No match → access denied
  return null;
}
```

### 4b. `checkPermission()` — signature change

```typescript
// Before
export async function checkPermission(ctx: RequestContext, permission: string, resource: Resource | null)
// After — uses ctx.accountType + ctx.orgRoleId
// Implementation unchanged aside from getScope call
```

### 4c. `hasPermission()` — signature change

```typescript
// Before: getScopeForRole(ctx.role, permission)
// After: getScope(ctx.accountType, ctx.orgRoleId, permission)
```

### 4d. `buildQueryFilter()` — signature change

Same pattern — `getScope` replaces `getScopeForRole`. Scope→filter logic stays identical.

### 4e. Remove global cache

The entire `RolePermissionMap`, `cachedRolePermissions`, `loadPromise`, `ensureRolePermissionsLoaded()` — all removed. No global cache. Permission lookups go directly to `org_role_permissions` table per request. Can add caching later with Redis/Memcached if performance requires it.

---

## 5. Middleware & Routing

### 5a. `src/proxy.ts`

- Rename `resolveRole` → `resolveAccountType`
- Read from `user.app_metadata.account_type` — no cookie fallback
- `ROLE_REDIRECTS` → `ACCOUNT_TYPE_REDIRECTS`:

```typescript
const ACCOUNT_TYPE_REDIRECTS: Record<string, string> = {
  [AccountType.STUDENT]: '/app',
  [AccountType.EDUCATOR]: '/edu',
  [AccountType.MANAGER]: '/manage',
};
```

### 5b. `src/server/config/routes.config.ts`

- `redirectIfAuthenticatedByRole` → `redirectIfAuthenticatedByAccountType`
- `allowedRoles` → `allowedAccountTypes` (in `RouteRule`)
- Update all matchers to use `AccountType` enum values

| Route | Guard |
|-------|-------|
| `/admin` | Not in P1 (future system-admin role) |
| `/manage` | `[AccountType.MANAGER]` |
| `/edu` | `[AccountType.EDUCATOR]` |
| `/app` | `[AccountType.STUDENT]` |
| `/api/v1/ai` | `[AccountType.STUDENT, AccountType.EDUCATOR]` |
| `/api/v1/teacher/*` | `[AccountType.EDUCATOR]` |
| `/api/v1/admin/*` | `[AccountType.MANAGER]` |

### 5c. `role.guard.ts`

```typescript
export function roleGuard(accountType: AccountType | undefined, allowedTypes: string[]): boolean {
  if (!accountType) return false;
  return allowedTypes.includes(accountType);
}
```

---

## 6. Service-Level Changes

### 6a. `with-auth.ts`

New role resolution:

```typescript
const accountType = user.app_metadata?.account_type as AccountType;
const cookieOrgId = req.cookies.get('active_org_id')?.value ?? null;
let orgRoleId: string | null = null;

if (cookieOrgId) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('org_role_id')
    .eq('organization_id', cookieOrgId)
    .eq('user_id', user.id)
    .maybeSingle();
  orgRoleId = data?.org_role_id ?? null;
}

// Options filter: check accountType instead of cookieOrgRole
if (options?.allowedAccountTypes && !options.allowedAccountTypes.includes(accountType)) {
  return toNextResponse({ success: false, statusCode: 403, error: 'FORBIDDEN' });
}
```

### 6b. API Routes (all under `src/app/(backend)/api/v1/`)

Rename `allowedRoles` → `allowedAccountTypes` in `WithAuthOptions` across ~15 API route files.

Example:
```typescript
// Before
{ allowedRoles: [UserRole.SYS_ADMIN] }
// After
{ allowedAccountTypes: [AccountType.MANAGER] }
```

**Affected files:**
- `admin/subscription-plans/route.ts` + `[id]/route.ts`
- `admin/plan-features/route.ts`
- `admin/organizations/route.ts` + `[id]/route.ts`
- `admin/permissions/route.ts`
- `admin/user-overrides/route.ts` + `[id]/route.ts`
- `admin/feature-flags/route.ts` + `[id]/route.ts`
- `admin/error-logs/route.ts` + `[id]/route.ts`
- `teacher/classrooms/route.ts`
- `organization/members/route.ts`

### 6c. `invitation.service.ts`

Replace `UserRole` enum references:

| Line | Old | New |
|------|-----|-----|
| `ctx.role === UserRole.SYS_ADMIN` | Role check | `ctx.accountType === AccountType.MANAGER` |
| Invitation inserts | `target_role: data.role` | `target_org_role_id: data.orgRoleId` |
| Validation | `data.role !== UserRole.STUDENT` | Remove — orgs decide who they invite |

The invitation flow changes significantly — invites now target an `org_role_id`, not a role string. Org managers pick from the org's available roles in the invite form.

### 6d. `search.service.ts`

```typescript
// Before
const basePath = ctx.role === UserRole.TEACHER ? '/edu' : '/app';
// After
const basePath = ctx.accountType === AccountType.EDUCATOR ? '/edu' : '/app';
```

### 6e. `topic.service.ts`

Replace hardcoded string comparisons:
```typescript
// Before
const topicVisibility = ctx.role === 'teacher' ? 'org' : 'personal';
// After
const scope = await getScope(ctx.accountType, ctx.orgRoleId, 'topic.create');
const topicVisibility = scope === 'organization' ? 'org' : 'personal';
```

### 6f. `organization-member.service.ts`

Replace `org_members.role` references with `org_role_id`:

- **List members:** `select('..., org_role_id')` → join to `org_roles` for name
- **Filter by role:** `eq('org_role_id', roleId)` instead of `eq('role', roleString)`
- **Change role:** `update({ org_role_id: newRoleId })` instead of `update({ role: newRole })`
- **Remove member:** unchanged (by user_id)

---

## 7. UI Component Changes

### 7a. `role-badge.tsx` → rename to `account-type-badge.tsx`

```typescript
import { AccountType } from '@/types';

const ACCOUNT_TYPE_COLORS: Partial<Record<AccountType, string>> = {
  [AccountType.STUDENT]: 'bg-green-100 text-green-800',
  [AccountType.EDUCATOR]: 'bg-blue-100 text-blue-800',
  [AccountType.MANAGER]: 'bg-orange-100 text-orange-800',
};

const ACCOUNT_TYPE_LABELS: Partial<Record<AccountType, string>> = {
  [AccountType.STUDENT]: 'Student',
  [AccountType.EDUCATOR]: 'Educator',
  [AccountType.MANAGER]: 'Manager',
};

interface AccountTypeBadgeProps {
  accountType: AccountType;
  className?: string;
}
```

### 7b. `Navbar.tsx`

```typescript
const accountType = user?.app_metadata?.account_type as AccountType | undefined;

const navLinks: NavLink[] = (() => {
  switch (accountType) {
    case AccountType.EDUCATOR: return [...educatorDashboardLinks, ...adminLinks];
    case AccountType.MANAGER: return managerLinks;
    default: return studentLinks;
  }
})();
```

### 7c. `user-menu-content.tsx`

Same pattern — dashboard prefix resolved from `AccountType`.

### 7d. `deck-management-screen.tsx` + `question-bank-management-screen.tsx`

Replace:
```typescript
const role = (activeOrg?.role ?? user?.app_metadata?.role) as UserRole | undefined;
const canSeeOrg = role === UserRole.TEACHER || role === UserRole.SYS_ADMIN;
```
With:
```typescript
const accountType = user?.app_metadata?.account_type as AccountType | undefined;
const orgRoleName = activeOrg?.orgRoleName; // from use-orgs hook
const canSeeOrg = orgRoleName === 'teacher' || orgRoleName === 'admin' || accountType === AccountType.MANAGER;
```

### 7e. `org-switcher.tsx`

Remove old string comparisons (`'free'`, `'premium'`, `'university_admin'`). Org display adapted for new model.

### 7f. `onboarding-checklist.tsx`

Remove old string comparisons. Account type check replaced with `AccountType.EDUCATOR`.

---

## 8. Hook Changes

### 8a. `use-orgs.ts`

```typescript
type OrgMembership = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  orgRoleId: string;
  orgRoleName: string;   // from join with org_roles
  isActive: boolean;
};
// REMOVE: role: string
// REMOVE: app_metadata.role fallback
// REMOVE: 'free' string references
```

### 8b. `use-can.ts`

```typescript
const PERMISSION_FEATURE_MAP: Record<string, string> = {
  // unchanged — maps permissions to feature keys for plan gating
};
```

Scope resolution adapted: fetch permissions from `GET /api/v1/permissions` which now returns `org_role_permissions` data keyed by `org_role_id` instead of role-permission maps.

### 8c. `use-permissions.ts`

Update API response type — the permissions endpoint now returns `org_role_permissions` format.

---

## 9. Frontend Pages

### 9a. Register page (`register/page.tsx`)

RadioGroup options:
- `student` (unchanged)
- `educator` (was `teacher` — rename value)
- `manager` (new)

### 9b. Manage pages (`manage/page.tsx`, `manage/members/page.tsx`, `manage/invitations/page.tsx`)

- Member role filter → org role filter (dropdown populated from org's available roles)
- Role badge → org role name badge
- Invite form role select → org role select (from org's available roles)
- `ORGANIZATION_ROLES` → fetch from `org_roles` for the active org

### 9c. Admin page (`admin/page.tsx`)

- Platform admin creates accounts directly in PG (future: dedicated admin panel)
- Invitation form: org role select dynamically populated from selected org's roles

---

## 10. Registration Flow Detail

### 10a. Register page form

```
fields: name, email, accountType (radio: student/educator/manager), password
```

On submit → `POST /api/v1/auth/register`

### 10b. `auth.service.ts` register

```typescript
async register(data: RegisterInput): Promise<void> {
  const supabase = await createClient();
  let role = data.accountType; // 'student', 'educator', or 'manager'

  // Invite flow (same as before, but role comes from invite's target_org_role_id)
  if (data.inviteToken) {
    // ...look up invitation, validate, override role from invitation's org_role
  }

  const { data: signUpData, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        name: data.name,
        account_type: role,
        invite_token: data.inviteToken,
      },
    },
  });

  if (signUpData.user) {
    const serviceSupabase = createServiceClient();
    await serviceSupabase.auth.admin.updateUserById(signUpData.user.id, {
      app_metadata: { account_type: role },
    });
  }
}
```

### 10c. Post-verification flow (callback route)

```
After successful auth:
  1. Check if user has org_members row
  2. If yes → check account_type → redirect to dashboard
  3. If no:
     - student → redirect to /app
     - educator → redirect to /onboarding/classroom-setup
     - manager → redirect to /onboarding/org-setup
```

---

## 11. Onboarding Pages

New directory: `src/app/(frontend)/(onboarding)/`

### `/onboarding/classroom-setup`

Two screens (client component with step state):
1. Option picker: solo vs big org
2. Classroom details form

Uses:
- `POST /api/v1/organizations` (create org)
- Trigger: seed `org_roles` + `org_role_permissions` in the same request
- `POST /api/v1/organizations/[id]/members` (add self as admin)
- Set `active_org_id` cookie
- Redirect to `/edu`

### `/onboarding/org-setup`

Three screens (client component):
1. Org details
2. Optional sub-orgs
3. Invite members

---

## 12. Sub-Org Rules

- Schema supports N levels of nesting
- P1 frontend limits UI to 2 levels (org → sub-org)
- Membership is per-org: admin of parent does NOT auto-grant access to sub-orgs
- When creating a sub-org, default roles are cloned from the parent
- Sub-orgs appear in org switcher with indentation/grouping

---

## 13. Migration (`20260703000010`)

In order:

1. Create `account_type` PG enum
2. Create `org_roles` table
3. Create `org_role_permissions` table
4. Drop `role_permissions` table
5. Drop `org_role_display_names` table
6. `ALTER TABLE organizations ADD COLUMN parent_id`
7. For each existing org: insert 3 default roles (member, teacher, admin) + permissions
8. `ALTER TABLE org_members DROP COLUMN role`
9. `ALTER TABLE org_members ADD COLUMN org_role_id` — migrate existing rows to teacher/admin based on their string role
10. `ALTER TABLE invitations RENAME target_role TO target_org_role_id` + change type to uuid
11. Update `handle_new_user` trigger for new column names
12. Drop `user_role` PG enum

---

## 14. Seed Updates (deferred — for later)

### `01_seed.sql`
- 7 users: 1 manager (platform), 1 manager (org), 1 educator, 4 students
- Dev University org with 3 default roles
- No personal/premium/free users
- `app_metadata.account_type` instead of `app_metadata.role`

### `09_perms.sql`
- Replace `role_permissions` inserts with `org_role_permissions` inserts for the default roles
- Permission matrix as specified in section 1c

---

## 15. What's NOT in P1

| Feature | Reason |
|---------|--------|
| System-wide admin panel (`/admin`) | Future — separate from multi-tenant RBAC |
| Permission editing UI in org settings | Org managers use API for now |
| Sub-org onboarding templates | P2 |
| Billing integration for manager accounts | P2 |
| `ai.chat` plan gating | Frontend-only for now; RBAC seeds it as `granted` or `—` |
| Role → feature mapping UI | Org managers use API for now |

---

## 16. Execution Order (Status: 2026-07-03 session)

| Step # | What | Status |
|--------|------|--------|
| 1 | Types: `AccountType` enum, `RequestContext` update | ✅ Done |
| 2 | Schema files: enums, `org_roles`, `org_members`, `organizations`, `invitations` | ✅ Done |
| 3 | Migration `20260703000010` | ✅ Done |
| 4 | `with-auth.ts` — new role resolution (load `orgRoleId`, no cookie) | ✅ Done |
| 5 | `rbac.ts` — permission engine rewrite | ✅ Done |
| 6 | `proxy.ts` + `routes.config.ts` — update routing + guards | ✅ Done |
| 7 | All service files — bulk rename + logic update | ✅ Done |
| 8 | All API route files — rename `allowedRoles` | ✅ Done |
| 9 | All UI components + hooks — type updates + removal of old role refs | ✅ Done |
| 10 | Onboarding pages — new (classroom-setup, org-setup) | ✅ Done |
| 11 | Cleanup: remove `active_org_role` cookie from switch/invite/classroom routes | ✅ Done |
| 12 | Seeds — update `01_seed.sql` + `09_perms.sql` | ✅ Done |
| 13 | Tests — update `__tests__/` | ✅ Done |
| 14 | Final lint + build validation | ✅ Done |
