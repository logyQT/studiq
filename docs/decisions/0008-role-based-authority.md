# ADR-0008: Role-based authority with separated entitlements

**Status:** Proposed (pre-market; no compatibility constraints)
**Date:** 2026-10-31
**Supersedes:** the `for_account_type = 'manager'` inference in
[ADR-0007](0007-manager-plan-model.md) (the "managers have no paid personal plan"
decision itself is kept)
**Related:** [`docs/audits/features-perms-weak-spots.md`](../audits/features-perms-weak-spots.md)
(FP-01 … FP-22), #971, #233, #228, #182, #191, #799

---

## 1. Decision summary

1. **Persona is not authorization.** `student | educator | manager` stays as an
   onboarding/billing/UX attribute (`account_kind`). No org API may 403 solely on
   it. Authorization is always a permission check.
2. **Roles own authority.** An org role is a named bundle of permissions with
   scopes (`own | group | organization`). System roles are templates; org admins
   may create custom roles from a closed permission catalog.
3. **Group/class authority is a scope, not an org role.** A class is a group. A
   group teacher holds `group.*` permissions scoped to `group`, resolved through
   `group_members.role`. Teachers never need `org.member.manage` to run a class.
4. **Entitlements are owned by plans and seats, never by roles as a source of
   truth.** A role may _allocate a subset_ of the org's purchased entitlements
   (`role_entitlements ⊆ org_plan_entitlements`), but a role can never create an
   entitlement the org did not buy.
5. **Entitlement keys and permission keys are disjoint namespaces.**
   `ai.chat`, `branding`, `advanced.stats` are entitlements. `org.member.manage`
   (old `member.manage`), `org.role.manage` (old `role.builder`), `group.manage`,
   `org.admin` are permissions. No key appears in both. No plan/seat/personal
   plan/override may grant a permission.
6. **One resolution contract** returns effective entitlements **and** limits
   together, so the "#971 shape" (feature hidden by a layer that did not buy it)
   and the "feature on, limit 0" shape cannot recur.
7. **One enforcement contract:** every paid surface calls `requireEntitlement`,
   every management surface calls `requirePermission`; UI reads the same two
   endpoints; RLS never implements a wider rule than the API.
8. **Pre-market means a clean break.** Delete `org.manage`,
   `ADMIN_ONLY_FEATURES`, plan-seeded role feature snapshots, the
   `for_account_type` org-plan inference, persona gates on org APIs, and feature
   keys stored in `permissions`.

---

## 2. Context

Issue #971 exposed the most visible symptom: a student on a paid personal plan
inside a free org lost `ai.chat` because the org's plan "produced features" and
the personal plan was only consulted when the org produced none. The audit found
that this is one instance of a structural conflation:

- `FEATURES` contains both entitlements and management permissions.
- Management permissions are sold in `plan_features` and snapshotted into
  `org_role_features` with hardcoded role allowlists.
- A custom role with zero rows inherits the whole org plan, including
  `member.manage` and `role.builder` (FP-01).
- `org.manage` is an unenforced, never-revoked "is admin" marker (FP-05).
- Seats can grant management keys and unowned plans (FP-02).
- `FeatureResolver` and `LimitsResolver` still disagree after #971 (FP-07).
- RLS re-implements the resolver with different semantics (FP-11).
- The original product intent — _teachers manage a class_ — was implemented as
  org management because there was no group-scoped permission. That is the
  reason the split exists at all.

The purpose of this ADR is to fix the model, not just the #971 symptom.

### 2.1 What went wrong, precisely

