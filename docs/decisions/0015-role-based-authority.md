# ADR-0015: Role-based authority with separated entitlements

**Status:** Proposed (pre-market; no compatibility constraints). Revised
2026-11-13 after re-verifying every finding against `main`: all 22 findings are
still live or partly live, and the open questions in §15 are now settled.
**Date:** 2026-10-31 (revised 2026-11-13)
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
   entitlement the org did not buy. **v1 ships inheritance only**
   (`entitlement_profile`); the allocation table is deferred to a follow-up PR (§5.3).
5. **Entitlement keys and permission keys are disjoint namespaces.**
   `ai.chat`, `branding`, `stats.insights` are entitlements. `org.member.manage`
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

Seven independent layers. Each answers exactly one question.

| Layer             | Answers                                                                 | Must never decide                                        |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| **Persona**       | onboarding, default dashboard, which personal plan family you can buy   | authorization, org authority                             |
| **Personal plan** | portable personal entitlements + per-member quotas                      | org authority, org capacity                              |
| **Org plan**      | the org's entitlement **ceiling**, org capacity, seat license           | which member gets which entitlement                      |
| **Org role**      | permissions (with scopes); entitlement profile `all \| learner \| none` | purchasing, quota values, anything above the org ceiling |
| **Group role**    | group-scoped permissions (class management)                             | org authority                                            |
| **Seat**          | per-member entitlement/quota grant within the org's license             | permissions, org capacity                                |
| **Flag**          | temporary kill switch                                                   | granting anything                                        |

### 3.1 Authority vs entitlement

```
PERMISSIONS  = f(org role, group role)                 // authority
ENTITLEMENTS = f(org plan, role profile, seat, personal plan, override, flag)  // product access
LIMITS       = f(org plan, seat, personal plan)        // quotas
```

`PERMISSIONS ∩ ENTITLEMENTS = ∅` is a database-level invariant, not a convention.

### 3.2 Personas: keep, but demote

We keep the three persona values because onboarding, pricing families and default
dashboards need them. We stop using them as an authorization mechanism.

| Persona    | Still decides                                                                                                           | No longer decides                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `student`  | default dashboard, personal plan catalogue (`free/plus/pro/max`)                                                        | which org resources they may touch        |
| `educator` | default dashboard, personal plan catalogue (`free/plus/pro/max`), default group role `teacher` when they create a class | org authority                             |
| `manager`  | default dashboard, organization plan catalogue, default role assignment when creating an org (`Admin`)                  | org authority, member management, billing |

Rules:

- No org-resource route may 403 solely on `account_kind`. It checks a permission.
- The creator of an org gets the **Admin** role (not "because manager"); the
  creator of a group gets `teacher` (not "because educator"). Both are explicit
  role assignments that an admin can change later.
- The same user may be Admin in org A, Teacher in org B, Member in org C, and
  have a personal `pro` plan. That is the multi-org case the model must support.
- Persona is still allowed to gate: public signup, "which personal plans can I
  buy", and org creation itself (until/unless `org.create` becomes a permission).
- Stop authorizing on the persona everywhere. The name stays `account_type` in
  code and docs for now (D10); the mechanical rename to `account_kind` is a
  separate change. The point is that nothing authorizes on it.
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

> **2026-11-19 (D16).** `org.admin` is `assignable = false`: ownership is not
> grantable through a custom role. The system Admin template keeps it. Every
> other catalog key is assignable.
>
> **2026-11-21 (phase 2b-7).** The four legacy management entitlements
> (`role.builder`, `org.manage`, `member.manage`, `group.manage`) are deleted
> from `ENTITLEMENTS`, `entitlement_catalog`, `entitlement_flags`,
> `plan_entitlements` and `org_role_features`. `group.manage` stays in this
> catalog **as a permission** — the entitlement namespace and `permissions` are
> now disjoint, so `permissions ∩ entitlements = ∅` holds without an exception
> (the 1b pin of `['group.manage']` is retired).

### 4.2 Roles

`org_roles` stays. A role has:

- `name` (immutable for system roles), `display_name`, `is_system`
- `entitlement_profile text not null default 'none'` (check `all`, `learner`, `none`)
- permissions in `org_role_permissions (org_role_id, permission_key, scope)`

**Seeded system roles** (the org-creation trigger creates them; admins can add
permissions but cannot rename or delete them):

| Role        | Permissions                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**   | every content permission at `organization`; every group permission at `organization`; every `org.*` including `org.admin`                                                                                  |
| **Teacher** | content **reads at `group`, writes at `own`** (`group` ⊇ `own` in the API layer; `assignment.read` moves with the reads — D29); `group.read/manage/member.manage/invite` at `group`; `stats.read` at group |
| **Member**  | content CRUD at `own`, read at `group`; `group.read` at `group`; `stats.read` at own                                                                                                                       |

**Editor presets** (D17; `POST /organization/roles` materialises one as an
ordinary custom role — no preset is seeded by the trigger and none is a system
role, so it can be renamed, edited and deleted like any other custom role):

| Preset        | Permissions                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Assistant** | `org.member.manage`, `org.invitation.manage`, `org.report.manage`; content at `organization` (front-desk/admin staff) |
| **Billing**   | `org.billing.manage`, `org.seat.manage` at `organization`                                                             |
| **Read-only** | every `content`/`group` `*.read` key plus `org.audit.read`, at `organization` (auditors)                              |
| **Blank**     | none — a custom role built from scratch                                                                               |

The `org.*` keys in a preset took effect when 2b replaced the legacy feature
gates (done in 2b-3…2b-6); the content keys have been live since 2a.

Custom roles start **empty** (no permissions, `entitlement_profile = 'none'`).
An empty role can do nothing and gets no paid surface. This is the inverse of
today's "zero rows means inherit everything".

> **2026-11-19 (phase 2a-2, D17).** This table previously called all six rows
> "system role templates", which contradicted §9's picker list and the data: only
> Admin/Teacher/Member are seeded. Assistant/Billing/Read-only are code-owned
> presets (`ROLE_TEMPLATES` in `@studiq/authz`), validated against the closed
> catalog and materialised as custom roles. No preset carries `org.admin` (D16).

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

> **2026-11-25 (phase 6e).** For **content** reads, `group` scope means the
> classes the caller **teaches** (`group_members.role = 'teacher'`), per the
> plan's 2b-2 operator decision (`docs/plans/role-authority-plan.md`, 2b-2:
> "Teacher reaches only the classes they teach") — not "any member of the
> group". A plain `member` of a class is its audience, so membership alone must
> not widen a content read. The `group` **read** line above keeps its meaning for
> the class itself; this note fixes what `group` scope reaches when the row is
> content. The seeded Member role carries no `assignment.*` key, so the
> membership guard in `TeacherAssignmentService.list` protects a **custom** role
> granted `assignment.read` at `group`, not a shipped default.

