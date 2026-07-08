# Org Features & Limits — Architecture PRD

## Motivation

Currently, plan features are rigidly mapped via `plan_features` table — a Campus org grants all `campus`-tier features to every member. Org admins cannot tailor what each role can access, and limits are per-plan with no org-level pooling or admin override.

Managers pay for an org plan to empower their users (students get Pro, educators get Master, etc.), but they also need the flexibility to decide *which* features each role can use and *how much* capacity each limit allows.

## Design

### Two new tables

**`org_role_features`** — per-role feature toggles within an org

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `org_role_id` | `uuid FK → org_roles(id) ON DELETE CASCADE` | |
| `feature_key` | `text` | Matches `feature_flags.key` |
| `is_enabled` | `boolean` | Default `true` |
| *Unique* | `(org_role_id, feature_key)` | |

**`org_limits`** — per-org capacity caps (enforced via live COUNT queries)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `organization_id` | `uuid FK → organizations(id) ON DELETE CASCADE` | |
| `limit_key` | `text` | e.g. `flashcard_count`, `ai_tokens`, `storage_mb` |
| `max_value` | `integer` | `-1` = unlimited |
| *Unique* | `(organization_id, limit_key)` | |

### What stays unchanged

| Table/Code | Role |
|------------|------|
| `feature_flags` | Source of truth for available feature keys |
| `plan_features` | **Template** — seeds `org_role_features` on org creation |
| `plan_limits` | **Template** — seeds `org_limits` on org creation |
| `profiles.personal_plan_key` | Used for personal (non-org) context |
| `user_feature_overrides` | Reserved for future per-user overrides |
| `FeatureKey` union type | Same values — no new keys needed |

### What changes

| Area | Before | After |
|------|--------|-------|
| Feature resolution | Union of personal + org plan features | Inside org: look up `org_role_features` by role. Outside org: personal plan only. |
| Limit resolution | Per-plan limits (personal or org max) | `max(org_limits.value, personal_plan_limits.value)` with live COUNT |
| Org creation | App layer: `seedDefaultOrgRoles()` creates roles + permissions | DB trigger: creates roles + permissions + features + limits atomically |
| `seedDefaultOrgRoles` | Exists in `classroom.service.ts` | **Removed** entirely |

### `handle_new_organization` trigger

An `AFTER INSERT ON organizations` trigger function handles everything in the right order:

```sql
create function handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id   uuid;
  teacher_id uuid;
  member_id  uuid;
  r record;
begin
  -- 1. Create default roles
  insert into public.org_roles (organization_id, name, description, is_system)
  values (new.id, 'admin', 'Org manager — settings, members, roles', true)
  returning id into admin_id;

  insert into public.org_roles (organization_id, name, description, is_system)
  values (new.id, 'teacher', 'Educator — CRUD over own content', true)
  returning id into teacher_id;

  insert into public.org_roles (organization_id, name, description, is_system)
  values (new.id, 'member', 'Base learner — read own + group content, create own', true)
  returning id into member_id;

  -- 2. Seed permissions per role (replaces app-layer seedDefaultOrgRoles logic)
  -- admin: organization scope for all
  insert into public.org_role_permissions (org_role_id, permission_name, scope)
  select admin_id, name, 'organization' from public.permissions;

  -- teacher: own scope for all
  insert into public.org_role_permissions (org_role_id, permission_name, scope)
  select teacher_id, name, 'own' from public.permissions;

  -- member: group scope for read, own for everything else
  insert into public.org_role_permissions (org_role_id, permission_name, scope)
  select member_id, name, case when name like '%.read' then 'group' else 'own' end
  from public.permissions;

  -- 3. Seed features per role from plan template
  for r in
    select feature_key from public.plan_features where plan_key = new.plan
  loop
    -- admin: everything
    insert into public.org_role_features (org_role_id, feature_key, is_enabled)
    values (admin_id, r.feature_key, true);

    -- teacher: everything except member_manage and role_builder
    if r.feature_key not in ('member_manage', 'role_builder') then
      insert into public.org_role_features (org_role_id, feature_key, is_enabled)
      values (teacher_id, r.feature_key, true);
    end if;

    -- member: only flashcards, quiz, ai, documents
    if r.feature_key in ('flashcards', 'quiz', 'ai', 'documents') then
      insert into public.org_role_features (org_role_id, feature_key, is_enabled)
      values (member_id, r.feature_key, true);
    end if;
  end loop;

  -- 4. Seed org limits from plan template
  insert into public.org_limits (organization_id, limit_key, max_value)
  select new.id, limit_key, max_value
  from public.plan_limits
  where plan_key = new.plan;

  return new;
end;
$$;

create trigger handle_new_organization
  after insert on public.organizations
  for each row execute function handle_new_organization();
```

### App layer removals

`seedDefaultOrgRoles()` is deleted from `src/server/services/classroom.service.ts`.

