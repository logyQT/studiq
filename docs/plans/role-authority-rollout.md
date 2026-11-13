# Role-authority rollout — a PR queue into `main`

**Status:** Planned, not started.
**Date:** 2026-11-13. Supersedes the 2026-10-31 integration-branch draft.
**Decision record:** [ADR-0015](../decisions/0015-role-based-authority.md)
**Evidence:** [audit §0](../audits/features-perms-weak-spots.md) (re-verified against `origin/main` `b4186312`).
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

| Phase  | PR                                                                                                   | Closes                                    | QA shards                         | Depends |
| ------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------- | ------- |
| **0**  | `docs(authority)`: audit + ADR-0015 + this plan + the ledger + the orchestrator contract             | —                                         | `checks`                          | —       |
| **0b** | `chore(authority)`: batch-0 cleanup, zero behaviour change                                           | N1, part of FP-20                         | `checks`, `unit`, `integration`   | 0       |
| **1**  | `refactor(catalog)`: one entitlement catalog, one permission catalog, plan scope                     | FP-06, FP-13, FP-19, rest of FP-20        | `PUB`, `ADM`, `LIM`, `BIL`        | 0b      |
| **2**  | `feat(authority)`: role permissions, group scopes, route gates, control-plane RLS                    | FP-01, FP-04, FP-09, FP-21, part of FP-11 | `AUT`, `MGR`, `EDU`, `SEC`        | 1       |
| **3**  | `feat(entitlements)`: one resolver, entitlement profiles, `max` limits, fail-closed flags            | FP-07, FP-08, FP-12, FP-15, FP-16         | `LIM`, `BIL`, `STU`               | 2       |
| **4**  | `feat(seats)`: plan scope, `solo`, licences, audience                                                | FP-02, FP-05, FP-14                       | `MGR`, `BIL`, `LIM`               | 3       |
| **5**  | `feat(enforcement)`: `requireEntitlement` / `requirePermission` on every paid and management surface | FP-10, FP-22                              | `STU`, `EDU`, `MGR`, `PUB`        | 2, 3    |
| **6**  | `feat(ui)`: `/me/entitlements`, `/me/permissions`, permission nav, org-keyed cache                   | FP-17                                     | `PUB`, `AUT`, `MGR`, `STU`, `EDU` | 2, 3, 5 |
| **7**  | `chore(authority)`: delete the legacy surface, full QA + E2E                                         | FP-18, FP-11                              | **all 188** + E2E                 | 1–6     |

Critical path: `0 → 0b → 1 → 2 → 3 → 7`. Phases 4 and 5 may start once 3 is in;
6 merges after 5. Phase 2 is the largest and should be a stack of 2–3 PRs
(permission catalog seeding; route gates; control-plane RLS) merged as one tip.

## 4. QA map — the 37 at-risk specs

Verified against the corpus, not guessed. The other 139 specs are model-neutral
and only need the seeder to keep working.

