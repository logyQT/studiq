# Role-authority rollout — a PR queue into `main`

**Status:** In progress — phase 0 merged (#1162), 0b merged (#1387), 1a
merged (#1388), 1b merged (#1389), 1c merged (#1390) and **phase 2 merged**
(#1397–#1404, closed by 2b-9's deferral register and guard). Next: phase 3.
**Date:** 2026-11-13. Supersedes the 2026-10-31 integration-branch draft.
**Decision record:** [ADR-0015](../decisions/0015-role-based-authority.md)
**Evidence:** [audit §0](../audits/features-perms-weak-spots.md) (originally verified against `b4186312`; re-verified 2026-11-19 at `8aab828e`).
**Live status and memory:** [role-authority-plan.md](role-authority-plan.md)
**Orchestrator contract:** [role-authority-orchestrator.md](role-authority-orchestrator.md)

---

## 1. What changed, and why

The earlier draft built an integration branch (`exp/role-authority`), a
phase-gated conductor, and a separate exp stack, and forbade partial merges to
`main`. Thirteen days later it held 3,591 lines of docs and orchestration, **no
product code**, was **98 commits behind** `main`, had **never opened a phase
PR**, had **disabled the QA gate for its own PRs**, and its ADR number
(`0008`) had been taken by `main`. It also depended on a `scripts/exp` tool that
does not exist.

This version keeps the parts that were right — the ADR, the audit, vertical
slices, the QA corpus as the product gate — and drops the branch, the
conductor, the second environment and the flag. Each phase is a PR into `main`.

## 2. Principles

1. **Every phase is a PR into `main`.** No long-lived branch, no release
   branch, no integration branch.
2. **No runtime flag, no dual model, no compatibility layer.** Old and new
   never coexist in the tree. Rename/replace in place.
3. **A PR leaves `main` coherent and green.** Required checks plus the phase's
   QA shards. A phase that cannot keep a persona's core journey working is not
   ready.
4. **Vertical slices.** Schema, resolver, call sites, tests and docs land
   together. Large phases use stacked PRs on one short-lived branch; only the
   tip merges.
5. **One integrator.** Migrations, `packages/server/src/types/database.ts`,
   `supabase/seeds/**`, `knip.ts` and `eslint-suppressions.json` have a single
   writer per phase.
6. **Migrations are forward-only.** A wrong shape gets a compensating
   migration, not an edit. Pre-market allows dropping the database between
   phases if a shape is genuinely wrong — that is the fallback, not the plan.
7. **When a rule lives in both layers, both change in the same PR.** FP-01 is
   exploitable through PostgREST; fixing only the API leaves the path open.
8. **The QA corpus and E2E are the product gate.** Unit and integration tests
   are implementation tests: rewrite them freely, keep the invariants that QA
   cannot see.

## 3. The queue

| Phase  | PR                                                                                                   | Closes                                                         | QA shards                         | Depends |
| ------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- | ------- |
| **0**  | `docs(authority)`: audit + ADR-0015 + this plan + the ledger + the orchestrator contract             | — (FP-03 deferred, D11)                                        | `checks`                          | —       |
| **0b** | `chore(authority)`: batch-0 cleanup; existing orgs unchanged, new orgs get the corrected catalog     | N1 (catalog rows + guard), part of FP-20                       | `checks`, `unit`, `integration`   | 0       |
| **1**  | `refactor(catalog)`: one entitlement catalog, one permission catalog, plan scope                     | FP-06, FP-13, FP-19, rest of FP-20                             | `PUB`, `test:admin`, `LIM`, `BIL` | 0b      |
| **2**  | `feat(authority)`: role permissions, group scopes, route gates, control-plane RLS                    | FP-01, FP-04, FP-09, FP-11 (control plane), FP-21, N1 backfill | `AUT`, `MGR`, `EDU`, `SEC`        | 1       |
| **3**  | `feat(entitlements)`: one resolver, entitlement profiles, `max` limits, fail-closed flags            | FP-07, FP-08, FP-12, FP-15, FP-16                              | `LIM`, `BIL`, `STU`               | 2       |
| **4**  | `feat(seats)`: plan scope, `solo`, licences, audience                                                | FP-02, FP-05, FP-14, N3                                        | `MGR`, `BIL`, `LIM`               | 3       |
| **5**  | `feat(enforcement)`: `requireEntitlement` / `requirePermission` on every paid and management surface | FP-10, FP-22                                                   | `STU`, `EDU`, `MGR`, `PUB`        | 2, 3    |
| **6**  | `feat(ui)`: `/me/entitlements`, `/me/permissions`, permission nav, org-keyed cache                   | FP-17                                                          | `PUB`, `AUT`, `MGR`, `STU`, `EDU` | 2, 3, 5 |
| **7**  | `chore(authority)`: delete the legacy surface, full QA + E2E                                         | FP-18, FP-11                                                   | **all 188** + E2E                 | 1–6     |
| **8**  | `docs(authority)`: extendability audit (post-phase-7 release gate)                                   | — (release gate, D23)                                          | **all 188** + E2E                 | 7       |

Critical path: `0 → 0b → 1 → 2 → 3 → {4, 5} → 6 → 7 → 8`. Phases 4 and 5 may
start once 3 is in; 6 merges after 5. Phase 2 is the largest and should be a
stack of 2–3 PRs (permission catalog seeding; route gates; control-plane RLS)
merged as one tip. Phase 8 depends on 7 and gates 7's close (D23): 7's deletion
work merges first, then the audit proves the model is extendable before the
programme is called done.

## 4. QA map — the 37 at-risk specs

Verified against the corpus, not guessed. The other 139 **spec files** are
model-neutral and only need the seeder to keep working. (The corpus has two
counts: 176 spec files — 170 distinct cases plus 6 temporary re-runs — and 188
case documents, 18 of which have no spec yet.)

| Case        | Asserts today                                                                       | Required change                                                                                                                                                                                            | Phase |
| ----------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| AUT-07      | persona landing dashboards; nav excludes plan-gated items                           | shell follows the active org's permissions                                                                                                                                                                 | 6     |
| AUT-11      | `/login`, `/register` redirect by JWT `account_type`                                | redirect from role/active org                                                                                                                                                                              | 6     |
| AUT-16      | student 3xx off `/edu`, `/manage`, `/setup`                                         | **API half shipped in 2b-6** (`403`, empty roster, D25); the **redirect half is phase 6**: area routes are auth-only (the page loads, the API is the boundary), only the `/setup` pair stays persona-gated | 2 → 6 |
| AUT-17      | teacher 3xx off `/app`, `/manage`                                                   | same: area routes load, `/setup/org` stays manager-only                                                                                                                                                    | 2 → 6 |
| AUT-18      | manager 3xx off `/app`, `/edu`                                                      | role-derived shell                                                                                                                                                                                         | 6     |
| AUT-19      | student 403 on `/teacher/*`, `/organization/members`                                | permission check replaces account-type gate                                                                                                                                                                | 2     |
| BIL-01      | `/me/plan` = one plan key with `features[]` + `limits{}`                            | effective plan union + one contract                                                                                                                                                                        | 3     |
| BIL-04      | checkout re-syncs snapshots, lifts branding/builder locks                           | profiles + atomic plan change (endpoint rename in 6)                                                                                                                                                       | 3 → 6 |
| BIL-05      | 403 when `for_account_type` ≠ caller                                                | `scope`/`audience`; audience is a filter                                                                                                                                                                   | 4     |
| EDU-02      | sidebar from `/features/me`; `group.manage` per role                                | `group.manage` permission from `group_members.role`                                                                                                                                                        | 2     |
| EDU-GRP-01  | „Nowa grupa” shown from the role's feature snapshot                                 | group-scope permission                                                                                                                                                                                     | 2     |
| EDU-GRP-03  | colleague's group locked by `created_by`                                            | teacher of the group may manage it                                                                                                                                                                         | 2     |
| EDU-GRP-04  | plan-limited group creation                                                         | permission gate; org capacity unchanged                                                                                                                                                                    | 2     |
| EDU-GRP-05  | no `group.manage` → nav hidden, writes 403                                          | permission denial; `group.read` still renders the list                                                                                                                                                     | 2     |
| EDU-DECK-03 | group picker lists taught groups                                                    | group-scope read keyed on group role                                                                                                                                                                       | 2     |
| EDU-REP-01  | educator inbox = own questions                                                      | org inbox = `org.report.manage`; teacher inbox own/group                                                                                                                                                   | 2     |
| LIM-05      | branding 403 after Hub→Launch; admin role "has branding"                            | `org.settings.manage` **and** `branding` entitlement                                                                                                                                                       | 3     |
| MGR-01      | teacher/student counters derived from role name                                     | `org.member.manage`; custom roles break role-name classification                                                                                                                                           | 2     |
| MGR-02      | manager menu lacks the AI entry; chat admits student/educator                       | manager AI via entitlement                                                                                                                                                                                 | 5     |
| MGR-ACC-01  | manager „Wybierz plan” + `/me/plan` agreement                                       | `solo`; effective-plan display                                                                                                                                                                             | 4     |
| MGR-ROL-01  | Launch lacks `role.builder`; locked card + 403                                      | Launch admin writes via `org.role.manage`; a member without it is 403                                                                                                                                      | 2     |
| MGR-ROL-02  | role CRUD gated by `role.builder` on Hub                                            | `org.role.manage`; closed catalog                                                                                                                                                                          | 2     |
| MGR-ROL-03  | 20 free-string scopes across 5 sections, live scope swap                            | closed catalog (44 keys, 10 sections); complete payload; no-escalation guard                                                                                                                               | 2     |
| MGR-ROL-04  | system-role delete 403; role with members undeletable                               | same guards under `org.role.manage`                                                                                                                                                                        | 2     |
| MGR-SEAT-01 | pool creation validates only the quantity floor                                     | validate the pool's `plan_key` (`scope='personal'`, `seatEligible`)                                                                                                                                        | 4     |
| MGR-SEAT-02 | role-name tier matrix; seat plan = effective plan; 3 keys withheld; AI limit = seat | audience tier; seat ∩ ceiling; `max(org, seat, personal)`; no permissions                                                                                                                                  | 4     |
| MGR-SEAT-03 | releasing a seat returns the member to base                                         | effective plan union + `max` limits                                                                                                                                                                        | 4     |
| MGR-SET-01  | Launch branding lock; rename unaffected                                             | entitlement + `org.settings.manage` for rename too                                                                                                                                                         | 3     |
| MGR-SET-02  | upserts `org_role_features` to grant branding                                       | fixture `apply_org_plan(org, 'hub')`; Admin profile `all` ∩ plan ceiling                                                                                                                                   | 2a-1  |
| MGR-SET-05  | downgrade hides the logo; `/features/me` drops branding                             | `change_org_plan`; endpoint rename in 6                                                                                                                                                                    | 3 → 6 |
| ONB-07      | org switch keeps `/edu`; active-org content only                                    | shell follows the active org; org-keyed cache                                                                                                                                                              | 6     |
| PUB-02      | `/features` sells „Zarządzanie Organizacją”, „Masowe Zaproszenia”                   | none — the spec asserts structure, not plan contents                                                                                                                                                       | —     |
| PUB-03      | `?for=manager` → launch/team/hub/campus                                             | manager personal = `solo`; scope/audience                                                                                                                                                                  | 4     |
| PUB-04      | plan cards render `features[]` incl. „Zarządzanie Grupami”                          | none — the cards derive from the API                                                                                                                                                                       | —     |
| SEC-05      | student 403 on `/teacher/*` writes and teacher stats                                | own-scope content permissions                                                                                                                                                                              | 2     |
| SEC-06      | student+teacher 403 on member/role writes; manager needs both keys                  | `org.member.manage` / `org.role.manage`                                                                                                                                                                    | 2     |
| STU-03      | sidebar from `/features/me`; member role grants flashcards/quiz/documents           | `/me/entitlements`; `learner` profile without `documents`                                                                                                                                                  | 3 → 6 |

Corrections to the older guess list, recorded so they are not re-litigated:
`LIM-02..04` are personal caps / a personal upgrade / org-scope capacity, not
org precedence or seat exclusivity; `MGR-MEM-*` assert no `member.manage`;
`SEC-04` is cross-org isolation; `AUT-15` is anonymous-only; `ADM-PLN/FLG/OVR`
do not exist in the QA corpus.

## 5. Phases

### 0 — docs and the ledger

Deliverables: the audit with §0, ADR-0015 (renumbered, §15 settled), this
plan, the ledger, the orchestrator contract. Nothing executable changes.
**Exit:** `checks` green; no code touched.

### 0b — batch-0 cleanup (existing orgs unchanged; new orgs get the corrected catalog)

- Add the missing `assignment.read` / `assignment.update` rows to the
  `permissions` catalog (N1). **DONE** (#1256) — and the same PR backfilled the
  system roles of existing orgs and redefined `handle_new_organization`, which
  this plan had deferred to phase 2. The catalog rows alone would not have
  changed behaviour; the seeded grants do, and `withAuth` reads them. No
  `org_role_permissions` sweep for the _deleted_ keys here: phase 2 does that
  with the `permission_key` foreign key.
- Add a unit guard that every **literal** permission key read through
  `permissionScopes['…']` or `resolveScope(ctx, '…')` exists in the catalog, so
  a phantom literal cannot recur. A key assembled at runtime is out of reach.
- Drop `resource_permissions`. The plan said its only reference was the
  generated type file; the identifier was also in the `99_dev_grants.sql`
  `REVOKE` list (which has no `IF EXISTS`, so the drop alone breaks `db reset`;
  that seed has since been retired) and the table carries its own RLS policy.
  Policy and grants fall with the table; the seed line was removed with the drop.
  The generated `database.ts` keeps a dead block: the pinned `supabase gen types`
  cannot reproduce the committed file (see R2), and nothing reads the block.
- Delete the dead `X-Feature-Rollout` header and its two comments.
- Add the catalog invariants as integration tests: permissions ∩ entitlements =
  ∅; `permissions` is exactly the `Permission` catalog (the N1 guard); every
  `FEATURES` key has a `feature_flags` row. The limit-key invariant is already
  **DONE** (#233, `plan-limit-catalog.test.ts`). The third assertion keeps
  asserting every `FEATURES` key until phase 1 adds `entitlement_catalog.category`
  and baseline keys stop needing a flag row.
- Delete the six entitlement keys from `permissions` (`study.*`, `test.*`,
  `ai.chat`, `org.manage`); `org_role_permissions` rows are swept in phase 2.
  Existing orgs keep their rows (and their resolution); newly created orgs stop
  receiving the six rows from `handle_new_organization`, so their `admin`/
  `teacher` roles carry 32 → 26 permissions and `member` 26 → 20.
- Freeze the key list: no new features or entitlement keys until phase 1.

**Exit:** `checks`, `unit`, `integration` green; existing orgs unchanged, newly
created orgs get the corrected catalog (6 fewer entitlement rows).

### 1 — catalog cutover

> **Delivered 2026-11-19, PR 1 of 2 (phase 1b, #1389).** The table renames, the
> `limit_catalog` and `entitlement_catalog` tables, the 44-key `PERMISSIONS`
> catalog and the `org_role_permissions` rewrite are merged and
> behaviour-neutral.
>
> **Delivered 2026-11-19, PR 2 of 2 (phase 1c, in PR).** `ENTITLEMENTS` is
> exported, `FEATURES`, `ADMIN_ONLY_FEATURES` and `ORG_SCOPED_FEATURES` are
> deleted (no alias), `LIMITS` lives in `@studiq/authz`, the admin/UI catalogs
> are cut over, and `documents` is excluded from `entitlement_catalog`,
> `entitlement_flags` and `plan_entitlements` until its surface ships. The four
> legacy management keys and everything reading them stay until phase 2
> (below).

- `@studiq/authz` exports `ENTITLEMENTS` and `PERMISSIONS` with metadata
  (`category`, `scope`, `seatEligible`, `personalPortable`, `quota`); `FEATURES`
  is deleted, not aliased.
- DB: `feature_flags` → `entitlement_flags`; `plan_features` →
  `plan_entitlements`; `permissions` contents replaced; `limit_catalog` added.
- Rewrite the live `org_role_permissions.permission_name` rows to the new keys in
  the same migration. Phase 2 puts a foreign key on that column; existing orgs'
  rows would otherwise block it.
- **The four management keys stay** in `ENTITLEMENTS` and `plan_entitlements`
  until phase 2: `requireFeature('role.builder' | 'member.manage' |
'group.manage')` and `is_org_manager()` still read them, and phase 2 is where
  those gates become permissions. `documents` is excluded from `ENTITLEMENTS`
  and `plan_entitlements` in phase 1c **until its surface ships** — there is
  nothing to gate today, and re-entry is data-only (ADR §5.1, open catalog).
- Update `__tests__/integration/catalog-invariants.test.ts` to the new names
  (`FEATURES` → `ENTITLEMENTS`, `feature_flags` → `entitlement_flags`); the
  `permissions` assertions stay.
- One catalog module feeds server, admin and tests; delete the duplicate
  `FEATURES` and the two denylists' copies.

**Exit:** admin reads the new catalog; `PUB`, `LIM`, `BIL` green and
`bun run test:admin` green. "No management key is purchasable" moves to phase 2
with the four legacy keys.

**Settled 2026-11-19 — two PRs.** PR1 (phase 1b) renames the tables, seeds and
readers and is behaviour-neutral; it also adds the two catalog tables and the
expanded permission catalog, because the renames and the catalog share one
migration. PR2 does the catalog cutover (~300 lines) and must keep the four
legacy management keys above. The generator cutover for
`packages/server/src/types/database.ts` (R2) rides with PR1.

**Prerequisite (phase 1a, separate PR):** regenerate
`packages/server/src/types/database.ts` with the pinned CLI first — the shape
cutover (no `graphql_public`, nullable RPC args as `?: T`,
`resource_permissions` gone) is what lets the typed call sites read the renamed
tables. It reflects only the current table names, so phase 1b regenerates the
file again after its `plan_features` → `plan_entitlements` and `feature_flags`
→ `entitlement_flags` rename.

### 2 — authority cutover (the largest; five slices) — **DONE 2026-11-21**

> **Delivered 2026-11-21, closed by 2b-9 (#1397–#1404).** Phase 2 is merged:
> the 2a slices and all nine 2b slices (2b-7 `f62b896d` #1403, 2b-8
> `9747f372` #1404) are on `main`, and 2b-9 shipped the closure — the
> deferral register (every remaining persona/role-name branch with a
> `file:line`, an owning phase and a reason) plus
> `__tests__/unit/guards/persona-gates.test.ts`, which pins that the only
> `allowedAccountTypes` on the API surface are the four declared exceptions
> (R5 org/classroom creation ×2, phase-5 `ai/*` ×2). Exit met: permission
> matrix tests, group-teacher tests, 403 vs 404, no persona gate on an org
> resource; `AUT`, `MGR`, `EDU`, `SEC` green. The live audit behind the
> closure: 0 policies referencing `has_org_feature`/`is_org_manager`, 0
> marker rows in the four entitlement tables, `permissions` = 44,
> `entitlement_catalog` = 6.

Split into five slices on one short-lived branch, each independently
reviewable. The slice list and shipped contents live in
[role-authority-plan.md §5](role-authority-plan.md#phase-2--authority).

**Landing order is 2a-1 → 2a-3 → 2a-2 → 2a-4 → 2a-5** (D24): the closed-catalog
editor ships before the `org.role.manage` gate moves, because the write that gate
guards replaces the role's whole permission set and the gate is one of those rows.

- **2a-1** (~750, `size:exception`) — `org_roles.entitlement_profile` (`all | learner | none`),
  the trigger/seed/backfill, the profile-driven `FeatureResolver` org layer and
  the `has_org_feature` zero-row fallback. Closes the RLS twin of FP-01 in the
  same PR (R4).
- **2a-3** (~400, `size:exception`) — closed-catalog editor, complete payload,
  audit log **first** (D24). Acceptance criterion (F3): a save through the role
  editor must not drop permission rows for keys the payload does not manage. The
  payload is the whole 44-key catalog and the editor renders every key, so "upsert
  the payload, prune everything it does not mention" can no longer strand a
  permission. A payload that is not the whole catalog is refused with a 422 at the
  controller (`SetRolePermissionsSchema`) and again at the service
  (`isCompleteCatalogPayload`), pinned by the model, controller and service unit
  tests, the integration no-op case and MGR-ROL-03.
- **2a-2** (~460, `size:exception`; 438 at review) — role templates (Assistant/Billing/Read-only/Blank presets),
  `requirePermission('org.role.manage')`, the editor gate and the RLS predicate
  (`rls_caller_has_permission` on the six role-write policies, R4); rewrites
  MGR-ROL-01 and deletes the out-of-map e2e `manage-roles-plan-gate`. Runs on the
  write path 2a-3 made safe. The `org.*` keys in a preset take effect when 2b
  replaces the legacy feature gates; the content keys are live now.
- **2a-4** (§ 59, `bun run pr:size`; planned as ~90) — **delivered.**
  `withAuth` builds `ctx.groupRoles` (`groupId → teacher | member`) beside
  `ctx.groupIds`, from one `group_members` read whose `groups!inner` embed is
  filtered on the active org. Closes the cross-org group union: a request scoped to
  org A never carries a group or a group role from org B, and both are empty with
  no active org (ADR-0015 §7.1). The planned "verified-org helper" was not needed —
  the existing `org_members`-backed `cookieOrgId` block is that helper. No
  migration. `groupIds` stays for every current reader. Consumed by 2a-5 (scope
  resolution) and 2b (group manage/invite are teacher-only).
- **2a-5** (**delivered**, 80, `bun run pr:size`; planned as ~110) — scope
  defaults: `own` only when there is no active org, only for a content key's
  `.read/.create/.update/.delete`, so a role that withholds a content key denies
  instead of granting; `group.*`/`org.*` never take the default. `Permission`
  grows to the full 44-key catalog (the controller maps it through
  `resolveScope`, so the payload cannot keep a second copy of the rule). Closing
  the in-org default can 403 content reads/writes a member's role does not
  grant — the QA swarms (STU, SEC-05/06, MGR-ROL-03) must expect no edits outside
  that set.

The phase-2b work, in slice order. **Phase 2b is nine slices**: all
nine have landed (2b-3 is the settled re-numbering of this list on
2026-11-20 — the org-control sweep moved ahead of the remaining RLS, and the
older labels are recorded in the [plan](role-authority-plan.md#phase-2b--authority-and-control-plane)).
The ledger's phase-2 row was `active` until the last slice below (2b-9) landed;
it is `merged` now (§1 of the [plan](role-authority-plan.md#1-status)).

- **2b-1 — `org_role_permissions.permission_key` FKs the permission catalog.
  Merged** (`6ec591dd`, #1397; slice 1 of 9): the column rename, the backfill
  before the constraint, the foreign key with the default RESTRICT behaviour, the
  scope CHECK narrowed to `own | group | organization`, the `plan_features_*`
  constraint names corrected, and `database.ts` regenerated. Deferred from 2a-2,
  whose scope was the gate, the RLS predicate and the presets — the FK needed the
  old free-text names backfilled first.
- **2b-2 — group permissions and their RLS twin. Merged** (`6b6554f2`, #1398;
  slice 2 of 9): `resolveGroupScope`/`canGroup`/`requireGroupPermission`
  give `group.read/manage/member.manage` their ADR-0015 §4.3 meaning
  (org scope → any group, `group` scope → the classes the caller **teaches**,
  `own` → the classes the caller **created**), create needs the key at **any**
  scope (the 2b-2 operator decision: a Teacher starts a class and becomes its
  teacher — §10), the
  four group route files drop `allowedAccountTypes`, the group UI gates create on
  `/permissions/me` and every per-row control on the API's `manageVia`, and
  `public.rls_caller_has_group_permission(group, key)` moves the six
  `groups`/`group_members` write policies in the same PR (R4). A Teacher-role
  holder reaches the classes it teaches (the seeded row is `group` scope); Admin
  holds the keys at `organization`. `group.invite` stays unused until 2b-5.
- **2b-3 — org-control route sweep and its RLS twin. Delivered** (slice 3 of 9)
  on `feat/authority-2b-3`: the settings, roster, seat and invitation routes drop
  `allowedAccountTypes` and gate on `org.settings.manage` / `org.seat.manage` /
  `org.invitation.manage` from the controller (`requirePermission`), while roles
  keep 2a-2's `org.role.manage` on writes and reads stay membership-only. The
  roster read is four authorities (D25): `org.member.manage`, `group.manage`,
  `group.invite` at any scope, or `org.seat.manage` (the shipped Billing preset's
  seat picker); everyone else reads an empty list, and `PUT`/`DELETE` stay
  `org.member.manage`. Branding keeps
  `org.settings.manage` **and** the `branding` entitlement.
  `public.rls_caller_has_permission` replaces
  `is_org_manager` on the same PR's policies: `organizations` update, `org_members`
  update/delete, `org_seat_pools` insert/update/delete, `org_seat_assignments`
  insert/update/delete plus the manager branch of its select, and `invitations`
  update/delete. The invitation INSERT keeps `can_assign_org_role` (2b-5 moves
  it with the invitation read).
- **2b-4 — the remaining control-plane RLS. Delivered** (slice 4 of 9) on
  `feat/authority-2b-4`: `billing_subscriptions`' org read moves to
  `org.billing.manage`; the assignment writes move to `assignment.update`
  (the UPDATE, the child tables' I/U and the child DELETE) and
  `assignment.delete` (the `teacher_assignments` DELETE) at `organization`
  scope, with the author branch covering `own`; the staff read of an
  assignment's item set becomes `assignment.read`; and `BillingService`
  requires `org.billing.manage` for the subscription actions (change-plan,
  cancel, release-scheduled-plan, reconcile, portal) instead of re-checking the
  system admin role. Composing a draft — its item set and its cohort,
  including replacing the cohort — is an update, because that is the key the
  service gates those paths on. The assignment INSERT persona and the
  org-wide SELECTs stay for 2b-6, and the checkout path keeps
  `resolveCheckoutOwner` (its org need not be the active one, and the resolver
  is shared with the mock-completion path). `can_assign_org_role` and the
  `invitations` SELECT stay for 2b-5: a write policy cannot move before the
  read it depends on (PostgREST refuses an UPDATE whose row the SELECT policy
  hides). `org_members` SELECT stays membership-wide — the audit names the
  readers a narrowing would empty (org detail, report inbox, role counts, the
  group roster, assignment target validation, teacher stats, and the request
  path itself in `with-auth.ts`), and phase 5 owns it. The billing **owner** is
  still persona-keyed (`ownerFromContext`), so a `student`/`educator` persona
  holding Admin or the Billing preset never reaches the gate; phase 5 owns the
  derivation.
- **2b-5 — class invites. Delivered** (slice 5 of 9) on `feat/authority-2b-5`:
  `invitations.group_id` + `target_group_role` (pair CHECK, index, group-org
  trigger), class invites use `group.invite` at group scope for existing org
  members (D7) via 2b-2's `rls_caller_has_group_permission`, the four
  `invitations` policies split by row shape (org invite →
  `org.invitation.manage`, class invite → `group.invite` on the group) with the
  SELECT moved together with the writes (R25 closed),
  `can_assign_org_role`'s manager half moved onto `org.invitation.manage` and
  its teacher-name exception deleted, and the accept RPC adds the invitee to
  the group with `target_group_role` (idempotent upsert) without touching an
  existing member's org role. `POST /organization/invites` takes the paired
  `groupId`/`groupRole`; the UI is phase 6 (no surface posts a group target
  today).
- **2b-6 — content-route sweep and the cross-package `authedRoute` adoption. Delivered**
  (slice 6 of 9) on `feat/authority-2b-6`: the 29 in-scope route files under
  `teacher/`, `stats/`, `flashcards/stats/teacher` and `questions/[id]/ledger` drop
  `allowedAccountTypes` and route through `authedRoute`/`authedRouteWithParams` with a
  declared `readsBody`; the controllers enforce the family key from the context before
  any schema parse (`quiz.*`, `assignment.*`, `stats.read`, `question_bank.update` on
  the ledger), the quiz service resolves the same key against the loaded parent row
  (foreign id 404, unreached same-org row 403) and the quiz list follows the caller's
  `quiz.read` scope. The `teacher_assignments` INSERT policy moves off the JWT persona
  onto `assignment.create` in the same PR (R4). R5 exceptions (`organization/route.ts`,
  `teacher/classrooms/route.ts`) and `ai/*` (2b-9) stay. QA corpus: SEC-05, AUT-19 and
  AUT-16 reconciled with the own-scope key model (spec + case text together).
- 2b-7 — marker deletion: `role.builder`, `org.manage`, `member.manage` and
  `group.manage` from `ENTITLEMENTS`, `entitlement_catalog`,
  `entitlement_flags`, `plan_entitlements` and `org_role_features`, in that
  order, plus the pricing copy and QA expectations that advertise them.
  **Merged** `f62b896d` (#1403; slice 7 of 9): one migration with a
  closing guard, the two typed-subset constants deleted with the catalog, the
  resolver's marker branches simplified (`all` = the ceiling, role rows
  revoke-only), and the R15 overlap pin in `catalog-invariants` retired —
  `group.manage` survives as a permission only, so the namespaces are disjoint.
- 2b-8 — the RLS half of the role editor guards: the last-`org.role.manage`
  holder, system roles protected, no self-edit, no grant beyond your own
  authority (the API half shipped in 2a-2/2a-3; RLS has none of it).
  **Merged** `9747f372` (#1404; slice 8 of 9).
- 2b-9 — **delivered** on `feat/authority-2b-9` (slice 9 of 9, the phase-2
  closure): no product code — the deferral register (every remaining
  persona/role-name branch with `file:line`, owning phase and reason; see the
  [plan](role-authority-plan.md#phase-2b--authority-and-control-plane)) plus
  the source-scan guard `__tests__/unit/guards/persona-gates.test.ts` pinning
  the four remaining `allowedAccountTypes` exceptions. The enforcement work
  itself (`ai/*` persona gates → `requireEntitlement`, and everything the
  register names to phase 5) stays phase 5's, below.

**Exit:** permission matrix tests; group-teacher tests; 403 vs 404; no persona
gate on an org resource; `AUT`, `MGR`, `EDU`, `SEC` green.

### 3 — entitlements and limits

**3a active on `feat/authority-3a` (2026-11-21):** the single resolver's
entitlement half (`resolveEntitlements(ctx)`, ctx-memoized), the dropped
rollout layer (kill-switch-only flags, missing row fails closed), D26's
override-beats-flag rule, the `personalPortable` whitelist, the seat ∩ ceiling
intersection and the quota-0 exclusion. **3b delivered on `feat/authority-3b`
(2026-11-21):** the limits composition moved into the same resolver —
`max(org, seat, personal)` for user scope, org plan for org scope, missing row
= 0, `-1` short-circuits, membership verified before the seat — batched to at
most seven queries per resolution; `LimitsResolver` deleted, its helpers are
wrappers in `services/limits.ts`; `/me/plan` shows the effective union with a
stable `key`. 3c (`change_org_plan`) and 3d (teacher reads) follow.

- `org_roles.entitlement_profile` (`all | learner | none`) ships in 2a-1
  (phase 2); phase 3 consumes it in the single resolver.
  `LEARNER_ENTITLEMENTS` lives in `@studiq/authz`.
- One `resolveEntitlements(ctx)` returning `{ entitlements, limits, sources,
plan }`; delete `FeatureResolver` and `LimitsResolver`.
- Limits: `max(org, seat, personal)` for user scope, org plan for org scope,
  missing row = 0, `-1` short-circuits; an entitlement whose quota is 0 is not
  effective.
- Flags: kill switch only, missing row fails closed; overrides accept
  entitlement keys only and bypass flags.
- `change_org_plan` replaces `apply_org_plan` (no `org.manage` exception,
  no snapshot).

**Exit:** truth tables for the four quadrants; custom role with `none` resolves
nothing; a `base` seat in a `hub` org keeps the org budget — `ai.chat` on with
the hub allowance, never 0 tokens — and is off only when the profile is `none`;
`LIM`, `BIL`, `STU` green.

### 4 — seats and personal plans

> **4a delivered 2026-11-22 on `feat/authority-4a` (D32–D34).** Plan
> scope/audience shipped (`for_account_type` dropped), `solo` is the free
> manager personal plan, `profiles.account_type` exists, pool creation
> validates the licence against the live catalog, seat assignment checks the
> target's persona against the plan `audience`, and plan composition keys on
> scope/`org.billing.manage` instead of the caller's persona. The seats page
> behaviour/UX and the QA case-text rewrite are phase 4b (next agent); see the
> [plan's phase-4 block](role-authority-plan.md#phase-4--seats-and-personal).

- `subscription_plans.scope` + `audience`; add `solo`; `launch` becomes
  organization-only; backfill legacy manager personal plans.
- `org_seat_pools.plan_key` FK. The pool **is** the licence record (D15): an org
  plan grants zero licences, so there is no `plan_seat_grants` and no
  `org_seat_licenses`; one `org_seat_assignments` row is one member occupying
  one licence.
- `addPool` validates the licence; `assignSeat` validates `audience`, not role
  names; seats intersect the ceiling, never grant permissions, never touch org
  capacity, never lower a limit.
- Revalidate or release the seat on role change and invitation accept (N3): a
  seat must not outlive the tier it was assigned under.

**Exit:** seat/licence invariants; `solo`; `MGR`, `BIL`, `LIM` green.

### 5 — enforcement closure

> **2026-11-21 (2b-9): work from the deferral register, not from this list.**
> The [plan's phase-2b block](role-authority-plan.md#phase-2b--authority-and-control-plane)
> now carries the register: every remaining persona/role-name branch that
> still decides authority — the `ai/chat` + `ai/usage` route gates, the
> `org_members` and org-wide `teacher_assignments` SELECTs, the
> `quiz_attempts`/`exposure_events` staff branches, the teacher-dashboard
> RPCs, the billing owner and checkout resolver, org delete via
> `rls_caller_is_org_manager`, `can_assign_org_role`'s §4.4 gap, the seal, the
> report inbox, the 403-vs-404 per-service asymmetry, the null-org assignment
> create — each with `file:line`, its owning phase (3/4/5) and why it is not
> authority-modelled yet. Phase 5 closes them from that register;
> `persona-gates.test.ts` keeps the route-layer half honest meanwhile (the
> only `allowedAccountTypes` on the API surface are the four declared
> exceptions: R5 org/classroom creation ×2 and this phase's `ai/*` ×2).

- `requireEntitlement` on AI, the saved-quiz library, the diagnostic stats;
  `documents` is excluded from the catalog and plans **until its surface ships**
  — there is nothing to gate today, and re-entry is data-only (ADR §5.1, open
  catalog). **2026-11-23 (phase 5d):** shipped as `ai.chat`, `quiz.templates`
  (the `/api/v1/teacher/quizzes` library writes; reads and the ad-hoc
  assignment path stay open) and `stats.insights` (the diagnostic stats reads;
  the descriptive ones stay free) — the keys were renamed from `quiz.builder` /
  `advanced.stats` in the same slice.
- Branding write = `org.settings.manage` **and** the `branding` entitlement.
- `requirePermission` on members, roles, seats, billing, invitations, settings,
  groups — replacing the remaining four mechanisms.
- No `allowedAccountTypes` on a product or org-management API beyond the four
  declared exceptions (pinned by the guard above).

**Exit:** enforcement matrix (one API status per key); no UI-only gate;
`STU`, `EDU`, `MGR`, `PUB` green.

### 6 — UI and cache

- `/features/me` → `/me/entitlements`; `/permissions/me` → `/me/permissions`;
  every consumer updated, no alias.
- Nav from permissions; shell from the active org's role; query keys include
  the active org and invalidate on checkout, seat, role, plan and flag change;
  refetch on focus within 60 s.
- Role editor reads the closed catalog; `/me/plan` shows the effective union.

**Exit:** UI and API agree; org switch is atomic; `PUB`, `AUT`, `MGR`, `STU`,
`EDU` green.

### 7 — delete and close

- Delete `FEATURES`, `ADMIN_ONLY_FEATURES`, `ORG_SCOPED_FEATURES`,
  `org_role_features`, `has_org_feature`, the old resolvers, the dead keys and
  headers, and the `assignment.*` decision (mapped or deleted).
- Atomic token accounting (`reserve_ai_tokens`) with a DB-recorded increment;
  the pre-stream `getUsage` gate is the enforcement.
- Rewrite `docs/limits.md`; close every difficulty entry in the ledger.
- Full QA (188) + E2E on a disposable stack; grep gate for `AUTHORITY_MODEL`,
  `legacyOnly`, `nextOnly`, `shadow`, `org_role_features`, `has_org_feature`,
  `FEATURES`, `org.manage`.

### 8 — extendability audit (post-phase-7 release gate)

**Normative. Phase 7 is not closed until this audit passes (D23).** Run it on a
disposable stack with the app served and with existing orgs and users — not in a
unit test.

1. **Live-app simulation.** Add a not-yet-shipped entitlement end-to-end: use
   `documents` (the roadmap key) or a fictional `voice.notes` if `documents`
   muddies the sign-off. Record every step: catalog row (DB + TS constant), flag
   row, `plan_entitlements` for named plans, admin-panel visibility,
   `/me/entitlements` exposure, one `requireEntitlement` call at a real surface,
   i18n copy, QA tenant seeding. Record **files touched, migrations and
   deploy/restart steps**. Target: **one migration + one catalog constant + one
   surface call**, zero resolver change.
2. **Both org vintages.** A fresh org and an org created before the key existed
   resolve it identically once they are on a plan that carries it; a plan change
   on the existing org backfills without a prune job.
3. **No surface breakage.** No endpoint or response field renamed; existing keys'
   order and values unchanged; the 37 at-risk QA cases plus the shard covering
   the surface stay green; `/me/entitlements` and enforcement agree.
4. **Removal/retirement.** Remove the key from a plan while a user is entitled:
   the ceiling narrows, the cache is invalidated, the UI hides it, and no
   endpoint 404s or 500s. Retire the key data-only, keeping the catalogue row
   until no plan references it. `documents` is the model: absent until shipped,
   re-entry data-only (D22).
5. **Drift detection.** Confirm CI fails when the TS catalog and the DB catalog
   disagree (`catalog-invariants`). Decide and record whether a CI step should
   regenerate/diff `database.ts` (the phase-1a review noted there is none); do
   not leave it implicit.
6. **Deliverable.** An "adding an entitlement" and a "retiring an entitlement"
   checklist in ADR-0015 (or `docs/plans/extendability.md`, linked from the ADR),
   each step naming the file/table and whether it is code, data or both. Any step
   that forces a code change for a data change is a defect with an owner.
7. **Acceptance.** Phase 7's close is gated on this audit passing. A failing
   audit opens a phase-8 PR with the fixes; it is never a note.

**Exit:** the checklist is committed; the live simulation recorded one migration,
one catalog constant and one surface call, with zero resolver changes; both org
vintages and the full 188-case suite + E2E are green.

## 6. Gates

Per PR: required checks green; phase QA shards green with 5/5 runs on every
changed case; no `test.skip`/`fixme` for a model difference; QA case text, spec
and `qa/coverage.md` updated together; ledger updated in the same PR; the FP
ids named in the description; migrations reviewed by the integrator.

Phase 7 only: full 188-case suite + E2E on a clean reset, and the grep gate.

Phase 8 (after 7): the extendability audit passes on a live app; a failing audit
is a phase-8 PR with the fixes, not a note.

## 7. Risks

| Risk                                             | Mitigation                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Phase 2 is large and touches 49 route files      | Five slices; land the permission catalog first; the integrator rebases daily         |
| Intermediate behaviour looks wrong to a reviewer | Each phase states the capability it preserves; QA shards are the proof               |
| A migration lands wrong                          | Compensating migration; premarket allows dropping and replaying the chain            |
| Test churn hides a regression                    | QA is the gate; changed cases show before/after                                      |
| Two lanes collide on shared files                | Ledger rules; integrator owns migrations, generated types, seeds, knip, suppressions |
| Scope creep into content RLS (FP-03)             | Explicitly out; separate security ADR before launch                                  |
