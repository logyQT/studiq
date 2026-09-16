# StudiQ Study Groups

## Overview

Study groups are sub-units within a university that enable scoped resource sharing. A user can belong to many groups, each with a role (`member` or `manager`). Resources (questions, flashcards, decks, topics) can be shared to exactly one group.

## Design Decisions

- **Single group per resource** — a resource has at most one `group_id`. If content needs to reach multiple groups, the creator copies it to the other group (analogous to Moodle's course/group copy).
- **Membership is many-to-many** — a user can belong to many groups, each with a role.
- **Group scope replaces university scope for STUDENT and TEACHER reads** — STUDENTs and TEACHERs see only their own content + content shared to groups they belong to (not all university content).
- **Managers vs creators** — a group can have multiple managers. Teachers see groups they created OR manage. University admins see all groups.
- **No hyphens in routes** — all API and frontend paths use `/` segments only.

## Database Schema

### `study_groups`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default `gen_random_uuid()` |
| university_id | uuid | FK → `universities(id)` ON DELETE CASCADE, NOT NULL |
| name | text | NOT NULL |
| description | text | nullable |
| created_by | uuid | FK → `profiles(id)` ON DELETE SET NULL |
| created_at | timestamptz | default `now()` |
| updated_at | timestamptz | default `now()` |

```sql
CREATE TABLE public.study_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE NOT NULL,
  name          text NOT NULL,
  description   text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
```

### `group_members`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default `gen_random_uuid()` |
| group_id | uuid | FK → `study_groups(id)` ON DELETE CASCADE, NOT NULL |
| user_id | uuid | FK → `profiles(id)` ON DELETE CASCADE, NOT NULL |
| role | text | CHECK `IN ('member', 'manager')` |
| joined_at | timestamptz | default `now()` |

```sql
CREATE TABLE public.group_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid REFERENCES public.study_groups(id) ON DELETE CASCADE NOT NULL,
  user_id   uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);
```

### Resource tables — added column

Each resource table gets a nullable `group_id` FK:

```sql
ALTER TABLE public.questions         ADD COLUMN group_id uuid REFERENCES public.study_groups(id) ON DELETE SET NULL;
ALTER TABLE public.flashcards        ADD COLUMN group_id uuid REFERENCES public.study_groups(id) ON DELETE SET NULL;
ALTER TABLE public.flashcard_decks   ADD COLUMN group_id uuid REFERENCES public.study_groups(id) ON DELETE SET NULL;
ALTER TABLE public.flashcard_topics  ADD COLUMN group_id uuid REFERENCES public.study_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_questions_group        ON public.questions(group_id);
CREATE INDEX idx_flashcards_group       ON public.flashcards(group_id);
CREATE INDEX idx_flashcard_decks_group  ON public.flashcard_decks(group_id);
CREATE INDEX idx_flashcard_topics_group ON public.flashcard_topics(group_id);
```

### `role_permissions` — scope CHECK updated

```sql
ALTER TABLE public.role_permissions DROP CONSTRAINT role_permissions_scope_check;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_scope_check
  CHECK (scope = ANY (ARRAY['own', 'university', 'any', 'group']));
```

## RBAC Scope: `group`

### Behavior

A `group` scope grants access to resources where **either**:

- The user is the resource `created_by`, OR
- The resource has a `group_id` that the user belongs to (via `group_members`)

### `buildQueryFilter` — returns

```typescript
case 'group': {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', ctx.userId);
  const groupIds = [...new Set(memberships?.map(m => m.group_id) ?? [])];
  const orParts = [`created_by.eq.${ctx.userId}`];
  if (groupIds.length > 0) orParts.push(`group_id.in.(${groupIds.join(',')})`);
  return { or: orParts.join(',') };
}
```

### `checkPermission` — authorization

```typescript
case 'group': {
  if (!resource) throw new AppError('FORBIDDEN');
  if (resource.created_by === ctx.userId) return;
  if (resource.group_id) {
    const supabase = await createClient();
    const { data: member } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', resource.group_id)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (member) return;
  }
  throw new AppError('FORBIDDEN');
}
```

### Frontend `can()`

```typescript
type Scope = 'own' | 'university' | 'any' | 'group';

export function can(
  role: UserRole | undefined,
  permission: string,
  createdBy: string | undefined,
  userId: string | undefined,
  resourceGroupId?: string,
  userGroupIds?: string[],
): boolean {
  if (!role || !userId || !createdBy) return false;
  const scope = ROLE_PERMISSIONS[role]?.[permission];
  if (!scope) return false;
  if (scope === 'any') return true;
  if (scope === 'university') return true;
  if (scope === 'group') return createdBy === userId || (resourceGroupId != null && userGroupIds?.includes(resourceGroupId));
  return createdBy === userId;
}
```

## Permission Seed Changes

### STUDENT — read scope narrowed

```
flashcard.read:  'university' → 'group'
topic.read:      'university' → 'group'
deck.read:       'university' → 'group'
```

### TEACHER — read scope narrowed

```
flashcard.read:  'own' → 'group'
topic.read:      'own' → 'group'
deck.read:       'own' → 'group'
```

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/groups` | any auth | List groups (teacher → own/managed, admin → all) |
| `POST` | `/api/v1/groups` | TEACHER, UNIV_ADMIN | Create group |
| `GET` | `/api/v1/groups/[id]` | any auth | Get group detail |
| `PUT` | `/api/v1/groups/[id]` | creator or admin | Update group |
| `DELETE` | `/api/v1/groups/[id]` | creator or admin | Delete group |
| `GET` | `/api/v1/groups/[id]/members` | any auth | List members |
| `POST` | `/api/v1/groups/[id]/members` | manager or admin | Add member |
| `DELETE` | `/api/v1/groups/[id]/members/[userId]` | manager or admin | Remove member |

## Frontend Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/edu/groups` | Teacher group list | Creates, edits, deletes own/managed groups |
| `/edu/groups/[id]` | Teacher group detail | Member management, group info |
| `/manage/groups` | Admin group list | All university groups |
| `/manage/groups/[id]` | Admin group detail | Full member management |

Sidebar nav items added to both `/edu` and `/manage` layouts.

## Share UI

- **During create/edit**: optional checkbox "Share to group" → group picker dropdown showing user's managed groups
- **From detail page**: share icon button → opens change-group dialog with same picker

## Service Authorization Rules

| Operation | Allowed roles |
|-----------|---------------|
| Create group | TEACHER, UNIVERSITY_ADMIN |
| List groups | TEACHER → own/managed; ADMIN → all; others → empty |
| View group | Member of the group, or admin |
| Update group | Creator, manager, or admin |
| Delete group | Creator, manager, or admin |
| Add/remove members | Manager of the group, or admin |
| View members | Member of the group, or admin |
| Share resource to group | Creator of resource, manager of target group, or admin |

## Existing Services — Auto Benefit

These services use `buildQueryFilter` and need no changes (they automatically get group-scoped queries):

- `flashcard-practice.service.ts`
- `search.service.ts`
- `flashcard-stats.service.ts`
- `flashcard-deck.service.ts`
- `flashcard-topic.service.ts`
- `flashcard.service.ts` (needs `group_id` insert support only)

## Existing Services — Need Refactor

These services do manual scoping and must switch to `buildQueryFilter`:

- `question.service.ts` — `list()`, `getById()` → use `buildQueryFilter`
- `quiz.service.ts` — `generateQuiz()` → use `buildQueryFilter`

## Deletion Behavior

When a group is deleted (`ON DELETE SET NULL`):

- Resources previously shared to that group become **private** (only `created_by` can see them)
- Group membership records are cascaded away
- No data loss — just access scope narrowing