> **2026-11-27 (#961, operator decision).** A content `group` **write** is not a
> grant: sharing a row to a class gives read. The catalog withdraws `group` from
> the eleven content write keys (`deck`/`flashcard`/`topic`/`question`/
> `question_bank` update and delete, plus `flashcard.create`), `resolveStoredScope`
> resolves a surviving such row to `null`, the role editor and the save schema
> refuse the grant, and `20261127150000_no_group_content_writes.sql` deletes the
> rows that exist. An edit share would need its own permission — it is future work
> with no issue. Twelve content writes keep `group` by design: the four `*.create`
> keys (`deck`, `topic`, `question`, `question_bank`) target no existing row; the
> five `assignment.*` keys (`create`, `update`, `delete`, `publish`, `grade`)
> address the group a run is aimed at; and the three `quiz.*` keys (`create`,
> `update`, `delete`) govern a class assessment's own lifecycle, not an edit of
> shared content. A content `group` **read** is any member of the class the row is
> shared to, which is what `can()` resolves through the share link; this settles
> the phase 6e wording ("the classes the caller teaches") for content reads. An
> `organization` grant is the Admin role's deliberate org-wide authority, not
> sharing.

A group teacher **does not** get `org.member.manage`. Inviting a student to a
class is `group.invite` on that group, not an org invitation. The invitation row
carries `group_id` and `target_group_role`; RLS checks `group.invite` for that
group. This removes the `can_assign_org_role` teacher-role-name exception and
the hidden classroom UI dependency.

> **2026-11-20 (phase 2b-5).** The row now exists: `invitations.group_id uuid
null references groups(id)` + `target_group_role text null` (pair CHECK — an
> org invite has neither, a class invite both; role CHECK = the
> `group_members.role` values), and the four `invitations` policies split by
> row shape — org invite → `org.invitation.manage`, class invite →
> `rls_caller_has_group_permission(group_id, 'group.invite')`. The
> teacher-role-name exception is deleted: `can_assign_org_role` resolves its
> manager half from `org.invitation.manage`, and a teacher invites through a
> class invite only. D7 in v1: a class invite targets an **existing org
> member**, and accept adds the group membership with `target_group_role`
> without granting or changing the member's org role.

### 4.4 Role assignment

- `org_members.org_role_id` stays; one role per member per org.
- Assigning a role requires `org.member.manage`.
- Defining/editing a role requires `org.role.manage`.
- You may only grant permissions/scopes you hold yourself (except an
  `org.admin` holder, who may grant anything).
- A member cannot change their own role; an editor cannot edit their own role.
- System roles cannot be renamed or deleted; their permission set may be
  extended only within the editor's own authority.

> **2026-11-20 (phase 2b-4).** "Assigning a role requires `org.member.manage`" is
> enforced by the member routes; the database helper every invite path still
> calls, `can_assign_org_role`, resolves its manager half from the legacy
> `member.manage` marker. It cannot move alone: PostgREST refuses an UPDATE whose
> row the SELECT policy hides, so the invitation write and read move together in
> 2b-5.
>
> **2026-11-20 (phase 2b-5).** Done: `can_assign_org_role` now resolves its
> manager half from `org.invitation.manage`, the `invitations` SELECT moved
> with the writes (R25), and the teacher-name exception is deleted — a teacher
> grants no org role through an invite at all; class invites are `group.invite`
> on the group and never touch the invitee's org role on accept.
>
> **2026-11-20 (phase 2b-5 review).** Still open, and pre-existing on `main`:
> `can_assign_org_role` checks only `org.invitation.manage`, not the "grant
> only what you hold" rule above, so any holder of the capability can mint an
> org invite targeting the Admin role. Phase 5 (the §4.4 enforcement pass)
> owns the conjunct; 2b-5 deliberately did not add it.
>
> **2026-11-21 (phase 2b-8).** The §4.4 write rules ("grant only what you
> hold", no `org.admin` grant/withdrawal, no self-edit without
> `org.admin`@organization, system roles not deletable) now hold at the
> table as well as the API — `org_role_permissions` writes go through
> `rls_caller_may_set_role_permission`; see the §9 note (R4/FP-01 closed).
>
> **2026-11-22 (phase 5b).** The invite path's §4.4 gap is closed: the invite
> helper `can_assign_org_role` now requires `org.invitation.manage` **and**
> (`org.admin`@organization **or** every target-role row with a non-null scope
> is an assignable key the caller covers at that scope) — the conjunct the
> 2b-5 review note left open. The covers logic lives in exactly one place,
> `public.covers_permission(p_actor, p_org, p_key, p_scope)`;
> `rls_caller_covers_permission` is a one-line delegate to it
> (`20261122180000`). Consequence: a capability holder who is not `org.admin`
> can no longer mint an org invite targeting the system Admin role; an
> `org.admin` holder can invite into any role.
>
> **2026-11-22 (phase 5b review) — still open, row 13.** Assigning a role to an
> existing member is a second §4.4 surface and does **not** go through that
> helper: `PUT /api/v1/organization/members`
> (`organization-member.service.ts#changeRole`) and the `org_members` UPDATE
> policy gate on `org.member.manage` alone, so an `org.member.manage` holder
> without `org.admin` can still assign the system Admin role. Pre-existing and
> outside row 9's scope; recorded as the 2b-9 register's **row 13**, owner
> phase 5, to be closed with the same `covers_permission` shape.
>
> **2026-11-23 (phase 5c) — row 13 closed.** The assignment half of
> `can_assign_org_role` now lives in ONE actor-parameterized helper,
> `public.actor_may_assign_org_role(p_actor, p_role_id)`
> (`covers_permission(p_actor, org, 'org.admin', 'organization')` OR every
> non-null-scope target-role row is an `assignable` key the actor covers at
> that scope). `can_assign_org_role` is `org.invitation.manage` **and** that
> delegate, so the invite path and the member path share the predicate, and the
> authenticated wrapper `rls_caller_may_assign_org_role(p_role_id)` is what
> both the service (`changeRole`, on the user client) and the `org_members`
> UPDATE policy's WITH CHECK call (`20261123100000`). Consequence: an
> `org.member.manage` holder without `org.admin` can no longer assign the
> system Admin role through either plane (API 403, PostgREST 42501); an
> `org.admin` holder still assigns any role.

---

## 5. Entitlement model

### 5.1 Entitlement catalog

```
ai.chat            personal-portable, quota max_ai_tokens_per_day
quiz.templates     personal-portable
stats.insights     personal-portable
documents          absent in v1 (re-enters with its surface, D22)
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
resolver never gates on them. `documents` stays out of the catalog/pricing until
it has a surface.

> **The catalog is open.** A new entitlement key ships when its surface does:
> catalog metadata, a flag row, and the plan entitlements that should carry it.
> `documents` is the known future key — it is on the roadmap but has no surface
> in the app today, so its correct state in v1 is **absent**, not gated and not
> permanently deleted. Re-adding it is data (catalog + flag + plan/seed rows),
> not a resolver change.
>
> **Checklists:** [extendability.md](../plans/extendability.md) — adding and
> retiring a key, every step naming its file/table and whether it is code, data
> or both, plus the steps that are still code and their owners.

> **2026-11-25 (phase 8, D23).** The release gate passed on a live app: the
> fictional `voice.notes` shipped as **one migration, one `ENTITLEMENTS` entry
> and one `requireEntitlement` call**, with a **zero-line resolver diff**. A
> pre-existing org and a fresh org resolved it identically once on a plan that
> carries it, a plan change backfilled it with no prune job, and removing it
> narrowed the ceiling with no 404/500 anywhere. Evidence and the two checklists
> are in [extendability.md](../plans/extendability.md). CI deliberately does not
> regenerate or diff `database.ts` (D36, §15).
>
> **2026-11-23 (phase 5d, register row 12).** `quiz.builder` → `quiz.templates`
> and `advanced.stats` → `stats.insights`, renamed in place in
> `ENTITLEMENTS` (declaration order unchanged) with identical metadata, plus
> their catalog/flag rows and the renamed `plan_entitlements` rows
> (`20261123150000_quiz_templates_stats_insights.sql`; historical migrations
> keep the old names). Neither key had a call site, so the rename is data-only;
> the enforcement those keys now carry is recorded in the §7 note below.

### 5.2 Plan scope (replaces the `for_account_type` inference)

Add to `subscription_plans`:

- `scope text not null check (scope in ('personal','organization'))`

There is no `audience` column: a plan carries no persona dimension. The table
below is the matrix the plan-catalogue migrations own; `audience` was added
for phase 4a, stopped keying anything in B1, and was dropped in the cleanup.

| Plan     | scope        |
| -------- | ------------ |
| `free`   | personal     |
| `plus`   | personal     |
| `pro`    | personal     |
| `max`    | personal     |
| `launch` | organization |
| `team`   | organization |
| `hub`    | organization |
| `campus` | organization |

A manager holds no personal plan at all (ADR-0007): `personal_plan_key` is
nullable, and a manager buys an organization plan for an organization where
they hold `org.billing.manage`. This removes the ADR-0007 dual-purpose problem
without adding a manager plan family.

> **2026-11-22 (phase 4a, D32).** Shipped as specified:
> `subscription_plans.scope`/`audience` replace `for_account_type` (dropped in
> the same migration, `20261122150000`), with the pair CHECK (organization ⇒
> audience NULL, personal ⇒ audience NOT NULL) and a fail-closed backfill that
> raises on any unknown legacy value. `solo` (key `solo`, price 0, PLN, active,
> sort 13, `flashcards`+`quiz`, the eight free-tier limit rows mirroring
> `base` but spelled out in the migration so a seed-less `db push` gets them)
> is inserted idempotently; `launch` became organization-only through the backfill.
> `handle_new_user()` writes `solo` for managers and now also writes
> `profiles.account_type`; every manager profile holding an organization-scope
> plan was backfilled to `solo`. `GET /api/v1/subscription-plans` filters are
> `scope`/`audience` query params now (no params ⇒ every active plan).

### 5.3 What the org plan grants

`plan_entitlements (plan_key, entitlement_key)` is the **ceiling** for the org.
It contains only entitlement keys (never permissions).

> **v1 scope (settled 2026-11-13).** Ship a three-valued
> `org_roles.entitlement_profile` — `all | learner | none` — instead of the
> boolean plus the allocation table:
>
> - `all` → the full org ceiling (Admin, Teacher).
> - `learner` → the fixed `LEARNER_ENTITLEMENTS` set from `@studiq/authz`
>   (`flashcards`, `quiz`, `ai.chat`, `branding` in v1), intersected with the org
>   ceiling. `documents` joins the set only when its surface ships (§5.1); it is
>   absent in v1 for exactly that reason. This is the "Member explicit" decision
>   without a table.
> - `none` → nothing (custom roles; fail-closed).
>
> Resolution always intersects with `plan_entitlements(organizations.plan)`, so
> a plan change needs no prune job: the ceiling moves and every profile narrows
> with it. The `org_role_entitlements` table, its subset trigger, the
> prune-on-downgrade step and the allocation UI are **deferred** to a follow-up
> PR. This removes roughly a week from the critical path and keeps the
> fail-closed property.

**Default profiles (v1):**

- Admin and Teacher: `all` — the full org ceiling.
- Member: `learner` — `LEARNER_ENTITLEMENTS ∩ ceiling` (`flashcards`, `quiz`,
  `ai.chat`, `branding` where the plan owns them). `documents` joins the set only
  when its surface ships (§5.1); it is absent in v1 for exactly that reason.
- Custom: `none`, empty. An empty role can do nothing and gets no paid surface.

> **2026-11-19 (phase 2a-1, D18).** The profile governs **non-marker** keys only.
> `all` is the ceiling **minus** the four legacy management markers
> (`org.manage`, `member.manage`, `role.builder`, `group.manage`); those four
> stay row-sourced in `org_role_features` until their route and RLS gates read
> permissions (2b), so a Teacher (`all`) never inherits `member.manage` or
> `role.builder` (FP-04). A member with no verified role (`ctx.orgRoleId: null`)
> resolves nothing for the org layer — fail closed, with no plan read. The
> `has_org_feature` zero-row fallback resolves the same profile and unions the
> seat plan, so PostgREST is never wider than the resolver (FP-01).
>
> **2026-11-21 (phase 2b-7).** The four markers are gone from the catalog, so
> the qualifier above is history: `all` is simply the plan ceiling, the
> resolver's `org_role_features` read keeps only its `is_enabled = false`
> revoke semantics (D19), and `has_org_feature`'s `all` branch is the ceiling
> with the system Admin role as the only special case. No plan carries a
> management key any more, which is also what makes every seat plan
> all-`seatEligible` possible (§5.4, D15).

**v1.1 — per-role allocation (deferred).** The target shape, kept here so the
follow-up has a contract: an `org_role_entitlements (org_role_id,
entitlement_key)` table with a write-time subset check against
`plan_entitlements(organizations.plan)`, a prune-on-downgrade step, and a role
editor that allocates below the ceiling. It is **not** part of v1;
`entitlement_profile` covers the Member set without a table. When it lands,
`entitlement_profile` collapses to `all | none` plus explicit rows.

### 5.4 Seats

A seat is a per-member personal-plan grant within the org's license.

> **Amended 2026-11-19 (D15).** Org plans grant **zero** licences; licences are
> sold separately. A licence is the purchased unit: `org_seat_pools` **is** the
> licence record, and one pool of size N is N licences. `org_seat_assignments`
> is one member occupying one licence. `plan_seat_grants` and
> `org_seat_licenses` are **not** in the schema — no plan includes seats, so no
> plan change seeds a count and `POST /seats/pools` validates the pool against
> plan metadata, not against a derived allowance.

- `org_seat_pools.plan_key` FK → `subscription_plans(key)` with
  `scope = 'personal'`, and the plan's keys must be `seatEligible`.
  (`seatEligible` is entitlement metadata, §5.1 — it is not a plan column.)
- The pool is the licence: creating a pool of N seats is buying N licences.
  There is no per-org licence table and no plan-seeded count to validate
  against (D15).
- `assignSeat` checks no persona: a plan carries no `audience` (B1 retired the
  D33 check), so a pool is offered to any member of the organization. The
  licence rules are the plan's `scope` and its `seatEligible` keys.
- A seat licence grants its own keys. The pool subscription **is** the
  purchase, so the org ceiling does not filter the seat (D38). A seat therefore
  never carries an org-scope key: `seatEligible ⇒ scope: 'personal'` is a
  catalog invariant, pinned by `catalog-invariants`.
- A seat is per member, never per role (#1146). `assignSeat` requires an
  `org_members` row in the active org, and the member's role is irrelevant: a
  student, an educator and a manager hold the same licence. `assigned` is a
  server-owned counter — a manager's client may write `total` only (column
  privilege).
- Seats never grant permissions and never raise `scope: 'org'` limits.
- A seat may **raise** a user-scope limit, never lower it (`max(org, seat,
personal)`; `-1` short-circuits). A seat is an upgrade, not a cap.

> **2026-11-22 (phase 4a, D33).** Shipped: `org_seat_pools.plan_key` now
> `REFERENCES subscription_plans(key)` (the migration aborts with a readable
> message if an existing pool points at a non-personal plan).
> `SeatService.addPool` validates the licence before writing anything — the
> plan must exist, be active, be `scope='personal'`, and every entitlement key
> of the plan must be `seatEligible` in the live `entitlement_catalog` (one
> query, DB truth); refusal is `UNPROCESSABLE_ENTITY` with a field error on
> `planKey`. `PLAN_TIER_MAP` is deleted. `SeatService.assignSeat` reads the
> target's `profiles.account_type` (new column, backfilled from the JWT and
> kept in step by `handle_new_user` and the admin's `updateAccountType`) and
> requires it to equal the pool plan's `audience`; unresolved ⇒ `BAD_REQUEST`.
> `ROLE_TIER_MAP` and `embeddedRoleName` are deleted. `PlanInfo` gained
> `scope`, `audience` and a derived `seatEligible` (true iff the plan has at
> least one entitlement and all of them are `seatEligible`); `forAccountType`
> is removed.

> **2026-11-28 (D38, #1511).** A seat licence grants **its own keys**; the org
> ceiling no longer filters it. B2 removed `ai.chat` from all four organization
> plans on purpose, so the old `profile + seat ∩ ceiling` arm could never grant
> an AI seat: the ceiling was `{flashcards, quiz, quiz.templates, stats.insights, branding}`, and no seat key survived the intersection
> (`MGR-SEAT-02` records the workaround: the AI came from the member's personal
> plan, not the Max seat). Adding `ai.chat` to the org plans is not the fix —
> `applyProfile` grants the ceiling to every `all` role, so that row would fund
> AI for every Teacher and Admin on a paid org tier. The pool subscription is
> the purchase, so "the org bought it" holds through the pool, not through the
> org plan. The bracket `inOrg && orgPlanKey && ctx.orgRoleId` stays.
>
> Consequences, all pinned:
>
> - **The invariant moves to the catalog.** A licence plan is
>   `scope='personal'` and every key is `seatEligible` (`addPool`), so a seat
>   can only carry a personal key. `catalog-invariants` now asserts
>   `seatEligible ⇒ scope: 'personal'` across `ENTITLEMENTS`.
> - **A partial licence is silent.** A licence plan carries one quota row
>   (`max_ai_tokens_per_day`), so `composeLimits` reads the seat's value without
>   the "plan is missing a limit" warning (F6). The warning keeps its meaning for
>   the org and personal layers, which claim to be full plans. Do not paper over
>   it with fourteen `0` rows: a missing `plan_limits` row is already `0`.
> - **The sales channel is the gate.** The three AI tiers are `public` plans
>   with `sales_channels = {seat_pool}`; `listActive`/`getByKey` filter to
>   `individual` and `listLicencePlans` filters to `seat_pool`. `public` is an
>   accepted price-list exposure for the anonymous key (the read is a price
>   list; no anonymous surface sells a licence).
>
> Role independence (#1146) is recorded in the §5.4 bullets: a seat is
> per member, not per role, and `assigned` is writable only by the server.

### 5.5 Personal plans

- Outside an org: personal entitlements + personal limits.
- Inside an org: personal plans are additive for `personalPortable` keys only
  (the #971 intent). They never add org-scoped entitlements or org capacity.
- Managers hold no personal plan (ADR-0007): a manager is an organization
  buyer, and the checkout refuses a personal plan for one. Legacy rows are
  cleared to NULL by the cleanup migration (pre-market: no compatibility
  constraint).

> **2026-11-22 (phase 4a, D34).** The persona branch is gone: inside a
> **verified** org a personal plan whose own `scope='organization'` does not
> apply (it is the legacy org-buyer mirror, D-ADR-0007) — the resolver reads the
> plan's scope from the `subscription_plans(scope)` embed on the batched
> `plan_entitlements` read, so the rule costs no extra query and the budget
> stays at seven. Outside an org the personal plan always applies. The
> migration backfilled every manager off organization-scope plans onto
> `solo`, and `getPersonalPlan` returns the stored plan verbatim (the old
> paid-org-plan demotion fallback is deleted). `getMyPlan` keys on seat/org
> scope and `org.billing.manage`, never on the caller's persona: seated → seat
> plan; else in a verified org with `org.billing.manage` → the org plan; else
> the personal plan.

### 5.6 Overrides and flags

- `user_entitlement_overrides` (renamed from `user_feature_overrides`) accepts
  **entitlement keys only**. Comp/trial grants work; structural keys are
  rejected by the model.
- Overrides are applied after role/seat/personal, before flags. They can add or
  remove an entitlement, but they cannot change a limit; a comp that needs a
  quota gets a `user_limit_overrides` row (new, optional) or a trial plan.
- Overrides bypass flags (a comp account should not be switched off by a
  rollout).
- `feature_flags` (rename to `entitlement_flags`) accepts entitlement keys only.
  **Settled 2026-11-13: `is_enabled = false` is the only operation.** There is
  no `rollout_percentage`; with no users to stage, per-user bucketing bought
  nothing and cost a second resolution path. A missing flag row fails
  **closed** (unlike today).
- A flag can never grant; it can only remove. Deleting a flag is not a kill
  switch — the admin UI sets `is_enabled = false` and keeps the row.

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
    roleSet  = role.profile === 'all'     ? ceiling
             : role.profile === 'learner' ? LEARNER_ENTITLEMENTS ∩ ceiling
             : ∅
    seatSet  = seat ? planEntitlements(seat.plan) : ∅   // D38: the pool is the purchase
    personal = personalPlanApplies(ctx) ? personalEntitlements ∩ PERSONAL_PORTABLE : ∅
    set      = roleSet ∪ seatSet ∪ personal

    limits.user = combine(orgPlan, seatPlan, personalPlan) // max, -1 short-circuit
    limits.org  = orgPlan                                   // never personal/seat

  set = applyOverrides(set)          // entitlement keys only; an ACTIVE override is the
                                      // final word on its key in both directions (D26)
  set = applyFlags(set)              // kill switch only; a missing row fails closed;
                                      // skips keys an active override owns (D12/D26)

  effective = { k ∈ set | quota(k) == null OR limits[k.quota] != 0 }

  return { entitlements: effective, limits, sources, plan: effectivePlan }
```

Rules:

- Personal-plan applicability: outside an org always; inside a verified org
  unless the personal plan's own `scope='organization'` (the legacy org-buyer
  mirror, ADR-0007) — see §5.5's 2026-11-22 note (D34). The persona-keyed
  `personalPlanApplies(ctx)` (phase 3) was deleted in phase 4a; the pseudocode
  above now reads applicability off the plan's scope.
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
| Org, manager           | `max(org, seat)` (personal excluded)      | org plan       |
| Non-member / forged id | personal plan (user), `0` (org)           | `0`            |
| Missing row            | `0` + warning                             | `0` + warning  |