Both call sites change from:
```typescript
const adminRoleId = await seedDefaultOrgRoles(supabase, org.id);
```
to:
```typescript
const { data: adminRole } = await supabase
  .from('org_roles')
  .select('id')
  .eq('organization_id', org.id)
  .eq('name', 'admin')
  .single();

// adminRole.id is the admin role UUID
await supabase.from('org_members').insert({
  organization_id: org.id,
  user_id: ctx.userId,
  org_role_id: adminRole.id,
});
```

Affected files:
- `src/app/(backend)/api/v1/admin/organizations/route.ts`
- `src/server/services/classroom.service.ts`

### Feature resolution (`getEnabledFeatures`)

```
ctx.activeOrgId set?
  ├─ Yes, ctx.orgRoleId set?
  │   ├─ Yes → SELECT feature_key FROM org_role_features
  │   │         WHERE org_role_id = ctx.orgRoleId AND is_enabled = true
  │   │         If empty → fallback to personal plan (plan_features)
  │   └─ No  → personal plan
  └─ No  → personal plan
```

`requireFeature` is unchanged — it calls `getEnabledFeatures` and throws `FORBIDDEN` if the key is absent.

### Limit resolution (`getEffectiveLimit`) — live COUNT

```
ctx.activeOrgId set?
  ├─ Yes → SELECT max_value FROM org_limits
  │         WHERE organization_id = ctx.activeOrgId AND limit_key = $key
  │         If no row → fallback to personal plan limits
  │         Result → max(org_limit, personal_plan_limit)
  └─ No  → personal plan limits only
```

`checkLimit(ctx, key)`:
```
effectiveLimit = getEffectiveLimit(ctx, key)
if effectiveLimit = -1 → unlimited, return true
resourceCount = run resource-specific COUNT(*) query
  (e.g., SELECT COUNT(*) FROM flashcards WHERE organization_id = ctx.activeOrgId)
return resourceCount < effectiveLimit
```

Limit query registry in the resolver:
```typescript
const LIMIT_QUERIES: Record<string, { table: string; orgColumn: string }> = {
  flashcard_count: { table: 'flashcards', orgColumn: 'organization_id' },
  question_count:  { table: 'questions', orgColumn: 'organization_id' },
  quiz_count:      { table: 'quizzes', orgColumn: 'organization_id' },
  deck_count:      { table: 'flashcard_decks', orgColumn: 'organization_id' },
  student_count:   { table: 'org_members', orgColumn: 'organization_id' },
  group_count:     { table: 'groups', orgColumn: 'organization_id' },
} as const;
```

Since there are no usage counters to track, counts are always live — no state to get out of sync.

### Seeds

- `00_plans.sql` — stays as-is (`plan_features` and `plan_limits` remain template data)
- `01_seed.sql` — `INSERT INTO organizations` for the dev org **now fires the trigger** automatically. Remove any manual role/permission/feature/limit seeding that overlaps with the trigger. The creator still needs to be added as an org member manually (the app layer does this after org insert).

### Admin API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `PUT` | `/api/v1/admin/organizations/[id]/roles/[roleId]/features` | Upsert `org_role_features` for a role |
| `PUT` | `/api/v1/admin/organizations/[id]/limits` | Upsert `org_limits` for an org |

### Role editor UI extension

In the existing role editor page (currently shows RBAC permissions), add two sections:

**Features section** — checkbox list of all `feature_flags` entries:
```
Features
  ☑  Flashcards
  ☑  Quiz
  ☑  AI Chat
  ☐  Member Management
  ☐  Role Builder
  ☑  Group Management
  ☑  Documents
  ☑  Quiz Builder
  ☐  Advanced Stats
```

**Limits section** — number inputs, keyed by `limit_key`:
```
Org-wide Limits
  Max flashcards:  [5000       ]
  Max AI tokens:   [100000     ]
  Max storage (MB):[500        ]
```

## Implementation order

1. **Migration** — `CREATE TABLE org_role_features` + `org_limits` with RLS policies
2. **Migration** — `handle_new_organization` function + trigger
3. **Remove `seedDefaultOrgRoles()`** — delete from `classroom.service.ts`, fix both call sites
4. **Rewrite `plan.resolver.ts`** — new feature resolution + limit resolution + limit query registry + `checkLimit`
5. **Admin API endpoints** — PUT for features and limits
6. **Role editor UI** — feature toggles + limit inputs
7. **Update seeds** — `01_seed.sql` remove manual role/perm seeding (handled by trigger now)
8. **Tests** — update unit mocks, remove `seedDefaultOrgRoles` test references, add integration test for trigger

## Future considerations (Phase 2)

- Per-user feature/limit overrides (via `user_feature_overrides` table already exists)
- Org-level usage pooling (e.g., "org has 50K AI tokens shared across all members")
- Partial indexes on `organization_id` columns for fast COUNT queries on large orgs
- Caching layer for frequent `getEffectiveLimit` lookups
