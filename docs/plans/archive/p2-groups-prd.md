# Groups P2: Content Scoping + Teacher Isolation

**Feature:** Scope content by group membership; isolate teachers to their groups
**Status:** ✅ Implemented (design has since diverged from this draft — see note below)
**Date:** 2026-07-06
**Depends on:** P1 (groups + group_members tables, CRUD API, management UI)

---

## Design Principles

1. **Content follows group membership** — teachers see content from groups they belong to + own personal content. Admin sees everything.
2. **Students are scoped by group** — a student sees their own content plus content shared to groups they belong to, not the whole org. (Confirmed 2026-09-15: the earlier "students see everything" principle below was superseded — restricting by group is the intended behavior, matching how `flashcard-practice.service.ts`'s spaced-repetition RPCs, `question.service.ts`, and `quiz.service.ts`'s `generateQuiz()` all resolve `'member'`'s `flashcard.read`/`question.read` scope to `'group'` in [permissions.ts](../../src/lib/permissions.ts). This doc's original wording — "Students see everything — all org content. Groups remain invisible to students" — is stale and superseded.)
3. **No data migration** — pre-market app. Adjust seed data only.
4. **Group creation stays `org.manage`** — teacher group creation deferred to P3. (Superseded: teacher-initiated group creation shipped in PR #64, gated by the `group.manage` feature flag instead.)

> **Note (2026-09-15):** This document predates several changes and no longer matches the implementation 1:1 — e.g. `groups`/`group_members` (not `study_groups`), teacher group creation and ownership (PR #64, #66), group-based issue reporting and member management (PR #68). One open discrepancy not yet resolved: `permissions.ts` gives the `teacher` org role `'own'` scope for `flashcard.read`/`question.read`/etc. (only their own content), where principle #1 above says teachers should get `'group'` scope. Not yet confirmed which is intended — flagging for a future pass rather than fixing silently.

---

## What Changes

| Area | Change |
|------|--------|
| Visibility enum | Remove `'org'`. Keep `'personal'` + `'group'`. |
| Assignment model | M:N via `deck_groups`, `bank_groups`, `topic_groups` tables. No `group_id` on leaf items. |
| DB queries | Postgres RPCs instead of double-queries or nested joins. |
| Content inheritance | Flashcards → deck, Questions → bank through existing assignment tables. |
| Teacher read scope | Content from their groups + own personal content. |
| Teacher member scope | `listMembers` returns only members of teacher's groups. |
| Default group | Auto-created on org creation. New members auto-joined. Placeholder name, revisit P3. |
| Seed data | Adjust seed to use `'group'` visibility + default group assignments. |

---

## DB Changes

### 1. Alter visibility enum

```sql
ALTER TYPE visibility_type RENAME TO visibility_type_old;
CREATE TYPE visibility_type AS ENUM ('personal', 'group');

ALTER TABLE flashcard_decks
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);

ALTER TABLE flashcards
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);

ALTER TABLE question_banks
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);

ALTER TABLE questions
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);

ALTER TABLE topics
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);

DROP TYPE visibility_type_old;
```

`NO ACTION` — existing seed data is adjusted to `'group'` + assigned to default group.

### 2. Assignment tables

```sql
CREATE TABLE deck_groups (
  deck_id  uuid NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, group_id)
);
CREATE INDEX idx_deck_groups_group_id ON deck_groups(group_id);
CREATE INDEX idx_deck_groups_deck_id ON deck_groups(deck_id);

CREATE TABLE bank_groups (
  bank_id  uuid NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (bank_id, group_id)
);
CREATE INDEX idx_bank_groups_group_id ON bank_groups(group_id);
CREATE INDEX idx_bank_groups_bank_id ON bank_groups(bank_id);

CREATE TABLE topic_groups (
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, group_id)
);
CREATE INDEX idx_topic_groups_group_id ON topic_groups(group_id);
CREATE INDEX idx_topic_groups_topic_id ON topic_groups(topic_id);
```

### 3. Content RPCs

One per content type for group-scoped listing.

```sql
CREATE FUNCTION get_accessible_flashcard_decks(p_user_id uuid, p_org_id uuid)
RETURNS SETOF flashcard_decks LANGUAGE sql STABLE AS $$
  SELECT DISTINCT d.*
  FROM flashcard_decks d
  LEFT JOIN deck_groups dg ON dg.deck_id = d.id
  LEFT JOIN group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE d.organization_id = p_org_id
    AND (
      (d.visibility = 'personal' AND d.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
```

```sql
CREATE FUNCTION get_accessible_flashcards(p_user_id uuid, p_org_id uuid)
RETURNS SETOF flashcards LANGUAGE sql STABLE AS $$
  SELECT DISTINCT f.*
  FROM flashcards f
  LEFT JOIN flashcard_deck_assignments fda ON fda.flashcard_id = f.id
  LEFT JOIN deck_groups dg ON dg.deck_id = fda.deck_id
  LEFT JOIN group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE f.organization_id = p_org_id
    AND (
      (f.visibility = 'personal' AND f.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
```

```sql
CREATE FUNCTION get_accessible_question_banks(p_user_id uuid, p_org_id uuid)
RETURNS SETOF question_banks LANGUAGE sql STABLE AS $$
  SELECT DISTINCT b.*
  FROM question_banks b
  LEFT JOIN bank_groups bg ON bg.bank_id = b.id
  LEFT JOIN group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE b.organization_id = p_org_id
    AND (
      (b.visibility = 'personal' AND b.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
```

```sql
CREATE FUNCTION get_accessible_questions(p_user_id uuid, p_org_id uuid)
RETURNS SETOF questions LANGUAGE sql STABLE AS $$
  SELECT DISTINCT q.*
  FROM questions q
  LEFT JOIN question_bank_assignments qba ON qba.question_id = q.id
  LEFT JOIN bank_groups bg ON bg.bank_id = qba.bank_id
  LEFT JOIN group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE q.organization_id = p_org_id
    AND (
      (q.visibility = 'personal' AND q.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
```

```sql
CREATE FUNCTION get_accessible_topics(p_user_id uuid, p_org_id uuid)
RETURNS SETOF topics LANGUAGE sql STABLE AS $$
  SELECT DISTINCT t.*
  FROM topics t
  LEFT JOIN topic_groups tg ON tg.topic_id = t.id
  LEFT JOIN group_members gm ON gm.group_id = tg.group_id AND gm.user_id = p_user_id
  WHERE t.organization_id = p_org_id
    AND (
      (t.visibility = 'personal' AND t.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
```

### 4. Helper RPC

```sql
CREATE FUNCTION get_user_group_ids(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE AS $$
  SELECT gm.group_id
  FROM group_members gm
  JOIN groups g ON g.id = gm.group_id
  WHERE gm.user_id = p_user_id AND g.organization_id = p_org_id;
$$;
```

### 5. Default group on org creation

When a new organization is created via `organization.service.ts`:

1. Create the org
2. Create a group with name `"Members"` (EN) / `"Członkowie"` (PL) — use `ctx.locale` or default `'pl'`
3. Add the org creator as `group_members` with role `'teacher'`
4. Set the group as "default" for the org

**Add `is_default` column to `groups` table:**

```sql
ALTER TABLE groups ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX idx_groups_one_default_per_org ON groups(organization_id) WHERE is_default = true;
```

### 6. Auto-join on invitation accept

When `invitation.service.ts` accepts an invitation:

1. Create `org_members` row (existing flow)
2. Find default group for the org via `groups.is_default = true`
3. If found, insert `group_members` with `role = 'member'`

### 7. Seed updates

Adjust `99_dev_data.sql` or equivalent:

- Each dev org gets a default group
- All seed content with `visibility = 'org'` changes to `visibility = 'group'` + gets a `*_groups` row for the default group
- All seed `org_members` also get `group_members` row for the default group

---

## RBAC Changes

### 8. Add `'group'` to PermissionScope

```typescript
type PermissionScope = 'own' | 'organization' | 'group' | 'any' | 'granted';
```

### 9. Update teacher role permissions in seed

| Permission | Current teacher scope | P2 teacher scope |
|-----------|----------------------|------------------|
| `flashcard.read` | `organization` | `group` |
| `flashcard_deck.read` | `organization` | `group` |
| `question.read` | `organization` | `group` |
| `question_bank.read` | `organization` | `group` |
| `topic.read` | `organization` | `group` |
| `*.create` | `organization` | `organization` (unchanged) |
| `*.update` | `organization` | `group` |
| `*.delete` | `own` | `own` (unchanged) |

### 10. Update `buildQueryFilter`

```typescript
async function buildQueryFilter(ctx, permission): Promise<QueryFilter> {
  const scope = await getScope(ctx, permission);
  switch (scope) {
    case 'any':
    case 'granted':
      return {};
    case 'organization':
      return { organization_id: ctx.activeOrgId };
    case 'group':
      return { _useRpc: true, organization_id: ctx.activeOrgId };
    case 'own':
      return { created_by: ctx.userId, organization_id: ctx.activeOrgId };
  }
}
```

### 11. Update `checkPermission` for single-item access

```typescript
case 'group':
  if (resource.created_by === ctx.userId) return;
  if (resource.visibility === 'group') {
    const isMember = await isUserInGroup(ctx.userId, groupId);
    if (isMember) return;
  }
  throw new AppError('FORBIDDEN');
```

---

## Service Layer Changes

### 12. `group.service.ts` additions

```typescript
async getUserGroupIds(ctx: RequestContext): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_user_group_ids', {
    p_user_id: ctx.userId,
    p_org_id: ctx.activeOrgId,
  });
  return data?.map(r => r.group_id) ?? [];
}

async isTeacherInGroup(ctx: RequestContext, groupId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', ctx.userId)
    .eq('role', 'teacher')
    .maybeSingle();
  return !!data;
}

async isUserInGroup(ctx: RequestContext, groupId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  return !!data;
}
```

### 13. Content services — list methods

Each `list*` method checks `filter._useRpc`:

```typescript
async listDecks(ctx: RequestContext) {
  const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_DECK_READ);
  const supabase = await createClient();

  if (filter._useRpc) {
    const { data, error } = await supabase.rpc('get_accessible_flashcard_decks', {
      p_user_id: ctx.userId,
      p_org_id: ctx.activeOrgId,
    });
    if (error) throw mapSupabaseError(error);
    return data;
  }

  const { data, error } = await supabase.from('flashcard_decks')
    .select('*')
    .eq('organization_id', ctx.activeOrgId as string);

  if (error) throw mapSupabaseError(error);
  return data;
}
```

### 14. Content services — create/update with `groupIds`

**Create:**
```typescript
async createDeck(ctx: RequestContext, data: CreateDeckInput & { groupIds?: string[] }) {
  checkPermission(ctx, Permission.FLASHCARD_DECK_CREATE, null);
  const supabase = await createClient();

  const { data: deck, error } = await supabase.from('flashcard_decks')
    .insert({ ...data, organization_id: ctx.activeOrgId, created_by: ctx.userId })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);

  if (data.visibility === 'group' && data.groupIds?.length) {
    let authorized = false;
    for (const gid of data.groupIds) {
      if (await groupService.isTeacherInGroup(ctx, gid)) { authorized = true; break; }
    }
    if (!authorized) throw new AppError('FORBIDDEN');

    const rows = data.groupIds.map(gid => ({ deck_id: deck.id, group_id: gid }));
    const { error: ae } = await supabase.from('deck_groups').insert(rows);
    if (ae) throw mapSupabaseError(ae);
  }

  return deck;
}
```

**Update:**
```typescript
async updateDeck(ctx: RequestContext, id: string, data: UpdateDeckInput & { groupIds?: string[] }) {
  // Fetch existing, checkPermission, update fields
  // If groupIds provided: delete all deck_groups for this deck, re-insert new ones
}
```

### 15. Content services — single-item read

```typescript
async getDeckById(ctx: RequestContext, id: string) {
  const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_DECK_READ);
  const supabase = await createClient();

  if (filter._useRpc) {
    const { data, error } = await supabase.rpc('get_accessible_flashcard_decks', {
      p_user_id: ctx.userId,
      p_org_id: ctx.activeOrgId,
    }).eq('id', id).single();
    if (error) {
      if (error.code === 'PGRST116') throw new AppError('NOT_FOUND');
      throw mapSupabaseError(error);
    }
    return data;
  }

  // Admin: direct query
  const { data, error } = await supabase.from('flashcard_decks')
    .select('*')
    .eq('id', id)
    .eq('organization_id', ctx.activeOrgId)
    .single();
  if (error) throw mapSupabaseError(error);
  return data;
}
```

### 16. Content services — update/delete permission check

On update/delete, after fetching the resource:
- If `visibility = 'group'`, find the deck's groups via `deck_groups`
- If caller is not creator and not admin, check `groupService.isTeacherInGroup()` for at least one group
- If no match, throw FORBIDDEN

### 17. `organization-member.service.ts` `listMembers`

```typescript
async listMembers(ctx: RequestContext, roleFilter?: string) {
  const scope = await getScope(ctx, Permission.ORG_MANAGE);

  if (scope === 'group') {
    const groupIds = await groupService.getUserGroupIds(ctx);
    if (groupIds.length === 0) return [];

    const supabase = await createClient();
    const { data: gmData } = await supabase.from('group_members')
      .select('user_id')
      .in('group_id', groupIds);
    const userIds = [...new Set(gmData?.map(gm => gm.user_id) ?? [])];
    if (userIds.length === 0) return [];

    let query = supabase.from('org_members')
      .select('user_id, org_role_id, org_roles!inner(name), profiles!inner(id, email, full_name, created_at)')
      .in('user_id', userIds)
      .eq('organization_id', ctx.activeOrgId);

    if (roleFilter) query = query.eq('org_roles.name', roleFilter);

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return data.map(/* same mapper as now */);
  }

  // Admin: all org members (existing flow)
}
```

### 18. `organization.service.ts` — auto-create default group

Add to `createOrganization`:

```typescript
// After org is created:
const defaultGroupName = ctx.locale === 'en' ? 'Members' : 'Członkowie';
const { data: group, error: ge } = await supabase.from('groups')
  .insert({
    organization_id: org.id,
    name: defaultGroupName,
    description: null,
    is_default: true,
  })
  .select()
  .single();
if (ge) throw mapSupabaseError(ge);

const { error: me } = await supabase.from('group_members')
  .insert({ group_id: group.id, user_id: ctx.userId, role: 'teacher' });
if (me) throw mapSupabaseError(me);
```

### 19. `invitation.service.ts` — auto-join default group

When an invitation is accepted, after `org_members` insert:

```typescript
const { data: defaultGroup } = await supabase.from('groups')
  .select('id')
  .eq('organization_id', orgId)
  .eq('is_default', true)
  .single();

if (defaultGroup) {
  await supabase.from('group_members')
    .insert({ group_id: defaultGroup.id, user_id: newMemberId, role: 'member' });
}
```

---

## Model Changes

### 20. Updated schemas

**`flashcard-deck.model.ts`:**
```typescript
const CreateFlashcardDeckSchema = registry.register('CreateFlashcardDeckRequest', z.object({
  name: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
  description: z.string().optional(),
  visibility: z.enum(['personal', 'group'], { error: ValidationErrorCode.INVALID_INPUT }),
  groupIds: z.array(z.string().uuid()).optional(),
}));

const UpdateFlashcardDeckSchema = registry.register('UpdateFlashcardDeckRequest', z.object({
  name: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }).optional(),
  description: z.string().optional(),
  visibility: z.enum(['personal', 'group'], { error: ValidationErrorCode.INVALID_INPUT }).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
}));
```

Same pattern for `question-bank.model.ts` and `topic.model.ts`.

---

## Controller Changes

### 21. Pass `groupIds` from body to service

Minimal change — controllers already parse the full body and pass it. Just ensure `groupIds` is not stripped.

---

## Frontend Changes

### 22. Content create/edit forms

**Visibility selector:**
```
[Personal]  [Group]
```

- `Personal` = only me
- `Group` = select one or more groups

**Group multi-select** (shown when Group is selected):
- Dropdown/combobox with checkboxes
- Teachers: shows groups where they have `teacher` role
- Admin: shows all org groups
- Pre-filled on edit

### 23. Content list views

- Group badges on each item (e.g., `[BioChem] [Maths]`)
- Filter dropdown: "All groups" | "My groups" | specific group name
- Admin sees group badges for all content; teachers see group badges for their accessible content

### 24. Members page

- If caller's scope is `'group'`, the members list shows only group members
- The "Manage groups" dialog still works for admins
- For teachers: the dialog shows only groups they teach + current member's assignment

---

## i18n Keys

### New keys needed

```
// Group visibility
"group_visibility_label"
"group_visibility_personal"
"group_visibility_group"
"group_select_placeholder"
"group_select_no_groups"

// Content list
"filter_all_groups"
"filter_my_groups"

// Default group
"default_group_name"  → "Members" / "Członkowie"
```

---

## Execution Order

| # | Step | Files |
|---|------|-------|
| 1 | Migration: add `is_default` to `groups`, alter enum | `20260706000001_alter_visibility.sql` |
| 2 | Migration: assignment tables + indexes | `20260706000002_create_assignment_tables.sql` |
| 3 | Migration: content RPCs (5x) + helper RPC | `20260706000003_create_content_rpcs.sql` |
| 4 | RBAC: add `'group'` scope to `PermissionScope` | `src/types/` + `src/lib/rbac.ts` |
| 5 | RBAC: update `buildQueryFilter` for `'group'` scope | `src/lib/rbac.ts` |
| 6 | RBAC: update `checkPermission` for group-scoped resources | `src/lib/rbac.ts` |
| 7 | RBAC: update seed teacher permissions (`.read` → `'group'`) | seed file |
| 8 | Group service: add `getUserGroupIds`, `isTeacherInGroup`, `isUserInGroup` | `src/server/services/group.service.ts` |
| 9 | Org service: auto-create default group | `src/server/services/organization.service.ts` |
| 10 | Invitation service: auto-join default group | `src/server/services/invitation.service.ts` |
| 11 | Flashcard-deck service: RPC for list, groupIds for create/update, scope check for single-item | `src/server/services/flashcard-deck.service.ts` |
| 12 | Flashcard service: RPC for list | `src/server/services/flashcard.service.ts` |
| 13 | Question-bank service: RPC for list, groupIds for create/update | `src/server/services/question-bank.service.ts` |
| 14 | Question service: RPC for list | `src/server/services/question.service.ts` |
| 15 | Topic service: RPC for list, groupIds for create/update | `src/server/services/topic.service.ts` |
| 16 | Member service: filter by group for teacher scope | `src/server/services/organization-member.service.ts` |
| 17 | Content models: add `groupIds` to create/update schemas | 3 model files |
| 18 | Content controllers: no structural change, just pass through | 5 controller files |
| 19 | Frontend: content create/edit forms (visibility + group picker) | ~3 form components |
| 20 | Frontend: content list views (group badges, filter) | ~3 list components |
| 21 | Frontend: members page teacher isolation | `manage/members/page.tsx` |
| 22 | Seed data: adjust for group visibility + default groups | seed file |
| 23 | i18n: new keys | `en.json`, `pl.json` |
| 24 | Lint + build | — |

---

## What's NOT in P2

| Item | Reason |
|------|--------|
| Teacher group creation | Deferred to P3: needs `group.manage` permission for teachers |
| Default group naming/customization | Placeholder name, revisit P3 |
| Group reordering / hierarchy | Flat is sufficient |
| Direct flashcard/question assignment to groups | Inheritance via container is good enough |
| Full CRUD for assignment tables (add/remove groups from content without full update) | Update endpoint covers it for now |
| Group-member-scoped delete for teachers | Teachers only delete own content (`own` scope) |
| Student-facing group UI | Per design principle: groups invisible to students |
| Custom group roles beyond teacher/member | Simple roles suffice |
| Content scoping for quizzes / quiz attempts | User-generated, not content-owned |

---

## Open Questions

1. **Quiz service** — quizzes are user-generated (attempts, answers). Should they also be group-scoped? Currently they don't use `buildQueryFilter`. Likely no change needed since they're personal artifacts.

2. **`flashcard.service.ts` `listByDeck`** — currently fetches all flashcards in a deck. With group scoping, if a teacher lists flashcards of a deck they have access to, the flashcards inherit the deck's visibility. No extra check needed since the deck is already scoped. Is this correct?