The seat is **not** exclusive. This is the deliberate reversal of #233 Q1 for
user-scope keys; #233 Q1 still holds for `scope: 'org'`.

### 6.3 Permissions

```
resolvePermissions(ctx):
  if (!org) return PERSONAL_PERMISSION_KEYS  // each at `own`; the persona is never read
  perms = org_role_permissions(role)         // key -> scope
  group = group_members(ctx.userId)          // group -> role (teacher/member)
  return { perms, group }
```

`PERSONAL_PERMISSION_KEYS` (`@studiq/authz`) is the 20 personal content
CRUD keys (`deck`/`flashcard`/`topic`/`question`/`question_bank` ×
read/create/update/delete), the three assignment verbs a personal
(`organization_id` NULL) row supports (`read`/`update`/`delete`), plus
`stats.read` — **24 keys**. `quiz.*` and `assignment.create` are deliberately
absent: a quiz is an org row and an assignment is created inside one, so their
services refuse a no-org call and a personal scope could only authorize a
request that then fails. `assignment.publish`/`grade` are absent because no
no-org caller held them: the persona default this set replaces matched only
`read`/`create`/`update`/`delete`, and both verbs act on an org cohort. A unit
guard derives that expected set from the catalog's `category` and fails when a
content key is added without being classified.

