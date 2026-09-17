# Groups PRD

**Feature:** Lightweight user groups within an organization
**Status:** ✅ P1 Implemented
**Date:** 2026-07-03 (updated 2026-07-06)

---

## Problem

Organizations have natural subgroups — departments, courses, classes — but the current model forces either a single flat org (everyone sees everything) or deep sub-orgs (duplicated memberships, hierarchy complexity). Neither works for the common case: **300 students shared across BioChem and Maths, with two isolated teachers.**

Sub-orgs would require 300 duplicated `org_members` rows and students would see two orgs in the switcher. Groups solve this with one org, one membership, and lightweight tags.

---

## Design Principles

1. **Groups organize people, not content** — P1 is about member management only. Content scoping by group is deferred to P2.
2. **Students see everything** — all org content, from all groups. Groups are invisible to students. ⚠️ Superseded by P2 (see [p2-groups-prd.md](p2-groups-prd.md)) — students are now scoped by group membership, same as the P2 content-scoping model.
3. **Teachers manage their groups** — teachers see and manage members of their assigned groups only.
4. **Managers manage everything** — `org.manage` permission gives full access to all groups and members.
5. **No hierarchy** — groups are flat within an org. No nesting.

---

## Actors

| Actor | Description |
|---|---|
| **Org Manager** | `manager` account type, `admin` org role. Creates, edits, deletes groups. Assigns any member to any group. Views all members. |
| **Teacher** | `educator` account type, `teacher` org role. Manages members of their assigned groups. Views only their group members. |
| **Student** | `student` account type, `member` org role. Groups are invisible. Sees all org content. |

---

## Tables ✅

```sql
groups:
  id              uuid PK DEFAULT gen_random_uuid()
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
  name            text NOT NULL
  description     text
  created_at      timestamptz DEFAULT now()
  UNIQUE(organization_id, name)

group_members:
  id              uuid PK DEFAULT gen_random_uuid()
  group_id        uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
  role            text NOT NULL CHECK (role IN ('teacher', 'member'))
  joined_at       timestamptz DEFAULT now()
  UNIQUE(group_id, user_id)
```

**Why simple `CHECK` for role instead of FK to `org_roles`:**
Group roles are intentionally simpler — just `teacher` and `member`. Teachers manage group content/members, members participate. No custom roles per group. This avoids per-group `org_roles` tables.

**Why `group_members.user_id` references `profiles` directly:**
A user doesn't strictly need to be an `org_members` row to be in a group. However, for P1 only existing org members can be assigned.

---

## Schema changes ✅

**Migration `20260703000012`:**
1. Create `groups` table
2. Create `group_members` table
3. Indexes on `group_members.group_id` and `group_members.user_id`

**New schema file:** `supabase/schemas/60_groups.sql` 🔄 named `60` instead of PRD's `58` (other schemas numbered up to 58)

**Existing schemas:** No changes needed. Content tables are untouched in P1.

---

## API ✅

### New endpoints

| Method | Route | Purpose | Status |
|--------|-------|---------|--------|
| `GET` | `/api/v1/organization/groups` | List all groups in the active org | ✅ |
| `POST` | `/api/v1/organization/groups` | Create a group | ✅ |
| `PUT` | `/api/v1/organization/groups/:id` | Update group name/description | ✅ |
| `DELETE` | `/api/v1/organization/groups/:id` | Delete group (cascades members) | ✅ |
| `PUT` | `/api/v1/organization/groups/:id/members` | Batch set members (`{ members: [{ userId, role }] }`) | ✅ |
| `GET` | `/api/v1/organization/groups/:id/members` | Get current members of a group | ✅ **➕ ADDED** — not in original spec; needed by frontend to fetch before modify |
| `GET` | `/api/v1/me/groups` | List groups the current user is in (for UI filtering) | ✅ |

### Modified endpoints

| Endpoint | Change |
|---|---|
| `GET /api/v1/organization/members` | Add `groups: [{ id, name, role }]` array to each member ✅ |

### Member response shape (updated) ✅

```typescript
{
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  orgRoleId: string;
  organization_id: string;
  created_at: string;
  groups: { id: string; name: string; role: string }[];  // NEW
}
```

---

## Frontend ✅

### Member management page (`/manage/members`) ✅

Add a "Groups" column showing group badges, and a "Manage groups" action:

```
| Member | Role | Joined | Groups                | Actions |
| John   | tchr | 01/2026| [BioChem] [Maths]     | [Manage groups ▼] |
| Jane   | mb   | 02/2026| [BioChem]              | [Manage groups ▼] |
| Bob    | adm  | 03/2026| —                      | [Manage groups ▼] |
```

**"Manage groups" dialog:**