| Case        | Asserts today                                                                       | Required change                                                           | Phase |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----- |
| AUT-07      | persona landing dashboards; nav excludes plan-gated items                           | shell follows the active org's permissions                                | 6     |
| AUT-11      | `/login`, `/register` redirect by JWT `account_type`                                | redirect from role/active org                                             | 6     |
| AUT-16      | student 3xx off `/edu`, `/manage`, `/setup`                                         | no persona gate on org routes; permission 403                             | 2     |
| AUT-17      | teacher 3xx off `/app`, `/manage`                                                   | same                                                                      | 2     |
| AUT-18      | manager 3xx off `/app`, `/edu`                                                      | role-derived shell                                                        | 6     |
| AUT-19      | student 403 on `/teacher/*`, `/organization/members`                                | permission check replaces account-type gate                               | 2     |
| BIL-01      | `/me/plan` = one plan key with `features[]` + `limits{}`                            | effective plan union + one contract                                       | 3     |
| BIL-04      | checkout re-syncs snapshots, lifts branding/builder locks                           | profiles + `/me/entitlements`; atomic plan change                         | 3     |
| BIL-05      | 403 when `for_account_type` ≠ caller                                                | `scope`/`audience`; audience is a filter                                  | 4     |
| EDU-02      | sidebar from `/features/me`; `group.manage` per role                                | `group.manage` permission from `group_members.role`                       | 2     |
| EDU-GRP-01  | „Nowa grupa” shown from the role's feature snapshot                                 | group-scope permission                                                    | 2     |
| EDU-GRP-03  | colleague's group locked by `created_by`                                            | teacher of the group may manage it                                        | 2     |
| EDU-GRP-04  | plan-limited group creation                                                         | permission gate; org capacity unchanged                                   | 2     |
| EDU-GRP-05  | no `group.manage` → nav hidden, writes 403                                          | permission denial; `group.read` still renders the list                    | 2     |
| EDU-DECK-03 | group picker lists taught groups                                                    | group-scope read keyed on group role                                      | 2     |
| EDU-REP-01  | educator inbox = own questions                                                      | org inbox = `org.report.manage`; teacher inbox own/group                  | 2     |
| LIM-05      | branding 403 after Hub→Launch; admin role "has branding"                            | `org.settings.manage` **and** `branding` entitlement                      | 3     |
| MGR-01      | teacher/student counters derived from role name                                     | `org.member.manage`; custom roles break role-name classification          | 2     |
| MGR-02      | manager menu lacks the AI entry; chat admits student/educator                       | manager AI via entitlement                                                | 5     |
| MGR-ACC-01  | manager „Wybierz plan” + `/me/plan` agreement                                       | `solo`; effective-plan display                                            | 4     |
| MGR-ROL-01  | Launch lacks `role.builder`; locked card + 403                                      | `org.role.manage` permission                                              | 2     |
| MGR-ROL-02  | role CRUD gated by `role.builder` on Hub                                            | `org.role.manage`; closed catalog                                         | 2     |
| MGR-ROL-03  | 20 free-string scopes across 5 sections, live scope swap                            | catalog rename; group scope; no-escalation guard                          | 2     |
| MGR-ROL-04  | system-role delete 403; role with members undeletable                               | same guards under `org.role.manage`                                       | 2     |
| MGR-SEAT-01 | pool creation validates only the quantity floor                                     | validate `org_seat_licenses`, `scope='personal'`, `seatEligible`          | 4     |
| MGR-SEAT-02 | role-name tier matrix; seat plan = effective plan; 3 keys withheld; AI limit = seat | audience tier; seat ∩ ceiling; `max(org, seat, personal)`; no permissions | 4     |
| MGR-SEAT-03 | releasing a seat returns the member to base                                         | effective plan union + `max` limits                                       | 4     |
| MGR-SET-01  | Launch branding lock; rename unaffected                                             | entitlement + `org.settings.manage` for rename too                        | 3     |
| MGR-SET-02  | upserts `org_role_features` to grant branding                                       | entitlement profile ⊆ plan ceiling; no snapshot                           | 3     |
| MGR-SET-05  | downgrade hides the logo; `/features/me` drops branding                             | `change_org_plan` + `/me/entitlements`                                    | 3     |
| ONB-07      | org switch keeps `/edu`; active-org content only                                    | shell follows the active org; org-keyed cache                             | 6     |
| PUB-02      | `/features` sells „Zarządzanie Organizacją”, „Masowe Zaproszenia”                   | permissions are not plan contents                                         | 1     |
| PUB-03      | `?for=manager` → launch/team/hub/campus                                             | manager personal = `solo`; scope/audience                                 | 4     |
| PUB-04      | plan cards render `features[]` incl. „Zarządzanie Grupami”                          | plan entitlements only                                                    | 1     |
| SEC-05      | student 403 on `/teacher/*` writes and teacher stats                                | own-scope content permissions                                             | 2     |
| SEC-06      | student+teacher 403 on member/role writes; manager needs both keys                  | `org.member.manage` / `org.role.manage`                                   | 2     |
| STU-03      | sidebar from `/features/me`; member role grants flashcards/quiz/documents           | `/me/entitlements`; `learner` profile                                     | 3     |

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

### 0b — batch-0 cleanup (zero behaviour change)

- Add the missing `assignment.read` / `assignment.update` rows to the
  `permissions` catalog (N1), or delete the two checks.
- Drop `resource_permissions` (only reference is the generated type file).
- Delete the dead `X-Feature-Rollout` header and its two comments.
- Add the catalog invariants as integration tests: permissions ∩ entitlements =
  ∅; every active plan defines every limit key; every `surface` entitlement has
  a flag row.
- Freeze the key list: no new features or entitlement keys until phase 1.

**Exit:** `checks`, `unit`, `integration` green; no product behaviour changes.

### 1 — catalog cutover

- `@studiq/authz` exports `ENTITLEMENTS` and `PERMISSIONS` with metadata
  (`kind`, `scope`, `seatEligible`, `personalPortable`, `quota`); `FEATURES` is
  deleted, not aliased.
- DB: `feature_flags` → `entitlement_flags`; `plan_features` →
  `plan_entitlements`; `permissions` contents replaced; `limit_catalog` added.
