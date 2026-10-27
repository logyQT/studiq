# Org Features & Limits — Architecture PRD

> **Status: ARCHIVED — LIMITS HALF ABANDONED (2026-10-25, #232).**
> `org_role_features` shipped (Phase 1). The per-org `org_limits` override was
> abandoned and the table was dropped in #229: org capacity resolves live from
> `organizations.plan → plan_limits`. The per-org limits endpoint and the
> org-wide limits editor UI below were **never built and will not be**. See
> [`docs/limits.md`](../../limits.md) for the final model. Kept as history —
> do not implement from this doc.

## Motivation

Currently, plan features are rigidly mapped via `plan_features` table — a Campus org grants all `campus`-tier features to every member. Org admins cannot tailor what each role can access, and limits are per-plan with no org-level pooling or admin override.

Managers pay for an org plan to empower their users (students get Pro, educators get Master, etc.), but they also need the flexibility to decide _which_ features each role can use and _how much_ capacity each limit allows.

## Design

### Two new tables

**`org_role_features`** — per-role feature toggles within an org

| Column        | Type                                        | Notes                       |
| ------------- | ------------------------------------------- | --------------------------- |
| `id`          | `uuid PK`                                   |                             |
| `org_role_id` | `uuid FK → org_roles(id) ON DELETE CASCADE` |                             |
| `feature_key` | `text`                                      | Matches `feature_flags.key` |
| `is_enabled`  | `boolean`                                   | Default `true`              |
| _Unique_      | `(org_role_id, feature_key)`                |                             |

**`org_limits` — ABANDONED (#229).** There is no per-org limit table; capacity
resolves live from `organizations.plan → plan_limits`. See
[`docs/limits.md`](../../limits.md).

### What stays unchanged

| Table/Code                   | Role                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `feature_flags`              | Source of truth for available feature keys                                    |
| `plan_features`              | **Template** — seeds `org_role_features` on org creation                      |
| `plan_limits`                | **Template** — limits resolve live per plan; nothing is copied per org (#229) |
| `profiles.personal_plan_key` | Used for personal (non-org) context                                           |
| `user_feature_overrides`     | Reserved for future per-user overrides                                        |
| `FeatureKey` union type      | Same values — no new keys needed                                              |

### What changes

| Area                  | Before                                                         | After                                                                                  |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Feature resolution    | Union of personal + org plan features                          | Inside org: look up `org_role_features` by role. Outside org: personal plan only.      |
| Limit resolution      | Per-plan limits (personal or org max)                          | `Math.max(personal plan, org plan)` from `plan_limits`, live (#229)                    |
| Org creation          | App layer: `seedDefaultOrgRoles()` creates roles + permissions | DB trigger: creates roles + permissions + **features** atomically (limits are derived) |
| `seedDefaultOrgRoles` | Exists in `classroom.service.ts`                               | **Removed** entirely                                                                   |

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

  -- 4. ABANDONED (#229): limits are NOT copied; resolved live from
  --    organizations.plan -> plan_limits.

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

### Limit resolution (`getEffectiveLimit`) — live read

The override half was abandoned (#229); the shipped rule lives in
`LimitsResolver` — see [`docs/limits.md`](../../limits.md) for the canonical
description. In short:

```
seated in the active org?
  ├─ Yes → the seat plan's plan_limits row only (missing → 0)
  └─ No  → max(personal plan, org plan) read live from plan_limits
           (org plan only for a verified org_members row)
```

`-1` = unlimited, `0` = no limit row for that plan (any use is blocked).
`LimitsResolver.checkLimit(ctx, key, currentCount, increment)` throws
`USAGE_LIMIT_EXCEEDED` (HTTP 429) when `currentCount + increment` exceeds the
resolved limit. Counts are always live queries — there is no usage counter and
no per-org snapshot.

### Seeds

- `00_plans.sql` — stays as-is (`plan_features` and `plan_limits` remain template data)
- `01_seed.sql` — `INSERT INTO organizations` for the dev org **now fires the trigger** automatically. Remove any manual role/permission/feature/limit seeding that overlaps with the trigger. The creator still needs to be added as an org member manually (the app layer does this after org insert).

### Admin API endpoints

| Method | Path                                                       | Status                                                                                                |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PUT`  | `/api/v1/admin/organizations/[id]/roles/[roleId]/features` | **Planned** — not built; role permissions use `PUT /api/v1/organization/roles/[id]/permissions` today |

The per-org limits endpoint was **abandoned (#229)** and will
not be built. Limit writes go through the admin app's plan-limit routes
(`PUT /api/v1/plan-limits/[id]`), which apply to every org on that plan.

### Role editor UI extension

In the existing role editor page (currently shows RBAC permissions), add a
features section (the per-org limits editor section was abandoned with
`org_limits` — #229):

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

## Implementation order

1. **Migration** — `CREATE TABLE org_role_features` with RLS policies
2. **Migration** — `handle_new_organization` function + trigger
3. **Remove `seedDefaultOrgRoles()`** — delete from `classroom.service.ts`, fix both call sites
4. **Rewrite the resolver** — new feature resolution + limit resolution + `checkLimit` (now `feature.resolver.ts` + `limits.resolver.ts`)
5. **Admin API endpoints** — features only (the limits endpoint was abandoned, #229)
6. **Role editor UI** — feature toggles only
7. **Update seeds** — `01_seed.sql` remove manual role/perm seeding (handled by trigger now)
8. **Tests** — update unit mocks, remove `seedDefaultOrgRoles` test references, add integration test for trigger

## Future considerations (Phase 2)

- Per-user feature overrides (`user_feature_overrides` shipped); per-user **limit** overrides were never built
- Org-level usage pooling (e.g., "org has 50K AI tokens shared across all members")
- Partial indexes on `organization_id` columns for fast COUNT queries on large orgs
- Caching layer for frequent `getEffectiveLimit` lookups