> **2026-11-23 (phase 6c, D35).** The no-org branch is no longer
> `defaultsForPersona`: any authenticated caller resolves the personal set at
> `own`, and no `accountType` read remains in `resolveScope`. Provisioning may
> still read the persona (default plan catalogue, default dashboard); the
> authority path never does. Inside an org nothing changes: the stored role row
> is the whole answer, and a key without one is denied.

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

> **2026-11-22 (phase 5a).** `requireFeature` and `lib/features.ts` are deleted;
> the server gate is `requireEntitlement` in
> `packages/server/src/lib/entitlements.ts` (resolver-backed, fail-closed).
> `/features/me` keeps its HTTP shape until phase 6 renames the endpoint.
>
> **2026-11-23 (phase 5d, register row 12).** The last two catalogued-but-ungated
> keys are enforced, as `quiz.templates` and `stats.insights`: the saved-quiz
> library writes on `/api/v1/teacher/quizzes` (`POST`, `PUT`/`DELETE [id]`,
> `POST [id]/questions`, `POST [id]/create-assignment`, `PUT [id]/bulk`) gate on
> `requireEntitlement(ctx, 'quiz.templates')` as the first statement of each
> controller method (the `ai/chat` precedent) — the `GET` list/detail reads and
> the ad-hoc assignment path stay open, so a free teacher can still test a class;
> the diagnostic stats reads (`/api/v1/stats/student/insights`,
> `/stats/weak-points`, `/stats/teacher/groups`, `/stats/teacher/activity`,
> `/stats/teacher/feed`) gate on `stats.insights`, while the descriptive reads
> stay free (descriptive = what happened, diagnostic = why / what to do). The UI
> reads the same keys through `/features/me` and swaps the gated surfaces for a
> plan card. Entitlement gates are API/UI only — no RLS twin: entitlements are
> plan data, not authority, and RLS never implements a wider rule than the API
> (§7's RLS rows are permission-only).

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

> **2026-11-20 (phase 2b-3).** Three reads are membership, not capability.
> `GET /organization/:id` and the role list/detail stay readable by any
> `org_members` row of the active org: the member screens and `withAuth` itself
> need them, and the catalog has no read key. `GET /organization/members` moves
> onto permissions but with four read authorities (D25): `org.member.manage` at
> org scope, or `group.manage`, or `group.invite`, or `org.seat.manage` at any
> scope the role holds them. The catalog has no `org.member.read`, a Teacher must
> not hold `org.member.manage` (D18/FP-04), a class manager and a class inviter
> pick from the same org roster (`/edu/classroom/members`, the assignment student
> picker, the `/edu` onboarding counts), and the shipped Billing preset is exactly
> `org.billing.manage` + `org.seat.manage` while `/manage/seats` fills its assign
> dialog from this roster. A caller holding none of the four reads an empty list,
> not a 403: the list leaks nothing and AUT-19 accepts it, while `PUT`/`DELETE`
> on the route stay `org.member.manage` and the Billing preset fails every such
> write. The invitation list is `org.invitation.manage` while its SELECT policy
> keeps the `inviter_id = auth.uid()` branch — an inviter may still read the row
> they minted; 2b-5 moves that read with the write half (2b-4 measured that
> PostgREST refuses an UPDATE whose row the SELECT policy hides).
>
> **2026-11-20 (phase 2b-5).** Moved: the `invitations` SELECT now reads
> `org.invitation.manage` on org-invite rows or `group.invite` on a class
> invite's group (plus the `inviter_id = auth.uid()` branch), together with the
> write policies — R25 closed. An `org.invitation.manage` holder can now
> retarget a row they did not mint (previously a silent `200 []`).
>
> **2026-11-20 (phase 2b-4).** The control plane now enforces the catalog at the
> table: `billing_subscriptions`' org read and the subscription actions of
> `BillingService` (change plan, cancel, release a scheduled change, reconcile,
> and the Stripe portal) are `org.billing.manage`; the assignment writes are
> `assignment.update` / `assignment.delete` (organization scope; the author
> branch covers `own`), and composing a draft — the item set and the cohort,
> including replacing the cohort — is an update on all three verbs, so only the
> `teacher_assignments` DELETE asks for `assignment.delete`. The child tables
> follow the parent's org, and the staff read of an assignment's item set is
> `assignment.read`. `POST /stripe/create-checkout-session` stays on
> `resolveCheckoutOwner`: its body names an org that need not be the active one,
> and that resolver is shared with the mock-completion path, which has no
> `RequestContext`; 2b-6 owns its per-target-org resolution. Three asymmetries
> are recorded, not solved: `teacher_assignments` INSERT keeps its persona
> conjunct while the route layer waits for 2b-6; `org_members` SELECT stays
> membership-wide while the D25 roster read is four keys — narrowing it would
> empty the readers whose gates are not among the four (org detail, report
> inbox, role counts, the group roster, assignment target validation, teacher
> stats), so phase 5 owns it; and the billing **owner** is still persona-keyed —
> `ownerFromContext` and `BillingReadRepository.findSubscription` resolve an org
> owner only for `accountType === MANAGER`, so a `student`/`educator` persona
> holding Admin or the Billing preset never reaches the gate at all (D13 makes
> the persona irrelevant). Deriving the owner from `activeOrgId` + membership is
> a product decision — a member with a personal subscription in an org would
> stop reading it — so **phase 5 (the 2b-9 slot) owns it**, together with the
> read model's owner branch.

> **2026-11-20 (phase 2b-6).** The first of the three asymmetries above is
> resolved: the 29 content/stats/teacher route files no longer carry
> `allowedAccountTypes` (the controllers gate on `quiz.*`, `assignment.*`,
> `stats.read` and the ledger's `question_bank.update` from the context), and
> the `teacher_assignments` INSERT policy moved off the JWT persona onto
> `assignment.create` in the same PR (R4), so a student-persona Admin mints
> runs like any other holder (D13). The org-wide `teacher_assignments` SELECT,
> the `quiz_attempts` staff branch and the teacher-dashboard RPCs still read
> the persona — they sit on shared multi-reader paths (five services read
> `quiz_attempts` under different keys) and are phase 5's (2b-9) with the
> `org_members` SELECT.
>
> **2026-11-21 (phase 2b-9).** **Phase 2 is complete** (2b-1…2b-9 merged, 2b-7 as
> `f62b896d`, 2b-8 as `9747f372`). What now holds: org-resource authority is
> permissions-only — the control plane gates on `org.*`/`group.*` keys from
> `ctx` and enforces the same keys at RLS (`rls_caller_has_permission` and its
> group/role-editor twins, R4); the role editor's guards (system roles, last
> `org.role.manage` holder, §4.4 write predicate) hold at both the API and the
> table; class invites are `group.invite` on the group and never touch the
> invitee's org role; the four legacy management entitlements are deleted from
> every table (0 rows, 0 policies referencing `has_org_feature`/`is_org_manager`,
> `permissions` = 44, `entitlement_catalog` = 6, measured on the branch's live
> stack); and the only `allowedAccountTypes` left on the API surface are the
> four declared exceptions — R5 org creation and classroom creation, plus the
> phase-5 `ai/chat` and `ai/usage` pair — pinned by
> `__tests__/unit/guards/persona-gates.test.ts`, so a fifth persona gate (or a
> stale exception) fails a unit test. The remaining persona/role-name branches
> that still decide authority — the `org_members` SELECT, the org-wide
> `teacher_assignments` SELECT, the `quiz_attempts`/`exposure_events` staff
> branches, the teacher-dashboard RPCs, the billing owner and checkout resolver,
> `can_assign_org_role`'s §4.4 gap, the seal, and the plan-resolution persona
> branches — are enumerated with `file:line`, an owning phase (3/4/5) and a
> reason in the **deferral register** in
> [role-authority-plan.md §5, phase 2b](role-authority-plan.md#phase-2b--authority-and-control-plane);
> phase 5 does not rediscover them one note at a time.
>
> **2026-11-23 (phase 5e-1).** §7.1's "member" in the 403/404 rule is read as
> **member of the request's org**: `QuizTeacherService` now has one derivation
> (D-5e2) — a missing quiz and a quiz in a foreign org are both `404` (the
> request is scoped to `active_org_id`, so a member of org B with A active
> gets 404 and can switch; tenant existence is not leaked), and only a
> same-org row the caller's `permission` scope does not reach answers `403`.
> The per-call-site `foreignOrgError` parameter is deleted; the matrix is
> pinned at API level by
> `__tests__/integration/quiz-teacher-404-403-matrix.test.ts` (PUT: 404
> missing, 404 foreign org, 403 same-org unreached, 200 own) and at unit level
> by `quiz-teacher.service.test.ts`.
>
> **2026-11-22 (phase 5a).** The `ai/chat` + `ai/usage` pair is gone from that
> list: both routes now gate on `requireEntitlement(ctx, 'ai.chat')` as the
> first handler statement, so exactly two declared exceptions remain (the R5
> creation routes), pinned by `persona-gates.test.ts`.
>
> **2026-11-22 (phase 5b).** The billing owner and the checkout resolver left
> the register: `ownerFromContext` resolves the **org** owner iff the caller
> holds `org.billing.manage` in the active org (operator decision — persona
> never decides; a student/educator on the Billing preset or Admin reaches org
> billing, a shallow manager keeps only their personal row), and
> `resolveCheckoutOwner` proves `org.billing.manage` **in the explicit target
> org** through the `has_permission` RPC — the target org need not be the
> active one and there is deliberately no active-org equality, so a caller
> who may bill org B but not A can buy for B and is refused for A. The old
> role-name checks (`isOrgAdmin`, `rls_caller_is_org_manager` in org delete,
> now `org.admin` at organization scope via `scopeCovers`) are deleted from
> every server path; the `/checkout` page gate stays cosmetic until phase 6.
>
> **2026-11-23 (phase 5c).** The report inbox and the bank export left the
> persona and the role name: the org-wide report scope is
> `hasPermission(ctx, 'org.report.manage')` in the active org (a student-persona
> Admin reaches it — D13; a manager whose role lacks the key does not), and an
> ownerless group's report is routed to the first member whose role holds
> `org.report.manage`, never to a role named `admin`.
> `exportBank` (`/api/v1/questions/banks/[id]/export`) carries no persona
> conjunct at all: `question_bank.update` on the bank is the whole gate, so a
> student holding the key may export (the answer-key exposure the old conjunct
> guarded is still covered — by the key, not by the account type). The topic
> default visibility moved here too: see the §10 note.
>
> **2026-11-23 (phase 5e-1).** "Learner on an assignment" is **data, not
> persona** (D-5e1): a caller is a learner for a published, in-window (or
> held-back) run when it targets them directly (`assignment_targets.student_id`),
> through a group where their `group_members.role = 'member'` (a group teacher
> is staff of that class, not a learner in it), or org-wide (`seal_org_wide`)
> with a learner-profile org role (`org_roles.entitlement_profile = 'learner'`,
> the system Member; Admin/Teacher are `'all'`). The same three arms drive the
> seal (`rls_caller_is_sealed_item` in SQL and `sealedItemsFor` in TS — the two
> halves read `group_members.role` and `org_members → org_roles.entitlement_profile`
> and must agree), and the exposure write guard (`assessment-review.service.ts`
> via `callerIsLearnerOnAssignment`, so #1172's author preview still mints no
> event while a directly targeted educator does). The seal and both TS halves
> also carry the **author exemption** (R4, #1172): an assignment never seals its
> own author — `a.created_by IS DISTINCT FROM auth.uid()` per binding row in the
> SQL function, the same `created_by` filter in `sealedItemsFor` and in
> `callerIsLearnerOnAssignment` — so an author keeps seeing the items they are
> composing even when they are a `member` of the targeted group, while a
> targeted educator who is not the author is still held. The `exposure_events` staff
> read moved to `rls_caller_covers_permission(organization_id, 'stats.read',
'group')` — the scope rank own < group < organization means a Member's
> own-scope `stats.read` does not qualify. `quiz_attempts` "Own or staff quiz
> attempts" is now one predicate for USING and WITH CHECK (grading writes
> another user's row): own row, or a same-org row the caller covers via
> `stats.read` / `assignment.read` / `assignment.update` at group-or-wider
> scope, or an attempt of an assignment the caller authored.

> **2026-11-24 (phase 6b-2).** §7.1's "no access in this org" state is now a
> component, and it is **permission-derived throughout**: `AreaGate`
> (`apps/web/src/components/layout/area-gate.tsx`) reads `/me/orgs` and the
> active org's `['permissions', orgId]` answer, and while any of those facts is
> unresolved — the list loading, a settled list whose active org is not pinned
> yet (the map then describes the personal layer), the map pending, or the answer
> echoing a different `orgId` — it renders a neutral placeholder rather than the
> children or the card; a failed read offers a retry instead. It **keeps the URL**: a bookmarked
> `/manage/...` or `/edu/...` loads, the card names the active organization and
> offers one "switch to {org}" button per other membership (or the `/app`
> fallback when there is only one), and the page's own reads remain the boundary.
> Two predicates live in `apps/web/src/lib/dashboard-home.ts`, and they answer
> **different questions**: `resolveDashboardArea` says where home is (any of the
> nine `org.*` keys → `/manage`; the three class-management keys → `/edu`; else
> `/app`), while `hasAreaAccess` says whether the area is usable at all —
> `/manage` is the same nine `org.*` keys, `/edu` is every `groups`-category key
> **plus every content `.read`**, both derived from `PERMISSIONS`. The gate is
> broader on purpose: a Member holds content reads (so `/edu` is legitimately
> theirs) and a Billing-preset holder holds only `org.billing.manage` +
> `org.seat.manage` (so `/edu` is closed to them). §14.1's "returns 403 (not 404
> and not 200)" for a bookmarked admin URL is read as its data read: the route
> is auth-only and answers `200` with the page, the roster read answers the D25
> empty deny shape, and the writes answer `403`.

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
  -- v1: three-valued profile replaces the boolean (§5.3)
  entitlement_profile text not null default 'none'
    check (entitlement_profile in ('all','learner','none'))
)

org_role_permissions (
  org_role_id uuid not null references org_roles(id) on delete cascade,
  permission_key text not null references permissions(key),
  scope text not null check (scope in ('own','group','organization')),
  primary key (org_role_id, permission_key)
)

-- entitlement allocation (subset of the org plan) ---------------------------
-- DEFERRED (v1.1): not created in v1; `entitlement_profile` covers it. Kept
-- here as the target shape when per-role allocation lands.
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
-- Amended 2026-11-19 (D15): a pool is the licence record and an assignment
-- occupies one licence. No plan-seat grants and no per-org licence table.
org_seat_pools ( ..., plan_key text not null references subscription_plans(key) )

-- overrides / flags ---------------------------------------------------------
user_entitlement_overrides ( user_id, entitlement_key, is_enabled, expires_at, ... )
user_limit_overrides       ( user_id, limit_key, limit_value, expires_at, ... )  -- optional
entitlement_flags          ( key, is_enabled )                                   -- renamed; no rollout column

-- groups --------------------------------------------------------------------
group_members ( ..., role text not null check (role in ('teacher','member')) )
invitations ( ..., group_id uuid null references groups(id), target_group_role text null )
```

### 8.2 Invariants (enforced by constraints/triggers + tests)

1. `plan_entitlements.entitlement_key` never appears in `permissions.key`.
2. `org_role_permissions.permission_key` never appears in
   `entitlement_catalog.key`.
3. Every resolved entitlement is a member of
   `plan_entitlements(organizations.plan)` (intersection at resolution; v1.1
   adds the write-time check on `org_role_entitlements`).
4. `org_seat_pools.plan_key` references a `scope='personal'` plan whose keys are
   `seatEligible` (amended 2026-11-19, D15: the pool **is** the licence record,
   so there is no `org_seat_licenses` count to validate against).
5. An empty custom role has zero permissions and zero entitlements.
6. No plan/seat/personal/override row can grant a permission key.
7. Every active plan defines every `limit_catalog` key.
8. `entitlement_flags` contains every `surface` entitlement key (baseline keys
   may be absent).
9. A plan downgrade changes the ceiling in one transaction; every profile
   narrows with it because resolution intersects. (v1.1 additionally prunes
   `org_role_entitlements`.)
10. `org_members.org_role_id` references a role in the same org (existing
    trigger is kept).

### 8.3 What is deleted

- `org.manage` and the `ADMIN_ONLY_FEATURES`/`ORG_SCOPED_FEATURES` denylists.
- Plan-seeded `org_role_features` snapshots (replaced by
  `entitlement_profile`; the allocation table is v1.1).
- `allowed_roles` (already dead), `feature_permissions` (already dropped).
- `permissions` rows whose name is an entitlement key (`ai.chat`,
  `org.manage`, `study.*`, `test.*`).
- `resource_permissions` (dead; dropped in phase 0b).
- `can_assign_org_role` teacher-role-name exception.

> **2026-11-21 (phase 2b-7).** The four legacy management entitlements
> (`role.builder`, `org.manage`, `member.manage`, `group.manage`) are deleted
> from every entitlement table in
> `supabase/migrations/20261121090000_legacy_management_markers_removed.sql`,
> and `has_org_feature` / `apply_org_plan` / `handle_new_organization` are
> re-created without their marker lists. `group.manage` remains as a permission
> (§4.1); the audit keeps its pre-cutover identifiers as history.

> **2026-11-20 (phase 2b-5).** Deleted: `can_assign_org_role` is now
> `has_permission(actor, role's org, 'org.invitation.manage')` alone. A teacher
> invites students through a class invite (`invitations.group_id` +
> `target_group_role`, `group.invite` on that group), never through an org
> invite; the invitation SELECT moved off `rls_caller_is_org_manager` in the
> same slice (R25).

- `has_org_feature` in RLS (or regenerate it from permissions only).

> **Truth notes (2026-11-19, phase 0b).** `assignment.*` **stays**: the
> assignment surface returned as `teacher_assignments`, the keys are declared in
> `Permission`, and #1256 seeded them on the system roles — the "surface was
> dropped, so delete the keys" reading of this list was wrong. And
> `feature_permissions` needs no action: it was already dropped in
> `20260915000005`.

---

## 9. Custom roles: UX and guardrails

The role editor is a first-class admin screen, not an API-only feature.

**Editor layout**

1. Template picker (Assistant / Billing / Read-only / Blank; D17 — the three
   seeded roles are not picker entries).
2. Permission list grouped by category; each row has a scope selector
   (`own | group | organization`) limited to the permission's `allowed_scopes`.
3. "Entitlements this role receives" — a profile picker (`all`, `learner`,
   `none`) in v1; per-entitlement checkboxes arrive with allocation (v1.1).
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

> **2026-11-19 (phase 2a-3).** The closed catalog, the no-self-edit rule and the
> "you cannot grant what you do not hold" rule are enforced server-side because
> that write replaces the role's whole permission set: `SetRolePermissionsSchema`
> refuses a payload that is not the complete catalog or a scope a key does not
> allow (422) at the controller, `isCompleteCatalogPayload` repeats the
> completeness rule at `OrgRoleService.setPermissions` for its direct callers, and
> the service answers 403 for self-edit and escalation. The write is target-first
> (upsert the granted rows, then prune the rest), so a failed save leaves a
> superset rather than an emptied role.
>
> **2026-11-21 (phase 2b-8).** The three role-editor guards now hold **at the
> table** as well as the API, closing the PostgREST bypass (R4/FP-01):
> system-role delete is a policy conjunct on `org_roles` DELETE and
> `is_system` flips are refused in both directions by the
> `guard_org_role_system_flip` BEFORE UPDATE trigger, while system-role
> description / display-name / `entitlement_profile` edits remain allowed;
> the last `org.role.manage` holder is protected by an organization-row
> `FOR UPDATE` count in the BEFORE DELETE/UPDATE triggers (R29) — the API's
> 409 is the normal path and the trigger's 42501→403 the race backstop;
> `org.admin` stays non-assignable (D16), and the `org.admin@organization`
> exemption (D21) applies to removals/grants but never to `org.admin` itself;
> service-role/owner writes are exempt by design (trusted plane); and the
> `org_members` SELECT asymmetry stays with phase 5 (D25).
>
> **2026-11-25 (phase 6d).** The editor now answers §4.4's "grant only what you
> hold" before the save instead of after it: `apps/web/src/lib/role-grants.ts`
> reads `scopeCovers`/`PERMISSIONS` from `@studiq/authz` and disables a scope
> (and a grant checkbox) the caller cannot grant, with a title; the
> `org.admin`@organization exemption is the one the server's `grantDenied`
> applies (D16/D21). Keys are never hidden — the complete payload would delete a
> grant the editor does not render — so a stored grant beyond the caller's
> authority stays visible and non-editable, and removal remains the server's
> decision. A new grant defaults to the narrowest scope the caller may grant,
> and every catalog key's `allowedScopes` is now pinned narrowest→widest so that
> default is a rule rather than declaration order. The profile picker's write
> joined the permissions payload (`SetRolePermissionsSchema`'s
> `entitlementProfile`, `null`/omitted = not managed): one request, profile
> written **first**, and a permission-write failure restores the stored profile
> by one scoped update and logs a failed restore. This is a compensation path,
> not a database transaction — no atomicity beyond that is claimed.

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

> **2026-11-20 (phase 2b-5).** Both invite shapes exist now:
> `invitations.group_id` + `target_group_role` are set together on a class
> invite (pair CHECK) and both null on an org invite. `POST
/organization/invites` accepts either: a class target (`groupId` +
> `groupRole`) is decided by `group.invite` on that group, an org target by
> `org.invitation.manage`. D7 in v1: a class invite's invitee must be an
> existing org member, and accepting it adds the group membership with
> `target_group_role` (idempotent) without granting or changing the org role;
> the invite UI that posts a group target is phase 6.
>
> **2026-11-20 (phase 2b-5 review).** The D7 invariant is now structural at
> both planes: the accept RPC's class branch inserts `org_members` only
> `where exists` in the same statement snapshot (`insert … select … where
exists … on conflict do nothing`), so a membership row deleted between the
> pre-check and the insert (READ COMMITTED re-snapshots every statement) is
> not re-created with the invite's target role; and the write trigger
> normalizes a class row's `target_org_role_id` to the system `member` role,
> so a `group.invite` holder cannot persist a class invite carrying another
> org role.
>
> **2026-11-23 (phase 5c).** A new topic's default visibility derives from the
> caller's `topic.create` scope, never from the persona: `group` or
> `organization` scope defaults to `group` (class-visible), anything narrower
> defaults to `personal`; an explicit `visibility` in the request always wins,
> and sharing to supplied `groupIds` still requires the group-share check.
> Consequence of the seeded matrix (§4.2): the system **Teacher** role carries
> `topic.create` at `own` (content writes at `own`, D29), so an educator on it
> now defaults new topics to `personal` rather than `group`; only a role with
> `topic.create` at `group`/`organization` (e.g. Admin) keeps the class-visible
> default. The web UI always sends an explicit `visibility`, so this default
> applies to API callers that omit the field.

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
  product decision (see §6.2 and §15 #4).
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

> **2026-11-20 (phase 2b-4).** The control plane's one deliberate any-scope key
> is the assignment cohort read. `rls_caller_can_read_assignment_items` asks
> `rls_caller_has_permission(org, 'assignment.read')` without pinning
> `organization` scope, so a Teacher holding that key at `own` (before 3d; `group`
> since D29) reads a colleague's item set through PostgREST while
> `TeacherAssignmentService.getById` requires organization scope (or
> authorship) for the same rows. The branch it replaced — any educator/manager
> persona in the org — was org-wide too, and pinning the read to the write's
> `organization` scope would be a third answer between the API and the data
> plane inside one slice; the phase-5 closure owns the narrowing with the rest
> of this section.

> **2026-11-25 (phase 6e).** The run **list** now reads at the caller's scope:
> `TeacherAssignmentService.list` returns the active org's runs the caller
> authored **or** that target a class they **teach**
> (`ctx.groupRoles[groupId] === 'teacher'`, the plan's 2b-2 operator decision —
> not plain `ctx.groupIds` membership, because a `member` of a class is its
> audience, not its staff). The run **detail** is deliberately narrower than the
> RLS SELECT, which admits any member of a targeted class: `getById` stays the
> author's, or an `organization`-scope `assignment.read` holder's (R23). The
> reason is the key — the detail payload is the live composer or the frozen
> snapshot **with** its answer key (`withAnswerKey`) behind the authorship /
> `organization`-scope gate, so widening that gate hands a co-teacher a
> colleague's key. (The seal's author exemption, D-5e1, is about item sealing,
> not key visibility.) The asymmetry is recorded at `getById`; its owner is
> **phase 7** (e.g. a read-only header for a colleague's run). The `group` arm is
> pinned to the active org, so a teacher who belongs to two orgs no longer lists
> their authored runs from the other org (before this slice the `group` scope
> fell through to `created_by` only), while `getById` still serves the author;
> this is deliberate for the active-org list, no follow-up. The 2026-11-20 note
> above still governs the assignment's **item set**; this note governs the run
> list.

---

## 13. Migration plan (ordered batches)

Each batch is shippable on its own; the order keeps the app working between
batches. Pre-market allows a big-bang at the end if preferred.

> **Execution (settled 2026-11-13).** Each batch lands as one or more PRs
> **directly into `main`**. There is no integration branch, no runtime flag and
> no dual model. `docs/plans/role-authority-rollout.md` holds the normative PR
> queue and per-phase acceptance criteria; this section records what each batch
> _contains_, not when it ships. `docs/plans/role-authority-plan.md` is the live
> status and memory ledger.
>
> Batch numbers are **not** phase numbers. Rough mapping: batch 0 → phase 0b,
> batch 1 → phase 1, batches 2 + 6 → phases 2 and 7, batch 3 → v1.1, batches 4 +
> 5 → phases 4 and 5. Where a batch's FP list differs from the queue, the queue
> wins: it is the only place FP placement is authoritative.

### Batch 0 — cleanup and guardrails (existing orgs unchanged; new orgs get the corrected catalog)

- Delete dead tables/keys: `resource_permissions`, `assignment.*` if unused,
  `feature_permissions` remnants; remove entitlement keys from `permissions`.
- Add tests: `permissions ∩ entitlements = ∅`; every active plan defines every
  limit key; every surface entitlement has a flag row.
- Freeze the current `FEATURES` list; no new keys until Batch 1.
- Maps to FP-13, FP-19, FP-20.

> **0b correction (2026-11-19).** Batch 0 ships the stricter assertion — every
> `FEATURES` key has a `feature_flags` row — rather than "every surface
> entitlement", because the `category` split does not exist yet. Phase 1 adds
> `entitlement_catalog.category` and narrows the test so baseline keys need no
> flag row.

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

### Batch 3 — entitlement allocation (v1.1; not in the queue)

- Add `org_role_entitlements` with the subset trigger, and collapse
  `entitlement_profile` to `all | none` plus explicit rows.
- Replace `org_role_features` and the plan-seeded snapshots.
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

- `org_seat_pools.plan_key` FK (the pool is the licence, D15: no
  `org_seat_licenses`); validate `addPool`; tier check by `account_kind`/
  audience, not role name.
- Seats intersect the org ceiling; never permissions; never org capacity.
- Personal plans additive for `personalPortable`; managers use `solo`; backfill
  legacy `personal_plan_key` rows.
- Maps to FP-02, FP-14, FP-22 (manager AI becomes possible via entitlement).

### Batch 6 — RLS and enforcement parity

- `rls_caller_has_permission(org, key)` for control-plane policies; delete
  `has_org_feature` or regenerate it from permissions only.
- FP-03 is settled (D11): control-plane only in this programme; content RLS
  (tenant floor vs scoped vs service-role access) is a separate security ADR.
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
- A role cannot allocate an entitlement the org does not own (v1.1, with
  allocation).
- A role editor cannot edit its own role or grant beyond its own authority.
- `group.manage`/`group.invite` at `group` scope work for a class teacher and
  do not grant org member management.
- A free seat cannot lower a user-scope limit below the org or personal plan.
- An entitlement with quota `0` is unavailable through API and UI.
- A plan downgrade atomically removes the entitlements it no longer includes.
- A custom role (`entitlement_profile = 'none'`) resolves no entitlement.
- `/me/entitlements` and enforcement agree after checkout/seat/role/flag changes.
- No `permissions` row is an entitlement key and vice versa.
- Every active plan defines every limit key.
- The visible nav/route set is a function of the **active org's** role; switching
  orgs changes it atomically, and a role in one org never authorizes another.
- A bookmarked admin URL in an org where the user is a Member returns 403 (not
  404 and not 200), and the UI shows an org-scoped "no access" state.

  > **2026-11-24 (phase 6b-2).** Read the 403 as the URL's _data_: the page must
  > load and show the state (a redirect on a missing key is exactly what §14.1
  > forbids), so the bookmarked route answers `200` with the page, the roster read
  > answers the D25 empty deny shape, the writes answer `403`, and the page
  > renders `AreaGate`'s card instead of its content. Pinned by QA `AUT-20`
  > (`qa/cases/AUT-20.md`, `__tests__/qa/AUT/AUT-20.spec.ts`).

### 14.2 Quadrants

| Personal \ Org | free org (`launch`)                                                   | paid org (`hub`/`campus`)                                  |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| free personal  | profile only (`learner` at most); no AI; 0 AI tokens                  | profile-based; AI only if the profile includes it          |
| paid personal  | personal-portable keys added (`ai.chat`, builder, stats) + max limits | union; personal adds portable keys, org capacity unchanged |

Plus: seated/unseated, custom role, manager, override, kill switch, downgrade,
forged cookie.

### 14.3 Test layers

- Unit: catalog source scans, resolver truth tables, permission scope evaluation,
  entitlement profile resolution, override/flag ordering.
- Integration: schema constraints/triggers, DB-backed catalog invariants, plan
  change, seat licensing, group permissions, RLS parity, cache invalidation via
  API headers/version.

**Catalog invariants are split by what they need (2026-11-19, phase 0b).**
Assertions that read rows — `permissions` ∩ entitlements = ∅, the `permissions`
catalog equalling `Permission`, every `FEATURES` key having a `feature_flags`
row — are integration tests (`__tests__/integration/catalog-invariants.test.ts`).
The guard that every `permissionScopes['…']` literal exists in the catalog is a
source scan and therefore a unit test
(`__tests__/unit/guards/permission-scopes-catalog.test.ts`): a phantom key fails
before a stack is needed, which is the failure mode N1 actually had.

- E2E: teacher class management without org member management; manager creates
  a custom role and assigns it; student with personal Pro in a free org keeps
  AI; member with a free seat in a paid org does not lose the org budget.

**The product regression gate is the QA suite** (`qa/cases` + `__tests__/qa`,
188 case documents, 170 of them with a spec and 6 temporary re-runs) plus the E2E suite.
Unit and integration tests are
implementation tests: they are expected to change in large numbers, and they are
not the compatibility contract. The QA case text, spec and `qa/coverage.md` are
the product specification; a case that encodes a current bug is edited with
QA/product sign-off, never skipped.

---

## 15. Decisions (settled 2026-11-13)

Every question below was answered before phase 1 and is normative. An
orchestrator that hits one of these stops and implements the answer, not an
interpretation.

| #   | Question                                                            | Decision                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Is `org.admin` a permission or just the system role?                | **A real permission for ownership only** (delete org, transfer ownership). Day-to-day checks always use the granular key; there is no superuser override.                                                                                                                                                                |
| 2   | Do managers get a paid personal plan?                               | **No; add free `solo`.** `launch` becomes organization-only. A manager outside an org resolves baseline entitlements only. Backfill legacy paid manager rows to `solo`.                                                                                                                                                  |
| 3   | Is a personal plan portable inside an org?                          | **Yes, `personalPortable` keys only** (+ user-scope quotas). Never an org-scoped key or org capacity. This is the #971 contract.                                                                                                                                                                                         |
| 4   | Can a seat lower a limit?                                           | **No — `max(org, seat, personal)`, `-1` short-circuits.** A seat is an upgrade; it may never downgrade a member.                                                                                                                                                                                                         |
| 5   | Can a role allocate entitlements?                                   | **Not in v1.** Ship `org_roles.entitlement_profile` (`all \| learner \| none`); the allocation table and UI follow as a separate PR. Permissions are never allocatable by a role.                                                                                                                                        |
| 6   | Do teacher/member system roles inherit the org entitlement ceiling? | **Teacher `all`, Member `learner`, Custom `none`.** `learner` is the fixed `LEARNER_ENTITLEMENTS` set, intersected with the org ceiling.                                                                                                                                                                                 |
| 7   | Can a teacher invite students without `org.invitation.manage`?      | **Yes, via `group.invite` at group scope, existing org members only in v1.** External invites are a later phase. The `can_assign_org_role` teacher-name exception is deleted.                                                                                                                                            |
| 8   | Can a flag remove a paid entitlement?                               | **Kill switch only: `is_enabled = false`, with an audit row.** No rollout percentage, no row deletion, missing row fails closed.                                                                                                                                                                                         |
| 9   | Are `flashcards`/`quiz` entitlements?                               | **Baseline, always on.** Present in the catalog for pricing display, never used as a gate; only their quotas apply.                                                                                                                                                                                                      |
| 10  | Do we rename `account_type` to `account_kind`?                      | **Defer the rename.** Change the semantics now (nothing authorizes on it); keep the column and type name. The mechanical rename is separate.                                                                                                                                                                             |
| 11  | What is the FP-03 content-RLS posture?                              | **Control-plane RLS only in this programme.** Content stays a tenant floor; service-role content access + revoked grants is a separate security ADR before launch.                                                                                                                                                       |
| 12  | Do entitlement overrides bypass flags?                              | **Yes.** A comp/trial account is a deliberate grant and is never switched off by a flag.                                                                                                                                                                                                                                 |
| 13  | Can a `student` persona hold the Admin role?                        | **Yes, if the org assigns it.** Authorization follows the role. A restriction, if product ever wants one, is a role-assignment policy — never a check inside each endpoint.                                                                                                                                              |
| 14  | Does persona gate personal plan purchases?                          | **No — `audience` is a UI filter only.** Once permissions leave `plan_entitlements`, any persona may buy any personal plan.                                                                                                                                                                                              |
| 15  | Does an org plan include seat licences?                             | **No — org plans grant ZERO licences; licences are sold separately.** A licence is the purchased unit: `org_seat_pools` is the licence pool (its `plan_key` must be `scope='personal'` + `seatEligible`), and `org_seat_assignments` is one member occupying one licence. No `plan_seat_grants`, no `org_seat_licenses`. |

> **2026-11-20 (D25).** `GET /organization/members` is readable by a caller
> holding **any** of `org.member.manage` (org scope), `group.manage`,
> `group.invite` or `org.seat.manage` (any scope) in the active org. The catalog
> has no `org.member.read`; a Teacher must not hold `org.member.manage`
> (D18/FP-04); the roster is shared by org managers, class managers and class
> inviters (`/edu/classroom/members`, the assignment student picker, the `/edu`
> onboarding counts); and the shipped **Billing** preset
> (`org.billing.manage` + `org.seat.manage`) fills `/manage/seats`' assign dialog
> from the same endpoint. A caller with none of the four gets `200` with
> `data: []` — the empty list is the deny shape because it leaks nothing and
> AUT-19 accepts it. `PUT`/`DELETE` stay `org.member.manage`, so the Billing
> preset reads the roster and writes nothing on members, roles, settings or
> invitations. D16–D24 are recorded in the sections they amend (§4.1, §4.2, §5);
> this one is here because it settles a read the §7.1 note had got wrong.

> **2026-11-21 (D26).** An **active** `user_feature_overrides` row (no expiry, or
> `expires_at` in the future) is the final word on its key in **both**
> directions: an `is_enabled = false` flag never cuts an override-granted key,
> and an override revoke stays revoked even when the flag is on. This makes D12
> explicit and corrects §6.1's pseudocode order — the flag pass skips keys an
> active override owns. (Phase 3a, `feat/authority-3a`.)

> **2026-11-21 (D27).** Per-role `org_role_features` revokes
> (`is_enabled = false`) have no product surface in v1: nothing in the app
> writes them once `change_org_plan` replaces `apply_org_plan` (3c). The
> resolver keeps reading them until phase 7 (D19); the writer is deleted in
> 3c, so in v1 a revoke row can only be inserted by hand. (Phase 3a,
> `feat/authority-3a`.)

> **2026-11-21 (D28).** `/me/plan` may show the **effective union** (org +
> personal/seat, e.g. "Hub (org) + Pro (personal)") from phase 3 — the resolver
> returns it as `plan: { primary, sources[] }`. The `PlanInfo` envelope stays
> stable (no field renamed or removed) until phase 6 renames the endpoint, so
> 3a does not change `/me/plan` itself. (Phase 3a, `feat/authority-3a`.)

> **2026-11-21 (D29).** Teacher content reads move to `group` scope, writes stay
> `own`, and `assignment.read` moves with the other content reads — the §4.2
> "own/group" reading, since `group` is a superset of `own` in the API layer.
> **Landed in 3d** on `feat/authority-3d`: the `SYSTEM_ROLE_TEMPLATES.teacher`
> arm, the `seed_system_role_permissions` teacher `CASE`, a backfill for existing
> system Teacher rows (the seed's `on conflict do nothing` never rewrites them)
> and a closing guard pinning reads `group` / writes `own`. (Phase 3a,
> `feat/authority-3a`; landed in 3d.)
>
> **2026-11-21 (D30).** Phase 3b lands the limits composition in the single
> resolver: `max(org, seat, personal)` for `scope:'user'` keys with `-1`
> short-circuit, the verified org's plan for `scope:'org'` keys, missing
> `plan_limits` row = `0`. Membership is verified before the seat plan is
> consulted, closing the 3a review's deferred note (a forged `active_org_id`
> plus a stale seat row now yields the personal values, never the seat's).
> `/me/plan` keeps `PlanInfo.key`'s historical value and reports the effective
> `features`/`limits` plus the additive union `sources` (D28). Decision:
> `/api/v1/ai/usage`'s `plan` field now reports the effective primary
> (`resolveEntitlements().plan.primary`, org first) instead of the personal
> plan key — inventoried first: no web component reads `usage.plan` (the badge
> renders only `current`/`limit`) and no QA case asserts it (SEC-07 matches
> `current`/`limit` only; MGR-SEAT-02 reads `limit`), so the widened meaning
> is safe. (Phase 3b, `feat/authority-3b`.)
>
> **2026-11-22 (D31).** The org plan is the only org entitlement state.
> `org_role_features` is revokes-only and its grant rows are deleted;
> `apply_org_plan` becomes `change_org_plan`, which moves
> `organizations.plan` and nothing else; `handle_new_organization` seeds
> profiles, permissions and roles, never entitlement rows. The org layer
> resolves live (`plan_entitlements`/`plan_limits` plus
> `org_roles.entitlement_profile`), so a plan-change snapshot could only drift.
> The RLS twin `has_org_feature` loses every row-existence gate (an enabled row
> is inert in both readers) and composes profile − revokes + seat ∩ ceiling,
> with the revoke subtraction inside the profile arm, so a seat key — which runs
> after the revokes — re-adds a revoked one. Its
> `(is_system AND name = 'admin')` wildcard is the one deliberate divergence
> from the resolver (which has no admin branch; admin is profile `all` ∩
> ceiling) and stays until phase 5 owns the alignment. A row-existence predicate
> flips meaning when a table flips polarity (R34). `is_enabled` keeps its
> `true` default: an enabled row is inert, so an accidental insert changes
> nothing while a `false` default would silently revoke its key.
> (Phase 3c, `feat/authority-3c`.)

> **2026-11-23 (D35).** With **no active org**, any authenticated caller
> resolves the personal-content key set at `own`: the 20 content CRUD keys of
> `deck`/`flashcard`/`topic`/`question`/`question_bank`, the three assignment
> verbs a personal (`organization_id` NULL) row supports — `read`, `update`,
> `delete` — plus `stats.read` = **24 keys** (`PERSONAL_PERMISSION_KEYS`,
> `@studiq/authz`). `quiz.*` and `assignment.create` are excluded because their
> services refuse a no-org call; `assignment.publish`/`grade` are excluded
> because the persona default this set replaces never granted them. Every
> `group.*`/`org.*` key stays denied. No `accountType` read remains in
> `resolveScope`; persona may seed provisioning (plan catalogue, default
> dashboard, org/class creator defaults) but never authorization. Inside an org
> the stored role row wins and no row denies, unchanged (§6.3).
>
> **Interim consequence:** until the per-user personal set lands (register row
> 14 in the phase plan: `user_permission_scopes` + `PERSONAL_ROLE_TEMPLATES` +
> a `withAuth` read when no org), a **manager with no org can create personal
> decks, flashcards, topics, questions and banks** — the set is the same for
> every persona. The same persona-free answer also resolves the
> `assignment.read/update/delete` trio at `own` for a no-org manager; that is
> author-only and unreachable for new rows (both layers refuse a no-org
> `assignment.create`), so it can only ever match a legacy personal row the
> same manager already authored. The product intent for a manager is "may edit,
> may not create personal decks", which row 14 expresses per user rather than by
> persona.

> **2026-11-25 (D36).** CI does not regenerate or diff
> `packages/server/src/types/database.ts`. It types the schema, not catalog rows:
> a new entitlement key or plan row changes no type, so a diff gate would catch
> nothing the extendability checklist adds. It would also need the pinned CLI and
> a database in CI, and the pinned CLI cannot reproduce the committed file
> byte-for-byte, so a strict diff would be red on `main` for reasons unrelated to
> the PR. Catalog drift stays `catalog-invariants`' job, in both directions;
> schema changes keep the manual pinned-CLI regeneration, reviewed by the
> integrator. (Phase 8, `feat/authority-8`.)

> **2026-11-26 (B1, #1193; corrected by the plan cleanup).** One individual
> ladder supersedes D2, D14 and D32 where they make a personal plan's `audience`
> significant. `audience` no longer keys a ladder, a checkout, a seat pool or a
> free-plan fallback, and the cleanup dropped the column: a plan has a `scope`
> and nothing persona-shaped. The personal plans are Free / Plus / Pro / Max on
> the keys `free` / `plus` / `pro` / `max` (the cleanup renamed them from
> `base` / `spark` / `ace` / `pro`); `lite`, `guide`, `creator`, `master` and
> `solo` retire to `free`. Persona no longer filters a plan purchase: any
> **content subscriber** may buy any active personal plan. Authority is still
> the permission and entitlement layer, never the persona.
>
> A manager is not a content subscriber: ADR-0007 stands again. `handle_new_user()`
> mints `free` for a student or an educator and NULL for a manager;
> `profiles.personal_plan_key` is nullable; `resolveApplicablePlan` refuses a
> personal plan for `account_type = 'manager'`, and a manager buys only an
> organization plan for an organization where they hold `org.billing.manage`
> (the Admin role). The individual pricing and upgrade surfaces print no
> personal purchase or change action for a manager, and `/app` and `/edu`
> billing/upgrade send a manager to `/manage`.
>
> This retires D33's seat persona check: `assignSeat` no longer compares the
> target's `profiles.account_type` to the pool plan's `audience`, because a
> personal plan carries no audience. A seat pool is offered to any member of
> the organization; `addPool` still requires an active `scope='personal'` plan
> whose keys are all `seatEligible`.

> **2026-11-26 (B2, #1493).** The organization ladder is three **capacity-only**
> tiers: Launch (`launch`, 0 zł, 5 members / 3 groups), Hub (`hub`, 299 zł, 50 / 20) and Campus (`campus`, 699 zł, 1 000 / 100). `team` retires into `hub`: an
> organization on `team` is re-pointed to `hub`, so the entry price rises rather
> than the mid tier disappearing (premarket; no user data to preserve). Campus's
> `max_students`/`max_groups` `-1` becomes 1000/100; the per-member content caps
> are unchanged.
>
> Every organization plan now carries only the two baseline keys `flashcards` and
> `quiz`; `ai.chat`, `quiz.templates`, `stats.insights` and `branding` leave the
> plans. The baseline keys stay because they are `scope:'personal'` and not
> `personalPortable`: the personal layer does not carry them into an
> organization, so removing them would strip flashcards and quizzes from every
> org member and would need a resolver change. No organization plan carries
> `max_ai_tokens_per_day`; a missing row is 0.
>
> The interim for features is the personal plan: a member on `plus`/`pro`/`max`
> keeps `ai.chat`, `quiz.templates` and `stats.insights` inside an organization
> through `personalPortable`. Organization-funded AI and other per-seat licences
> are #1511, which depends on this shape; no organization entitlement returns
> before it.
>
> Seats are **frozen at the UI**: `/manage/seats` hides the purchase, assign and
> release entries while the pools and assignments tables and every `GET` stay.
> The API routes and their `org.seat.manage` authority checks remain the data
> path #1511 builds on. `seatEligible` keeps its derived meaning (a plan whose
> keys are all seat-eligible); it no longer means "a seat a manager can buy"
> until #1511. §14.2's "paid org (`hub`/`campus`)" column therefore reads as
> capacity, not a feature ceiling.

> **2026-11-27 (B2 amendment).** The organization ladder is four **purchasable**
> tiers again, differentiated on capacity and cumulative features: Launch
> (`launch`, 0 zł, 5 members / 3 groups, `flashcards` + `quiz`), Team (`team`,
> 99 zł, 25 / 10, adds `quiz.templates`), Hub (`hub`, 299 zł, 100 / 40, adds
> `stats.insights`) and Campus (`campus`, 699 zł, 1 000 / 100, adds `branding`).
> Campus checks out like every other tier; custom setup (limits, SSO, invoicing,
> onboarding) is a **separate contact CTA**, not a plan and not a price.
>
> `team` returns as a new key, so the B2 fold is superseded; an organization
> already on `hub` or `campus` keeps its key and gains the new feature rows. The
> the matrix in `20261127090000_org_team_tier.sql` owns all eight plans and pins each
> tier's entitlement set and every limit (the four organization sets are cumulative).
> No organization plan carries `ai.chat` or
> `max_ai_tokens_per_day`: organization AI is still #1511. Seats stay frozen at
> the UI, and a seat pool still references a `scope='personal'` plan only — an
> organization tier is never a pool.

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
- `packages/authz/src/entitlements.ts`, `packages/authz/src/limits.ts`, `packages/server/src/services/entitlement.resolver.ts`, `seat.service.ts`, `org-role.service.ts` (the phase-3 `feature.resolver.ts` and `limits.resolver.ts` were deleted).
- `supabase/migrations/20261024124756_rls_all_public_tables.sql`, `20261024151122_drop_org_limits.sql`.
- Issue #971 (personal plan inside an org), #233 (limit precedence), #799 (stale entitlement cache).