```
┌────────────────────────────────────────┐
│  Manage groups: John                   │
│                                        │
│  ☑ BioChem     Role: Teacher ▼         │
│  ☑ Maths       Role: Member ▼          │
│  ☐ Physics     Role: Member ▼          │
│                                        │
│            [Cancel]  [Save]            │
└────────────────────────────────────────┘
```

Each group is a row with checkbox + role select. Checking a group adds the member. Unchecking removes them. Role select appears only when checked.

### Groups management page (`/manage/groups` — NEW) ✅

```
┌──────────────────────────────────────────────┐
│  Groups                          [+ New Group]│
│                                               │
│  ┌──────────┬──────────┬──────────┬────────┐ │
│  │ Name     │ Members  │ Teachers │        │ │
│  ├──────────┼──────────┼──────────┼────────┤ │
│  │ BioChem  │ 301      │ 1        │ [Edit] │ │
│  │ Maths    │ 301      │ 1        │ [Edit] │ │
│  │ Physics  │ 0        │ 0        │ [Edit] │ │
│  └──────────┴──────────┴──────────┴────────┘ │
└──────────────────────────────────────────────┘
```

Create/Edit dialog:

```
┌────────────────────────────────┐
│  Create group                  │
│                                │
│  Name: [BioChem             ]  │
│  Description: [Biochemistry ]  │
│                                │
│       [Cancel]  [Create]       │
└────────────────────────────────┘
```

### Sidebar ✅

Add a `/manage/groups` link in the manager sidebar, between Invitations and Settings.

---

## Service layer

### New: `src/server/services/group.service.ts` ✅

| Method | Purpose | Status |
|--------|---------|--------|
| `listGroups(ctx)` | List all groups in `ctx.activeOrgId` | ✅ |
| `createGroup(ctx, data)` | Create a group | ✅ |
| `updateGroup(ctx, id, data)` | Update name/description | ✅ |
| `deleteGroup(ctx, id)` | Delete group | ✅ |
| `setGroupMembers(ctx, groupId, members)` | Replace all members of a group | ✅ |
| `getGroupMembers(ctx, groupId)` | Get current members of a group | ✅ **➕ ADDED** — not in original spec; needed by GET endpoint |
| `listMyGroups(ctx)` | List groups the current user belongs to | ✅ |

### Modified: `organization-member.service.ts` ✅

Extend `listMembers` to include group memberships:

**PRD spec:** nested subquery `group_members(role, groups!inner(id, name))` in the `org_members` select.

**Actual implementation:** 🔄 Two separate Supabase queries merged in TypeScript. PostgREST could not resolve a relationship between `org_members` and `group_members` because `group_members.user_id` FKs to `profiles(id)`, not to `org_members`. No transitive FK inference in PostgREST.

```typescript
// Query 1: org_members + profiles + org_roles
// Query 2: group_members + groups (filtered by user_ids from query 1)
// Merge: groupsByUserId[user_id] attached to each member, [] if none
```

---

## Permission model ✅

All group mutations are gated by `org.manage`. This permission is already seeded as `granted` for the `teacher` and `admin` org roles. The group service checks `checkPermission(ctx, 'org.manage', null)` before writes.

Reading groups is open to all org members (anyone with `orgRoleId` in the org).

---

## Seed grants ✅

Added to `99_dev_grants.sql`:

```sql
GRANT ALL ON public.groups TO authenticated, service_role;
GRANT ALL ON public.group_members TO authenticated, service_role;
```

Plus dedicated migration `20260703000013_grant_groups_permissions.sql`.

---

## Execution order ✅ ALL COMPLETE

| Step | What | Files | Status |
|------|------|-------|--------|
| 1 | DB tables + migration + schema | `60_groups.sql`, migration `20260703000012` | ✅ |
| 2 | `group.service.ts` | CRUD + member assignment service | ✅ |
| 3 | Group API endpoints | `api/v1/organization/groups/route.ts`, `[...id]/members/route.ts`, `api/v1/me/groups` | ✅ |
| 4 | Update member listing | `organization-member.service.ts` — add groups subquery | 🔄 Two-query merge used instead |
| 5 | Groups management page | `manage/groups/page.tsx` | ✅ |
| 6 | Update members page | `manage/members/page.tsx` — groups column + dialog | ✅ |
| 7 | Route rules + sidebar | `routes.config.ts`, sidebar links | ✅ |
| 8 | i18n | `en.json`, `pl.json` | ✅ |
| 9 | Seed grants | `99_dev_grants.sql` + migration | ✅ |
| 10 | Lint + build | Validation | ✅ |

---

## What's NOT in P1 (still deferred ⏳)

1. **Content scoping by group** — no `group_id` columns on content tables
2. **Teacher isolation** — teachers see all org members for now. Group-scoped member filtering is P2.
3. **Student-facing group UI** — groups are invisible to students
4. **Group-specific permissions** — simple `teacher`/`member` only, no custom `org_roles`-style setup
5. **Nested/hierarchical groups** — completely flat