- Remove `org.manage`, `member.manage`, `role.builder`, `group.manage` from
  plan entitlements. `documents` leaves the catalog until it has a surface.
- One catalog module feeds server, admin and tests; delete the duplicate
  `FEATURES` and the two denylists' copies.

**Exit:** no management key is purchasable; admin reads the new catalog;
`PUB`, `ADM`, `LIM`, `BIL` green.

### 2 — authority cutover (the largest; stack of 2–3 PRs)

- `org_role_permissions.permission_key` FKs the permission catalog; seed the
  role templates (`Admin`, `Teacher`, `Member`, `Assistant`, `Billing`,
  `Read-only`); custom roles start empty.
- `withAuth` builds `ctx.permissions` and `ctx.groupRoles` from
  `group_members.role`; add a verified-org helper.
- Scope defaults: `own` only when there is no active org (fail-closed fix).
- Replace `allowedAccountTypes` on org routes with `requirePermission` —
  41 files, keeping the 2 legitimate persona exceptions
  (org creation, classroom creation) and the 5 embedded membership checks.
- Role editor guards: closed catalog, no self-edit, no grant beyond your own
  authority, system roles protected, every change audited.
- Class invites use `group.invite` at group scope for existing org members;
  delete the `can_assign_org_role` teacher-name exception.
- **Control-plane RLS in the same PR**: `rls_caller_has_permission(org, key)`
  replaces `is_org_manager` / `has_org_feature` on members, roles, role
  permissions, organizations, seat pools, seat assignments and invitations.

**Exit:** permission matrix tests; group-teacher tests; 403 vs 404; no persona
gate on an org resource; `AUT`, `MGR`, `EDU`, `SEC` green.

### 3 — entitlements and limits

- `org_roles.entitlement_profile` (`all | learner | none`) replaces the
  boolean; `LEARNER_ENTITLEMENTS` lives in `@studiq/authz`.
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
nothing; `base` in `hub` is "feature off", not "on with 0 tokens"; `LIM`,
`BIL`, `STU` green.

### 4 — seats and personal plans

- `subscription_plans.scope` + `audience`; add `solo`; `launch` becomes
  organization-only; backfill legacy manager personal plans.
- `plan_seat_grants`, `org_seat_licenses`, `org_seat_pools.plan_key` FK.
- `addPool` validates the licence; `assignSeat` validates `audience`, not role
  names; seats intersect the ceiling, never grant permissions, never touch org
  capacity, never lower a limit.

**Exit:** seat/licence invariants; `solo`; `MGR`, `BIL`, `LIM` green.

### 5 — enforcement closure

- `requireEntitlement` on AI, quiz builder, advanced stats; `documents` is
  deleted rather than gated.
- Branding write = `org.settings.manage` **and** the `branding` entitlement.
- `requirePermission` on members, roles, seats, billing, invitations, settings,
  groups — replacing the remaining four mechanisms.
- No `allowedAccountTypes` on a product or org-management API. The four
  persona exceptions are the only ones left.

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
- Atomic token accounting (`reserve_ai_tokens`) with a DB check; no
  read-modify-write.
- Rewrite `docs/limits.md`; close every difficulty entry in the ledger.
- Full QA (188) + E2E on a disposable stack; grep gate for `AUTHORITY_MODEL`,
  `legacyOnly`, `nextOnly`, `shadow`, `org_role_features`, `has_org_feature`,
  `FEATURES`, `org.manage`.

## 6. Gates

Per PR: required checks green; phase QA shards green with 5/5 runs on every
changed case; no `test.skip`/`fixme` for a model difference; QA case text, spec
and `qa/coverage.md` updated together; ledger updated in the same PR; the FP
ids named in the description; migrations reviewed by the integrator.

Phase 7 only: full 188-case suite + E2E on a clean reset, and the grep gate.

## 7. Risks

| Risk                                             | Mitigation                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Phase 2 is large and touches 41 route files      | Stack 2–3 PRs; land the permission catalog first; the integrator rebases daily       |
| Intermediate behaviour looks wrong to a reviewer | Each phase states the capability it preserves; QA shards are the proof               |
| A migration lands wrong                          | Compensating migration; premarket allows dropping and replaying the chain            |
| Test churn hides a regression                    | QA is the gate; changed cases show before/after                                      |
| Two lanes collide on shared files                | Ledger rules; integrator owns migrations, generated types, seeds, knip, suppressions |
| Scope creep into content RLS (FP-03)             | Explicitly out; separate security ADR before launch                                  |