| Intended concept               | What it became                                                                            | Result                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| "This person is an educator"   | `account_type = educator`, used in route gates and plan families                          | persona conflated with authority            |
| "This teacher runs this class" | an org role (`teacher`) + an org-wide `group.manage` plan feature                         | class management required org management    |
| "Only this class gets AI"      | `org_role_features` snapshot from the org plan                                            | role became the entitlement source of truth |
| "This org bought Hub"          | `organizations.plan` + `plan_features` + `org_role_features`                              | three sources, different freshness          |
| "This member is an admin"      | `org.manage` feature marker, `member.manage`, `role.name='admin'`, `account_type=manager` | four definitions                            |
| "This person bought Pro"       | `profiles.personal_plan_key` + `plan_features`                                            | shadowed by any org layer (#971)            |

---

## 3. Layer model

Five independent layers. Each answers exactly one question.

| Layer             | Answers                                                               | Must never decide                                        |
| ----------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| **Persona**       | onboarding, default dashboard, which personal plan family you can buy | authorization, org authority                             |
| **Personal plan** | portable personal entitlements + per-member quotas                    | org authority, org capacity                              |
| **Org plan**      | the org's entitlement **ceiling**, org capacity, seat license         | which member gets which entitlement                      |
| **Org role**      | permissions (with scopes); optional entitlement **allocation subset** | purchasing, quota values, anything above the org ceiling |
| **Group role**    | group-scoped permissions (class management)                           | org authority                                            |
| **Seat**          | per-member entitlement/quota grant within the org's license           | permissions, org capacity                                |
| **Flag**          | rollout / temporary kill switch                                       | granting anything                                        |

### 3.1 Authority vs entitlement

```
PERMISSIONS  = f(org role, group role)                 // authority
ENTITLEMENTS = f(org plan, role allocation, seat, personal plan, override, flag)  // product access
LIMITS       = f(org plan, seat, personal plan)        // quotas
```

`PERMISSIONS ∩ ENTITLEMENTS = ∅` is a database-level invariant, not a convention.

### 3.2 Personas: keep, but demote

We keep the three persona values because onboarding, pricing families and default
dashboards need them. We stop using them as an authorization mechanism.

| Persona    | Still decides                                                                                                                   | No longer decides                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `student`  | default dashboard, personal plan catalogue (`base/spark/ace/pro`)                                                               | which org resources they may touch        |
| `educator` | default dashboard, personal plan catalogue (`lite/guide/creator/master`), default group role `teacher` when they create a class | org authority                             |
| `manager`  | default dashboard, personal plan catalogue (`solo`), default role assignment when creating an org (`Admin`)                     | org authority, member management, billing |

Rules:

- No org-resource route may 403 solely on `account_kind`. It checks a permission.
- The creator of an org gets the **Admin** role (not "because manager"); the
  creator of a group gets `teacher` (not "because educator"). Both are explicit
  role assignments that an admin can change later.
- The same user may be Admin in org A, Teacher in org B, Member in org C, and
  have a personal `pro` plan. That is the multi-org case the model must support.
- Persona is still allowed to gate: public signup, "which personal plans can I
  buy", and org creation itself (until/unless `org.create` becomes a permission).
- Rename the concept to `account_kind` in code/docs. The database enum values can
  stay (`student|educator|manager`) for a later mechanical migration; the point
  is that nothing authorizes on them.
- `manager` is not "the admin persona". If product later lets any persona create
  an org, `manager` can disappear without touching authorization.

**Personas are global; roles are per-org. A role never overrides a persona.**

- One persona per user, set at signup. Switching the active org does **not**
  change it. There is no per-org persona.
- An org role grants authority **inside that org only**. It cannot turn a user
  into a different persona, and a persona cannot grant org authority.
- A persona is **not a ceiling** either: a `student` persona can hold the Admin
  role in an org if the org assigns it. If product wants to forbid that, it is a
  role-assignment policy (e.g. "Admin requires `manager`"), not an authorization
  rule baked into every check.
- What changes per org is the **role**, the **seat**, and the **entitlement
  allocation**. The dashboard/shell should follow the active org's permissions
  (or a role-derived default), not the persona.
- Default role assignment may be **seeded** from persona — org creator gets
  Admin, class creator gets Teacher — but that is an editable default, not an
  override.
- A user who teaches in one org and studies in another holds `Teacher` in the
  first and `Member` in the second; their persona stays whatever they signed up
  as. That is precisely what roles are for.
- A persona change is a **global account change** (audited, support/self-service),
  never an org-scoped operation.

Example — user U signs up as `educator`:

| Context | Persona    | Role / seat                    | Effective shell / authority             |
| ------- | ---------- | ------------------------------ | --------------------------------------- |
| Org A   | `educator` | Admin                          | `/manage` shell; full org authority     |
| Org B   | `educator` | Teacher (group-scoped)         | `/edu` shell; class management only     |
| Org C   | `educator` | Member                         | `/app` shell; learner permissions       |
| No org  | `educator` | personal plan (e.g. `creator`) | personal entitlements + personal quotas |

U is an educator everywhere; U is an admin only in Org A. The role never makes U
a "manager persona", and U's persona never makes U an admin in Org B.

---

## 4. Authority model

### 4.1 Permission catalog

A closed catalog. Each permission declares its allowed scopes and whether it is
assignable to custom roles. `permission_key` is the primary key.

**Content (scopes `own | group | organization`):**

```
flashcard.read | create | update | delete
deck.read      | create | update | delete
topic.read     | create | update | delete
question.read  | create | update | delete
question_bank.read | create | update | delete
quiz.read | create | update | delete
assignment.read | create | update | delete | publish | grade
stats.read
```

**Groups / classes (scopes `own | group | organization`):**

```
group.read
group.manage
group.member.manage
group.invite            // group | organization only
```

**Org administration (scope `organization` only):**

```
org.settings.manage     // name, slug, general settings
org.member.manage       // change roles, remove members (old `member.manage`)
org.invitation.manage   // org-level invitations
org.role.manage         // create/edit/delete roles, edit role permissions (old `role.builder`)
org.seat.manage         // seat pools and assignments
org.billing.manage      // org checkout / plan changes
org.report.manage       // org-wide question-report inbox
org.audit.read          // audit log
org.admin               // ownership: delete org, transfer ownership
```

Branding is **not** a permission: writing the logo/brand colour requires
`org.settings.manage` **and** the `branding` entitlement. Displaying branding is
an org-scoped entitlement available to all roles that inherit it.

`org.admin` is the only "ownership" capability. It is not a substitute for the
granular keys: an org admin normally holds all of them because the **Admin**
system role is seeded with all of them. Day-to-day checks use the specific key,
never a single `isAdmin` flag.

### 4.2 Roles

`org_roles` stays. A role has:

- `name` (immutable for system roles), `display_name`, `is_system`
- `inherit_org_entitlements boolean not null default false`
- permissions in `org_role_permissions (org_role_id, permission_key, scope)`

**System role templates** (seeded; admins can add permissions but cannot rename
or delete them):

| Template      | Permissions                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**     | every content permission at `organization`; every group permission at `organization`; every `org.*` including `org.admin`                          |
| **Teacher**   | content CRUD at `own`/`group`; `group.read/manage/member.manage/invite` at `group`; assignment permissions at `own`/`group`; `stats.read` at group |
| **Member**    | content CRUD at `own`, read at `group`; `group.read` at `group`; `stats.read` at own                                                               |
| **Assistant** | `org.member.manage`, `org.invitation.manage`, `org.report.manage`; content at `organization` (for front-desk/admin staff)                          |
| **Billing**   | `org.billing.manage`, `org.seat.manage`                                                                                                            |
| **Read-only** | every `*.read` at `organization` (auditors)                                                                                                        |

Custom roles start **empty** (no permissions, `inherit_org_entitlements = false`).
An empty role can do nothing and gets no paid surface. This is the inverse of
today's "zero rows means inherit everything".

### 4.3 Group / class roles

`group_members.role` becomes an authorization input:

- `teacher`: the member may exercise `group.manage`, `group.member.manage`,
  `group.invite`, and group-scoped content permissions **for that group**.
- `member`: read access as granted by the role's `group` scope.

Scope resolution:

- `own` → `created_by = caller` (groups: `groups.created_by = caller`)
- `group` **read** → any member of the group; `group` **manage/invite** → the
  caller is a `teacher`/owner of the group. `ctx.groupIds` already exists in
  `withAuth`.
- `organization` → the caller's role has the permission at org scope.

A group teacher **does not** get `org.member.manage`. Inviting a student to a
class is `group.invite` on that group, not an org invitation. The invitation row
carries `group_id` and `target_group_role`; RLS checks `group.invite` for that
group. This removes the `can_assign_org_role` teacher-role-name exception and
the hidden classroom UI dependency.

### 4.4 Role assignment

- `org_members.org_role_id` stays; one role per member per org.
- Assigning a role requires `org.member.manage`.
- Defining/editing a role requires `org.role.manage`.
- You may only grant permissions/scopes you hold yourself (except an
  `org.admin` holder, who may grant anything).
- A member cannot change their own role; an editor cannot edit their own role.
- System roles cannot be renamed or deleted; their permission set may be
  extended only within the editor's own authority.

---

## 5. Entitlement model

### 5.1 Entitlement catalog

```
ai.chat            personal-portable, quota max_ai_tokens_per_day
quiz.builder       personal-portable
advanced.stats     personal-portable
documents          personal-portable (hidden until shipped)
branding           org-scoped display
flashcards         baseline (always available, quota max_flashcards)
quiz               baseline (always available, quota max_quiz_attempts_per_day)
```

Metadata per key:

```ts
type Entitlement = {
  key: string;
  category: 'baseline' | 'surface';
  scope: 'personal' | 'org';
  seatEligible: boolean;
  quota: LimitKey | null;
  /** personal plans may add this key inside an org */
  personalPortable: boolean;
};
```

`baseline` keys are always enabled for any authenticated account; they stay in
`plan_entitlements` only so pricing pages can render the plan contents. The
resolver never gates on them. `documents` stays out of `FEATURES`/pricing until
it has a surface.

### 5.2 Plan scope (replaces the `for_account_type` inference)

Add to `subscription_plans`:

- `scope text not null check (scope in ('personal','organization'))`
- `audience text check (audience in ('student','educator','manager'))` — null
  for organization plans

| Plan      | scope        | audience |
| --------- | ------------ | -------- |
| `base`    | personal     | student  |
| `lite`    | personal     | educator |
| `spark`   | personal     | student  |
| `guide`   | personal     | educator |
| `ace`     | personal     | student  |
| `creator` | personal     | educator |
| `pro`     | personal     | student  |
| `master`  | personal     | educator |
| `solo`    | personal     | manager  |
| `launch`  | organization | null     |
| `team`    | organization | null     |
| `hub`     | organization | null     |
| `campus`  | organization | null     |

`solo` is a new free manager personal plan (baseline entitlements only).

`launch` is no longer both the free manager personal plan and the default org
plan. A manager without an org gets `solo` (baseline entitlements only). This
removes the ADR-0007 dual-purpose problem without adding a paid manager family.

### 5.3 What the org plan grants

`plan_entitlements (plan_key, entitlement_key)` is the **ceiling** for the org.
It contains only entitlement keys (never permissions).

`org_roles.inherit_org_entitlements`:

- `true` → the role gets the full org ceiling (minus any explicit removals, if
  removal rows are added later).
- `false` → the role gets exactly `org_role_entitlements` rows.

`org_role_entitlements (org_role_id, entitlement_key)`:

- FK to the entitlement catalog.
- **Subset invariant:** every key must exist in
  `plan_entitlements(organizations.plan)`. Enforced by trigger on write and by
  intersection at resolution time (so a downgrade fails closed even before the
  prune job runs).
- **No permission keys** (check constraint / trigger).
- On plan change, prune rows outside the new ceiling and re-seed the system-role
  templates in one transaction.

Default templates:

- Admin: `inherit_org_entitlements = true`.
- Teacher: `true` (an educator in a Hub org gets Hub's AI/branding/etc.).
- Member: `false` + explicit learner set (`flashcards`, `quiz`, `ai.chat`,
  `documents`, `branding` where the plan has them).
- Custom: `false`, empty.

The admin UI can toggle inheritance and allocate entitlements per role. This is
the safe version of "roles have entitlements": the org plan is the ceiling, the
role only distributes below it.

### 5.4 Seats

A seat is a per-member personal-plan grant within the org's license.

- `org_seat_pools.plan_key` FK → `subscription_plans(key)` with
  `scope = 'personal'` and `seatEligible = true`.
- The org must hold a seat license for that plan. Add
  `org_seat_licenses (organization_id, plan_key, seats)`; plan changes seed it
  from the org plan's included seats. `POST /seats/pools` validates against it.
- `assignSeat` validates the target's `account_kind` against the plan
  `audience` (not against a hardcoded role-name tier map).
- Seat entitlements are intersected with the org ceiling: a seat cannot grant an
  entitlement the org did not buy.
- Seats never grant permissions and never raise `scope: 'org'` limits.
- A seat may **raise** a user-scope limit, never lower it (`max(org, seat,
personal)`; `-1` short-circuits). A seat is an upgrade, not a cap.

### 5.5 Personal plans

- Outside an org: personal entitlements + personal limits.
- Inside an org: personal plans are additive for `personalPortable` keys only
  (the #971 intent). They never add org-scoped entitlements or org capacity.
- Managers inside an org: personal plan does not apply (ADR-0007 kept); outside
  an org they use `solo`.
- Legacy paid manager rows in `personal_plan_key` are backfilled to `solo`
  (pre-market: no compatibility constraint).

### 5.6 Overrides and flags

- `user_entitlement_overrides` (renamed from `user_feature_overrides`) accepts
  **entitlement keys only**. Comp/trial grants work; structural keys are
  rejected by the model.
- Overrides are applied after role/seat/personal, before flags. They can add or
  remove an entitlement, but they cannot change a limit; a comp that needs a
  quota gets a `user_limit_override` (new, optional) or a trial plan.
- Overrides bypass rollout (a comp account should not land in a 25% bucket).
- `feature_flags` (rename to `entitlement_flags`) accepts entitlement keys only.
  `is_enabled = false` is a temporary kill switch; `rollout_percentage < 100`
  reduces exposure. A missing flag row fails **closed** (unlike today).
- A flag can never grant; it can only remove/limit. Deleting a flag is not a
  kill switch — the admin UI should set `is_enabled = false` and keep the row.

---

## 6. Resolution contract

One module, one precedence. Both features and limits are produced by it.

### 6.1 Entitlements

```
resolveEntitlements(ctx):
  org = verifiedMembership(ctx.activeOrgId, ctx.userId)   // same rule for both resolvers

  if (!org):
    set = personalEntitlements(ctx) ∩ personalPlanApplies
    limits.user = personalLimits
  else:
    ceiling  = planEntitlements(organizations.plan)
    roleSet  = role.inherit ? ceiling : roleEntitlements(role) ∩ ceiling
    seatSet  = seat ? planEntitlements(seat.plan) ∩ ceiling : ∅
    personal = personalPlanApplies(ctx) ? personalEntitlements ∩ PERSONAL_PORTABLE : ∅
    set      = roleSet ∪ seatSet ∪ personal

    limits.user = combine(orgPlan, seatPlan, personalPlan) // max, -1 short-circuit
    limits.org  = orgPlan                                   // never personal/seat

  set = applyOverrides(set)          // entitlement keys only
  set = applyFlags(set)              // kill switch + rollout; overrides bypass rollout

  effective = { k ∈ set | quota(k) == null OR limits[k.quota] != 0 }

  return { entitlements: effective, limits, sources, plan: effectivePlan }
```

Rules:

- `personalPlanApplies(ctx)`: outside an org always; inside an org for
  non-manager personas only (ADR-0007).
- Missing `plan_limits` row = `0` (blocked) in every path.
- `effective` excludes an entitlement whose quota is `0`; the API and UI must
  agree on that (the "feature on, limit 0" state is never presented as usable).
- `plan.effectivePlan` is a union descriptor `{ primary, sources[] }`, not a
  single key. `/me/plan` must render "Hub (org) + Pro (personal)" when that is
  what enforcement uses.

### 6.2 Limits

| Context                | `scope: 'user'`                           | `scope: 'org'` |
| ---------------------- | ----------------------------------------- | -------------- |
| No org                 | personal plan                             | `0`            |
| Org, unseated          | `max(org, personal)` (`-1` short-circuit) | org plan       |
| Org, seated            | `max(org, seat, personal)`                | org plan       |
| Org, manager           | org plan (personal excluded)              | org plan       |
| Non-member / forged id | personal plan (user), `0` (org)           | `0`            |
| Missing row            | `0` + warning                             | `0` + warning  |

The seat is **not** exclusive. This is the deliberate reversal of #233 Q1 for
user-scope keys; #233 Q1 still holds for `scope: 'org'`.

### 6.3 Permissions

```
resolvePermissions(ctx):
  if (!org) return defaultsForPersona(ctx)   // personal content only
  perms = org_role_permissions(role)         // key -> scope
  group = group_members(ctx.userId)          // group -> role (teacher/member)
  return { perms, group }
```

A permission check is `(key, resource?)`:

- no row → deny
- scope `own` → `resource.created_by = caller`
- scope `group` → caller is a `teacher` of the group (or `created_by` for
  groups) and the resource belongs to the group
- scope `organization` → caller's role has the key and the resource belongs to
  the active org

No plan/seat/personal/override/flag is consulted here.

---

## 7. Enforcement contract

| Surface                                                      | Check                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Paid product API (AI, builder, stats, documents)             | `requireEntitlement(ctx, key)`                                                                |
| Branding write                                               | `requirePermission('org.settings.manage')` **and** `requireEntitlement('branding')`           |
| Org management (members, roles, seats, billing, invitations) | `requirePermission('org.*')`                                                                  |
| Group/class management                                       | `requirePermission('group.*', { groupId })`                                                   |
| Content CRUD                                                 | `requirePermission('<type>.<action>', resource)`; queries use `buildQueryFilter`              |
| UI                                                           | `GET /api/v1/me/entitlements` + `GET /api/v1/me/permissions`; no component reads a plan table |
| RLS (control plane)                                          | `rls_caller_has_permission(org, key)`; no feature logic                                       |
| RLS (content)                                                | tenant floor only in this ADR; see §12 (residual risk)                                        |

Hard rules:

- No `allowedAccountTypes` on an org-resource route. Persona checks are allowed
  only for: public pages, onboarding, "which personal plans can I buy", and
  "can I create an org" (which may become `org.create` later).
- Every paid surface's API check is the same key the UI reads. A UI-only gate is
  a bug, not a feature.
- `requireFeature`/`/features/me` are replaced by `requireEntitlement`/
  `/me/entitlements`; the rename is intentional so call sites are reviewed.

### 7.1 Links, routes, and the active org

A link is navigation, not authorization. **Link visibility is a function of the
active org's permissions; the API remains the boundary.**

- A role in org B never authorizes a request scoped to org A. `withAuth` resolves
  the role for `active_org_id` only; there is no union of roles across orgs.
- The nav is rendered from `activeOrg` + `/me/permissions` for that org. For a
  user who is Admin in B and Member in A:
  - active org **A** → `/manage` is hidden; a bookmarked `/manage` URL loads
    but the API returns 403 and the page shows an org-scoped "no access in this
    org / switch org" state.
  - active org **B** → `/manage` is visible and the API allows.
- The shell/dashboard follows the active org's role/permissions, not the
  persona. Switching orgs recomputes the shell; do not keep a persona-based
  `/app` / `/edu` / `/manage` split.
- Route rules (proxy) should require auth only, or a coarse "member of some
  org" check. The page and API check the specific permission in the active org.
  The proxy cannot know the role cheaply, and a persona check there is exactly
  the bug this ADR removes.
- Permission/entitlement queries are keyed by the active org
  (`['permissions', orgId]`, `['entitlements', orgId]`) so a switch cannot serve
  org A's nav from cache. Invalidate on switch and on role/plan/seat changes.
- Resource/share links authorize against the **resource's org** and the caller's
  membership/role there. A role in another org must not widen access; a public
  share link stays governed by its own token/visibility rules.
- Not-found vs forbidden: use 403 for "member but lacks permission in this org"
  and 404 for "not a member / not in this org" so tenant existence is not leaked.

Concrete case: a `student` persona who is Admin in org B sees the admin links
**while org B is active**; the same links are dead (and the API denies) while
org A is active. Persona is irrelevant — the active org's role is the switch.

---

## 8. Data model

### 8.1 New / changed tables

```sql
-- authority -----------------------------------------------------------------
permissions (
  key text primary key,
  category text not null,                -- content | group | org
  allowed_scopes text[] not null,
  assignable boolean not null default true,
  description text
)

org_roles (
  ...,
  inherit_org_entitlements boolean not null default false
)

org_role_permissions (
  org_role_id uuid not null references org_roles(id) on delete cascade,
  permission_key text not null references permissions(key),
  scope text not null check (scope in ('own','group','organization')),
  primary key (org_role_id, permission_key)
)

-- entitlement allocation (subset of the org plan) ---------------------------
org_role_entitlements (
  org_role_id uuid not null references org_roles(id) on delete cascade,
  entitlement_key text not null references entitlement_catalog(key),
  primary key (org_role_id, entitlement_key)
)

-- entitlement catalog -------------------------------------------------------
entitlement_catalog (
  key text primary key,
  category text not null check (category in ('baseline','surface')),
  scope text not null check (scope in ('personal','org')),
  seat_eligible boolean not null default false,
  personal_portable boolean not null default false,
  quota_limit_key text references limit_catalog(key)
)

-- plans ---------------------------------------------------------------------
subscription_plans ( ..., scope text not null, audience text null )
plan_entitlements ( plan_key, entitlement_key )      -- renamed from plan_features
plan_limits ( plan_key, limit_key, limit_value )     -- unchanged

-- seats ---------------------------------------------------------------------
org_seat_pools ( ..., plan_key text not null references subscription_plans(key) )
plan_seat_grants  ( org_plan text, seat_plan text, seats int not null )  -- what an org plan includes
org_seat_licenses ( organization_id, plan_key, seats int not null )      -- what this org may assign

-- overrides / flags ---------------------------------------------------------
user_entitlement_overrides ( user_id, entitlement_key, is_enabled, expires_at, ... )
user_limit_overrides       ( user_id, limit_key, limit_value, expires_at, ... )  -- optional
entitlement_flags          ( key, is_enabled, rollout_percentage )               -- renamed

-- groups --------------------------------------------------------------------
group_members ( ..., role text not null check (role in ('teacher','member')) )
invitations ( ..., group_id uuid null references groups(id), target_group_role text null )
```

### 8.2 Invariants (enforced by constraints/triggers + tests)

1. `plan_entitlements.entitlement_key` never appears in `permissions.key`.
2. `org_role_permissions.permission_key` never appears in
   `entitlement_catalog.key`.
3. `org_role_entitlements ⊆ plan_entitlements(organizations.plan)` for the
   role's org (checked on write and at resolution).
4. `org_seat_pools.plan_key` references a `scope='personal'` plan and the org
   holds `org_seat_licenses` for it.
5. An empty custom role has zero permissions and zero entitlements.
6. No plan/seat/personal/override row can grant a permission key.
7. Every active plan defines every `limit_catalog` key.
8. `entitlement_flags` contains every `surface` entitlement key (baseline keys
   may be absent).
9. A plan downgrade prunes `org_role_entitlements` outside the new ceiling in
   the same transaction.
10. `org_members.org_role_id` references a role in the same org (existing
    trigger is kept).

### 8.3 What is deleted

- `org.manage` and the `ADMIN_ONLY_FEATURES`/`ORG_SCOPED_FEATURES` denylists.
- Plan-seeded `org_role_features` snapshots (replaced by
  `org_role_entitlements` + `inherit_org_entitlements`).
- `allowed_roles` (already dead), `feature_permissions` (already dropped).
- `permissions` rows whose name is an entitlement key (`ai.chat`,
  `org.manage`, `study.*`, `test.*`).
- `resource_permissions` (dead); map `assignment.*` to `teacher_assignments`
  if that surface stays, otherwise delete it.
- `can_assign_org_role` teacher-role-name exception.
- `has_org_feature` in RLS (or regenerate it from permissions only).

---

## 9. Custom roles: UX and guardrails

The role editor is a first-class admin screen, not an API-only feature.

**Editor layout**

1. Template picker (Teacher / Assistant / Billing / Read-only / Blank).
2. Permission list grouped by category; each row has a scope selector
   (`own | group | organization`) limited to the permission's `allowed_scopes`.
3. "Entitlements this role receives" — checkboxes limited to the org's current
   ceiling, or "inherit the org's entitlements".
4. Effective preview: "A member with this role will be able to …" and "will
   receive …".
5. Save → audit row + cache invalidation for affected members.

**Guardrails**

- Closed catalog (no free-text permission names).
- No self-edit; no system-role rename/delete.
- You cannot grant a permission or scope you do not hold (unless `org.admin`).
- You cannot allocate an entitlement the org does not own.
- Deleting a role with members is blocked (existing behaviour).
- Every change is audited (`actor`, `target role`, `before`, `after`).
- Role/permission changes invalidate `/me/permissions` for affected members.

---

## 10. Class / group model

- A class is a group; there is no separate entity.
- `group_members.role = 'teacher'` is the class-teacher grant.
- Class management permissions: `group.manage`, `group.member.manage`,
  `group.invite` at `group` scope.
- Content sharing uses the existing `deck_groups`/`bank_groups`/`topic_groups`
  links; "visible in my class" is a group-scope read.
- Inviting a student to a class is a group invitation (`invitation.group_id`),
  not an org invitation. The org admin can still invite to the org with
  `org.invitation.manage`.
- The `/edu/groups` and `/manage/groups` screens both use the same permission
  checks; the account-type dashboard only decides which shell the user lands in.

This is the direct fix for the original intent: a teacher runs their class
without any org-wide management capability.

---

## 11. Consequences

### Positive

- A custom role can no longer escalate: empty means empty, and permissions are
  role-only.
- `#971` becomes a property of the model (personal plans additive for
  personal-portable keys) rather than a special case in one resolver.
- A free seat can no longer shadow a paid plan or the org plan (max rule).
- A feature enabled with quota `0` is consistently unavailable in API and UI.
- Teachers get class management without `member.manage`; managers keep full
  flexibility through custom roles.
- One catalog for server/admin/UI/tests; no duplicate `FEATURES` or denylists.
- Plan display can show the real union ("Hub + Pro") instead of one narrow key.
- Persona checks disappear from org APIs, so managers can use AI and teachers
  can use the member-management surface if their role allows it.

### Negative / costs

- A real refactor: catalog split, schema changes, route permission checks,
  resolver rewrite, UI role editor, seeds, tests. Pre-market is the right time,
  but it is not a one-afternoon change.
- More granular permissions mean more UI states; templates are essential.
- `max` for user-scope limits is a deliberate reversal of #233 Q1 for those
  keys; the org can no longer cap a member below a personal purchase. This is a
  product decision (see §14).
- Custom roles add support burden; start with templates and hide the advanced
  editor behind an "Advanced roles" affordance.
- The RLS content-scope gap (FP-03) is not solved by this ADR; it needs a
  separate security decision (see §12).

### Neutral

- `org_role_features` is replaced, not kept as a compatibility layer. Pre-market
  means no back-compat stubs.
- `launch` stops being dual-purpose; a `solo` plan is added. Seeds and pricing
  copy need a small update.

---

## 12. Residual security decision (FP-03)

This ADR fixes authority/entitlement conflation, but the database boundary is
still tenant-wide for content (`created_by = me OR organization_id in my orgs`).
Any org member can read/write all org content through PostgREST with their JWT.

Options:

1. **Keep RLS as a tenant floor and accept the risk** (current behaviour).
   Fastest; `own`/`group` remain service-layer only.
2. **Scope content RLS** (resource → group membership / creator). Requires
   request-scoped session state (active org, group ids) or a redesign of the
   data access path.
3. **Move server data access to a service-role client with explicit
   authorization filters, then revoke `authenticated` grants on content
   tables.** The service layer becomes the only path; PostgREST is closed for
   content. This is the cleanest security boundary but the largest change.

**Recommendation:** ship this ADR (authority model) first; take option 3 as a
separate security ADR before public launch. Do not pretend RLS enforces
features/permissions in the meantime.

---

## 13. Migration plan (ordered batches)

Each batch is shippable on its own; the order keeps the app working between
batches. Pre-market allows a big-bang at the end if preferred.

### Batch 0 — cleanup and guardrails (no behaviour change)

- Delete dead tables/keys: `resource_permissions`, `assignment.*` if unused,
  `feature_permissions` remnants; remove entitlement keys from `permissions`.
- Add tests: `permissions ∩ entitlements = ∅`; every active plan defines every
  limit key; every surface entitlement has a flag row.
- Freeze the current `FEATURES` list; no new keys until Batch 1.
- Maps to FP-13, FP-19, FP-20.

### Batch 1 — catalog split and plan scope

- Introduce `entitlement_catalog`, `permissions` (expanded), `limit_catalog`.
- Rename `plan_features` → `plan_entitlements`; add `subscription_plans.scope`
  and `audience`; add `solo`; make `launch` organization-only.
- Generate the admin/UI catalogs from one module; delete the duplicate
  `FEATURES` and SQL/QA denylists.
- Maps to FP-06, FP-09, FP-19.

### Batch 2 — authority model

- Expand `org_role_permissions` to the new permission catalog; seed the
  templates; custom roles start empty.
- Add group-scoped permission resolution (`group_members.role`, `ctx.groupIds`).
- Replace `allowedAccountTypes` on org APIs with `requirePermission`.
- Add `org.admin`/`org.role.manage`/`org.member.manage`/`org.seat.manage`/
  `org.billing.manage`/`org.invitation.manage`/`org.settings.manage`.
- Delete `org.manage` and the denylists; derive admin from the Admin role.
- Add the self-edit/no-escalation/closed-catalog guards to role editing.
- Maps to FP-01 (permissions half), FP-04, FP-05, FP-09, FP-21.

### Batch 3 — entitlement allocation

- Add `org_roles.inherit_org_entitlements` and `org_role_entitlements` with the
  subset trigger.
- Replace `org_role_features` and the plan-seeded snapshots; seed admin/teacher
  inherit and member explicit learner template.
- Rewrite `apply_org_plan` → `change_org_plan` (update plan, prune allocations,
  re-seed templates, no `org.manage` exception).
- Maps to FP-01 (entitlements half), FP-06, FP-15, FP-16.

### Batch 4 — resolution contract

- Implement `resolveEntitlements` + `resolvePermissions` as the only resolvers.
- `max(org, seat, personal)` for user-scope limits; org-only for org scope;
  missing = 0; `-1` short-circuit.
- `effective = entitlement ∧ quota > 0`; expose `sources`/`effectivePlan`.
- Add `requireEntitlement` everywhere a paid surface exists (AI, quiz builder,
  advanced stats, documents).
- Rename `/features/me` → `/me/entitlements`; add `/me/permissions`.
- Maps to FP-07, FP-08, FP-10, FP-18 (with Batch 8 for atomic accounting).

### Batch 5 — seats and personal plans

- `org_seat_pools.plan_key` FK + `org_seat_licenses`; validate `addPool`;
  tier check by `account_kind`/audience, not role name.
- Seats intersect the org ceiling; never permissions; never org capacity.
- Personal plans additive for `personalPortable`; managers use `solo`; backfill
  legacy `personal_plan_key` rows.
- Maps to FP-02, FP-14, FP-22 (manager AI becomes possible via entitlement).

### Batch 6 — RLS and enforcement parity

- `rls_caller_has_permission(org, key)` for control-plane policies; delete
  `has_org_feature` or regenerate it from permissions only.
- Decide FP-03 (tenant floor vs scoped RLS vs service-role content access).
- Add a "RLS never wider than API" integration test.
- Maps to FP-03, FP-11.

### Batch 7 — UI, cache, and display

- Role editor with templates/scopes/effective preview.
- Entitlement allocation UI; "inherit org entitlements" toggle.
- `/me/plan` shows the effective union; `/me/entitlements` invalidates after
  checkout, seat, role, plan and flag changes; refetch on focus (≤60 s).
- Remove the dead `X-Feature-Rollout` header or consume it.
- Maps to FP-17, FP-22.

### Batch 8 — limits hardening and docs/tests

- Atomic token accounting (`reserve_ai_tokens`) and DB-level/trigger checks for
  counts; no read-modify-write.
- Rewrite `docs/limits.md` to the new contract; update the ADRs and the audit.
- Add the test matrix from §14.3; rewrite the tests that encode the old
  semantics (audit §7.1).
- Maps to FP-18, FP-20 and all regression tests.

---

## 14. Acceptance criteria and tests

### 14.1 Invariants (must be tested)

- A plan/seat/personal plan/override cannot grant a permission key.
- A custom role with zero permissions/entitlements can do nothing and sees no
  paid surface.
- A role cannot allocate an entitlement the org does not own.
- A role editor cannot edit its own role or grant beyond its own authority.
- `group.manage`/`group.invite` at `group` scope work for a class teacher and
  do not grant org member management.
- A free seat cannot lower a user-scope limit below the org or personal plan.
- An entitlement with quota `0` is unavailable through API and UI.
- A plan downgrade atomically removes the entitlements it no longer includes.
- A custom role inherits nothing unless `inherit_org_entitlements = true`.
- `/me/entitlements` and enforcement agree after checkout/seat/role/flag changes.
- No `permissions` row is an entitlement key and vice versa.
- Every active plan defines every limit key.
- The visible nav/route set is a function of the **active org's** role; switching
  orgs changes it atomically, and a role in one org never authorizes another.
- A bookmarked admin URL in an org where the user is a Member returns 403 (not
  404 and not 200), and the UI shows an org-scoped "no access" state.

### 14.2 Quadrants

| Personal \ Org | free org (`launch`)                                                   | paid org (`hub`/`campus`)                                  |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| free personal  | role allocation only; no AI; 0 AI tokens                              | role allocation; AI if the role allocates it               |
| paid personal  | personal-portable keys added (`ai.chat`, builder, stats) + max limits | union; personal adds portable keys, org capacity unchanged |

Plus: seated/unseated, custom role, manager, override, kill switch, rollout,
downgrade, forged cookie.

### 14.3 Test layers

- Unit: catalog invariants, resolver truth tables, permission scope evaluation,
  role allocation subset, override/flag ordering.
- Integration: schema constraints/triggers, plan change, seat licensing, group
  permissions, RLS parity, cache invalidation via API headers/version.
- E2E: teacher class management without org member management; manager creates
  a custom role and assigns it; student with personal Pro in a free org keeps
  AI; member with a free seat in a paid org does not lose the org budget.

**The product regression gate is the QA suite** (`qa/cases` + `__tests__/qa`,
215 tenant-isolated cases) plus the E2E suite. Unit and integration tests are
implementation tests: they are expected to change in large numbers, and they are
not the compatibility contract. The QA case text, spec and `qa/coverage.md` are
the product specification; a case that encodes a current bug is edited with
QA/product sign-off, never skipped.

---

## 15. Open questions (with recommended defaults)

| #   | Question                                                            | Recommended default                                                                                                                                                                          |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is `org.admin` a permission or just the system role?                | A real permission for ownership only; granular keys for day-to-day.                                                                                                                          |
| 2   | Do managers get a paid personal plan?                               | No (ADR-0007); add free `solo` instead of dual-purpose `launch`.                                                                                                                             |
| 3   | Is a personal plan portable inside an org?                          | Yes for `personalPortable` keys + user-scope quotas; never org-scoped keys/capacity.                                                                                                         |
| 4   | Can a seat lower a limit?                                           | No: `max(org, seat, personal)`; a seat is an upgrade.                                                                                                                                        |
| 5   | Can a role allocate entitlements?                                   | Yes, as a subset of the org ceiling; never permissions.                                                                                                                                      |
| 6   | Do teacher/member system roles inherit the org entitlement ceiling? | Teacher: inherit; Member: explicit learner template; Custom: empty.                                                                                                                          |
| 7   | Can a teacher invite students without `org.invitation.manage`?      | Yes, via `group.invite` on their class; not org-wide.                                                                                                                                        |
| 8   | Can a flag remove a paid entitlement?                               | Temporarily, with an audit entry; no row deletion as a kill switch.                                                                                                                          |
| 9   | Are `flashcards`/`quiz` entitlements?                               | Baseline keys (always on) for display; not gates.                                                                                                                                            |
| 10  | Do we rename `account_type` to `account_kind`?                      | Conceptually yes now; the enum rename can be a mechanical migration.                                                                                                                         |
| 11  | What is the FP-03 content-RLS posture?                              | Ship this ADR first; take service-role content access + revoke grants as a separate security ADR.                                                                                            |
| 12  | Do overrides bypass rollout?                                        | Yes (comp/trial accounts should not be bucketed).                                                                                                                                            |
| 13  | Can a `student` persona hold the Admin role?                        | Yes — the org explicitly assigns it. If product forbids it, enforce it at role-assignment time as a policy, not in every authorization check.                                                |
| 14  | Does persona gate personal plan purchases?                          | `audience` is a recommendation/UI filter. Once permissions are out of `plan_entitlements`, any persona can safely buy any personal plan; hard-gate only if pricing segmentation requires it. |

---

## 16. Non-goals

- Per-org permission overrides beyond roles.
- `allowed_roles` on plans or role-scoped plan restrictions.
- Feature logic in RLS.
- Using `account_type` for authorization on org resources.
- A separate "class" entity or a second group system.
- A paid personal plan family for managers.
- Backward-compatibility shims for the old feature keys (pre-market).

---

## 17. References

- [`docs/audits/features-perms-weak-spots.md`](../audits/features-perms-weak-spots.md) — evidence, register, reproduction cases.
- [`docs/limits.md`](../limits.md) — current plan/feature/limit reference.
- [`docs/decisions/0007-manager-plan-model.md`](0007-manager-plan-model.md) — manager personal plan decision (kept; its `for_account_type` inference is superseded).
- `packages/authz/src/features.ts`, `packages/server/src/services/feature.resolver.ts`, `limits.resolver.ts`, `seat.service.ts`, `org-role.service.ts`.
- `supabase/migrations/20261024124756_rls_all_public_tables.sql`, `20261024151122_drop_org_limits.sql`.
- Issue #971 (personal plan inside an org), #233 (limit precedence), #799 (stale entitlement cache).
