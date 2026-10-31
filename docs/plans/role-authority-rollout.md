# Role-based authority — rollout plan (ADR-0008)

**Status:** Proposed, not started
**Date:** 2026-10-31
**Target:** implement [`docs/decisions/0008-role-based-authority.md`](../decisions/0008-role-based-authority.md)
**Evidence:** [`docs/audits/features-perms-weak-spots.md`](../audits/features-perms-weak-spots.md) (FP-01 … FP-22)
**Audited baseline:** detached `HEAD` `bd696b59` (base of `fix/personal-plan-in-org`)

This plan is written to be executed by several agents in parallel. It assumes the ADR is
accepted in principle; if it is not, Slice 0 is still safe (it only adds the branch, CI and
the test inventory).

> **This document supersedes the earlier flag/shadow draft.** There is no runtime mode,
> no dual model, no shadow resolver, no adapters, no compatibility views, no endpoint
> aliases, and no skipped tests. The old model is replaced in place; `main` receives the
> complete new model once.

---

## 0. Purpose and scope

### Goal

Replace the current mixed model (`FEATURES` containing entitlements and permissions,
plan-seeded role feature snapshots, persona-based route gates, dual resolvers) with the
ADR-0008 model:

- personas are global and non-authoritative;
- roles own permissions with `own | group | organization` scopes;
- group/class authority is a scope, not an org role;
- plans and seats own entitlements; roles may only allocate a subset;
- one resolution contract for entitlements + limits;
- one enforcement contract for APIs and UI.

### Non-goals (this programme)

- Content RLS scoping (`own`/`group` at the DB layer, FP-03) — separate security ADR.
- A paid personal plan family for managers.
- Selling seats separately from the org plan (v1 uses seats included in the org plan).
- Backward-compatibility shims for the old feature keys (pre-market).
- A permanent second trunk: `exp/role-authority` is temporary.

---

## 1. Non-negotiable principles

1. **No runtime fallback.** No `AUTHORITY_MODEL`, no `legacy|shadow|next`, no dual code path.
2. **No dual model.** No old table + new table, no compatibility view, no adapter, no endpoint
   alias. Rename/replace in place.
3. **No skipped tests for model differences.** A test that asserts a known bug is rewritten
   to assert the invariant in the slice that changes the behaviour. No `legacyOnly`,
   no manifest of skipped tests.
4. **`main` gets the new model once.** `main` stays on the current model until the final
   merge. No partial model merges, no in-between states.
5. **`exp` is green after every slice.** Feature branches may be red; `exp` may not be.
6. **Vertical slices.** Every slice includes migration + code + tests + docs and leaves the
   app coherent. Stacked PRs are allowed inside a slice; only the top merges.
7. **One migration shepherd.** WS1 owns `supabase/migrations/**`; other agents submit SQL
   for the shepherd to order and merge.
8. **Pre-market reset is allowed.** Exp uses a disposable database; a `supabase db reset`
   is acceptable. Final merge includes the complete migration chain.

**“No in-between states” applies to `main`, not to `exp`.** `exp` is intentionally a work in
progress between slices: each slice leaves it coherent and green for the model as it exists
at that point, but a slice is not a release. The complete model only exists after Slice 8;
that is the state that reaches `main`.

---

## 2. Branch and merge model

| Branch               | Purpose                            | Rules                                                                                                |
| -------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `main`               | Current model, production baseline | Untouched by the programme until the final merge. Unrelated work can land; `exp` merges it daily.    |
| `exp/role-authority` | Complete new model in progress     | Protected. PRs from `feat/ra-*`; green CI required; merges `main` daily; deleted after the final PR. |
| `feat/ra-*`          | One slice or sub-slice             | May be red while in progress; rebased on `exp`; PR into `exp`.                                       |

**No model merge to `main` before the final PR.** The final PR is the only state where the
new model reaches `main`; it must be complete, green, and QA'd. This is the “final, no
in-between states” rule.

### Why this is safe

- Pre-market: no production users to keep on the old model; a temporary integration branch
  is acceptable.
- `exp` is a release candidate for weeks, not a permanent second trunk.
- `main` keeps shipping unrelated work; `exp` merges it daily, so drift stays small.

---

## 3. Slice architecture

A **slice** is a vertical replacement of one axis. It contains:

- the SQL migration (rename/replace, no dual tables),
- the code that uses the new shape,
- the tests rewritten to the new invariants,
- the docs change (ADR/limits) if the slice changes behaviour.

Slices merge in dependency order. Agents can develop in parallel against the ADR contracts,
but merge order is serialized so `exp` stays green.

### Slices at a glance

| Slice | Replaces                                                               | Depends on | Exp exit (incl. QA subset)                            |
| ----- | ---------------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| **0** | Branch, CI, QA baseline, coverage map, inventory                       | —          | `exp` green; QA baseline recorded; `main` untouched   |
| **1** | Catalog: `FEATURES` → `ENTITLEMENTS` + `PERMISSIONS`; plan/flag tables | 0          | catalog invariants; QA: PUB, ADM, LIM, BIL            |
| **2** | Authority: role permissions, group scopes, route gates, role guards    | 1          | permission matrix; QA: AUT, MGR-ROL/MEM, EDU-GRP, SEC |
| **3** | Entitlements + limits: one resolver, role allocation, max rule         | 1, 2       | truth tables; QA: LIM, STU/EDU AI, MGR-SEAT, BIL      |
| **4** | Seats + personal: plan scope, `solo`, licenses, tier removal           | 3          | seat invariants; QA: MGR-SEAT, BIL, LIM               |
| **5** | Enforcement closure: paid surfaces + management surfaces               | 2, 3       | enforcement matrix; QA: STU/EDU AI, MGR, PUB          |
| **6** | UI + cache: nav, role editor, allocation, effective plan               | 2, 3, 5    | #799; QA: all UI-facing areas                         |
| **7** | RLS: control-plane permissions, remove `has_org_feature`               | 1, 2       | RLS parity; QA: SEC, MGR, EDU                         |
| **8** | Cleanup + final merge to `main`                                        | all        | full 215-case QA + E2E; legacy deleted                |

---

## 4. Slice details

Every slice exit includes its QA subset from §6.5 (affected areas + full area for changed
surfaces). A slice is not done until its QA cases are updated and green.

### Slice 0 — baseline, QA inventory, regression gate (2–3 agent-days)

**Goal:** the branch, the QA baselines and the acceptance evidence exist before code changes.

Deliverables:

- [ ] `exp/role-authority` created from `main`; branch protection + merge queue.
- [ ] CI jobs for `exp`: `lint`, `typecheck:all`, `test:unit`, `test:integration`.
- [ ] A dedicated **exp app + Supabase** (disposable; `db reset` allowed). The shared QA stack
      (`:3010`/`:54421`) stays on the current schema and is not used for this programme.
- [ ] `bun run test:qa` baseline on the exp stack with the **current** schema, seeded via
      `bun scripts/qa-tenant.ts --all --run "baseline$GITHUB_RUN_ID"`.
- [ ] QA coverage map: every `qa/cases/<ID>.md` → `__tests__/qa/<AREA>/<ID>.spec.ts` →
      affected surface → FP/ADR id → slice that updates it. Start from `qa/coverage.md`; add the
      model-change columns.
- [ ] Identify QA cases that encode a current bug (see §6.4) and assign each to a slice with
      the new expected result.
- [ ] E2E inventory: `__tests__/e2e/*` specs that use legacy `@dev.local` accounts,
      `/api/v1/features/me`, or plan-gated UI; decide `migrate` vs `retire` per spec.
- [ ] Seeder impact: list the required updates to `scripts/qa-tenant.ts` and
      `__tests__/helpers/tenant-seed.ts` (new catalog names, `change_org_plan`, role
      entitlements, `solo`) and assign them to Slice 1/3.
- [ ] `__tests__/compat/` supplementary matrix for auth/limits/status codes that QA does not
      cover (supporting artifact, not the primary gate).
- [ ] `__tests__/compat/model-change-inventory.md`: every unit/integration test and QA case
      that asserts a known bug, with FP id, slice, new invariant.
- [ ] ADR/plan links in the repo docs.

**Exit:** `exp` CI green on the untouched code; QA baseline recorded; coverage map reviewed;
`main` unchanged.

**Main:** untouched.

### Slice 1 — catalog cutover (≈1 week)

**Goal:** one capability namespace: entitlements vs permissions.

Deliverables:

- [ ] `packages/authz` exports `ENTITLEMENTS` and `PERMISSIONS` with metadata
      (`kind`, `scope`, `seatEligible`, `personalPortable`, `quota`). Delete `FEATURES`.
- [ ] DB: `feature_flags` → `entitlement_flags`; `plan_features` → `plan_entitlements`;
      `permissions` contents replaced with the new permission catalog; `limit_catalog` added.
- [ ] Remove `org.manage`, `member.manage`, `role.builder`, `group.manage` from
      `plan_entitlements`; remove `documents` from the catalogue until shipped.
- [ ] Update server, admin app, seeds, QA fixtures and tests to the new names. No alias.
- [ ] Catalog invariants: disjoint keys; every active plan defines every limit key; every
      surface entitlement has a flag row.
- [ ] Rewrite tests that assert management keys are plan features.

**Exit:** `exp` green; management keys no longer purchasable; admin UI reads the new catalog.
**Main:** no (behaviour change).

### Slice 2 — authority cutover (≈1–1.5 weeks)

**Goal:** permissions are role-based and org/group scoped; persona no longer authorizes.

Deliverables:

- [ ] `org_role_permissions` uses the new permission catalog; seed the role templates.
- [ ] `withAuth` builds `ctx.permissions` and `ctx.groupRoles` (from
      `group_members.role`); `verifiedOrg` helper.
- [ ] `resolveScope` default `own` only when there is **no** active org (fail-open fix).
- [ ] `can` / `buildQueryFilter` / `accessibleFilter` group semantics: read = member,
      manage/invite = teacher.
- [ ] Replace `allowedAccountTypes` on org routes with `requirePermission`.
- [ ] Role editor guards: no self-edit, scope ceiling, catalog validation, system-role
      protection.
- [ ] Class/group invite uses `group.invite` (existing org members in v1); no
      `can_assign_org_role` teacher exception.
- [ ] Rewrite tests that assert persona route gates / custom-role escalation.

**Exit:** `exp` green; permission matrix; group-teacher tests; 403/404 tests; no persona
gates on org resources.
**Main:** no.

### Slice 3 — entitlement + limit cutover (≈1.5–2 weeks)

**Goal:** one resolver for entitlements and limits; role allocation; fail-closed custom roles.

Deliverables:

- [ ] DB: `org_role_features` → `org_role_entitlements` + `org_roles.inherit_org_entitlements`;
      data migration (admin/teacher inherit, member explicit learner set, custom empty).
- [ ] `resolveEntitlements(ctx)` returns `{ entitlements, limits, sources, plan }`.
- [ ] Delete `FeatureResolver`/`LimitsResolver`; replace with `requireEntitlement` and the
      resolver. No adapter.
- [ ] Role allocation subset trigger; `change_org_plan` (prune allocations, re-seed templates;
      no `org.manage` exception).
- [ ] Limits: `max(org, seat, personal)` for user-scope; org plan for org scope; missing = 0;
      `-1` short-circuit; `effective = entitlement ∧ quota > 0`.
- [ ] Rewrite #971/#233/seat/custom-role/`org.manage` tests to the ADR invariants.

**Exit:** `exp` green; truth tables; four quadrants; custom-role zero rows fail closed;
seat `base` in `hub` yields “feature off”, not “feature on + 0 tokens”.
**Main:** no.

### Slice 4 — seats and personal (≈1 week)

**Goal:** a seat is a bounded, per-member entitlement grant; managers get a clean personal plan.

Deliverables:

- [ ] `subscription_plans.scope` + `audience`; `solo` plan; `launch` organization-only.
- [ ] `plan_seat_grants`, `org_seat_licenses`; `org_seat_pools.plan_key` FK.
- [ ] `addPool` validates the org license; `assignSeat` validates `audience`, not role names.
- [ ] Seats intersect the org ceiling; no permissions; no org-scope capacity; no limit
      downgrade.
- [ ] Backfill legacy `personal_plan_key` rows (pre-market: reset acceptable).
- [ ] Rewrite seat-tier/manager-mirror tests.

**Exit:** `exp` green; seat/licensing invariants; manager `solo`; no arbitrary pool minting.
**Main:** no.

### Slice 5 — enforcement closure (≈1 week)

**Goal:** every paid surface checks an entitlement; every management surface checks a
permission.

Deliverables:

- [ ] `requireEntitlement` on AI, quiz, quiz builder, advanced stats, documents (if shipped).
- [ ] Branding write = `org.settings.manage` + `branding` entitlement.
- [ ] `requirePermission` on members, roles, seats, billing, invitations, settings, groups.
- [ ] Remove remaining persona checks or document the allowed exceptions (public/onboarding/
      plan catalog/org creation).
- [ ] Enforcement matrix tests: API status for each key, no UI-only gate.

**Exit:** `exp` green; enforcement matrix.
**Main:** no.

### Slice 6 — UI, cache, role editor (≈1–1.5 weeks)

**Goal:** the UI reflects the same permissions/entitlements as the API.

Deliverables:

- [ ] Replace `/features/me` with `/me/entitlements`; replace `/permissions/me` with
      `/me/permissions`. Update every consumer; no alias.
- [ ] Nav filtered by permissions; shell role-derived, not persona.
- [ ] Query keys include `activeOrg.id`; invalidate after checkout, seat, role, plan, flag.
- [ ] Role editor: templates, scope selectors, effective preview.
- [ ] Entitlement allocation: subset of the org ceiling; `inherit` toggle.
- [ ] `/me/plan` shows the effective union (“Hub (org) + Pro (personal)”).
- [ ] #799 regression test.

**Exit:** `exp` green; UI/API agreement; org switch; #799.
**Main:** no.

### Slice 7 — RLS (≈1 week control-plane)

**Goal:** DB never wider than the API for control-plane tables.

Deliverables:

- [ ] `rls_caller_has_permission(org, key)`.
- [ ] Control-plane policies use it (`org_members`, `invitations`, `org_roles`,
      `org_role_permissions`, `org_seat_*`, `organizations`).
- [ ] Remove `has_org_feature`.
- [ ] Record the content-RLS decision (FP-03) as a separate ADR; do not block this programme.
- [ ] RLS parity tests (“RLS never wider than API”).

**Exit:** `exp` green.
**Main:** no (included in the final merge).

### Slice 8 — cleanup + final merge (≈1 week + QA)

**Goal:** delete the old model, run full QA, merge once.

Deliverables:

- [ ] Delete dead tables/keys/code: `FEATURES`, `org.manage`, `ADMIN_ONLY_FEATURES`,
      `org_role_features`, old resolvers, `allowedAccountTypes` on org routes, `has_org_feature`,
      `resource_permissions`, dead `assignment.*` if unused.
- [ ] Update docs (`limits.md`, ADR cross-references, audit).
- [ ] Full QA: four quadrants, custom role, teacher class, seat `base` in `hub`, checkout,
      downgrade, org switch, 403/404, cache, role editor.
- [ ] Grep gate: no `AUTHORITY_MODEL`, `legacyOnly`, `nextOnly`, `shadow`, old table names.
- [ ] Final `exp` → `main` PR; delete `exp/role-authority`.
- [ ] DB: full reset/migration chain verified on a disposable stack.

**Exit:** CI + full QA green; product sign-off; final merge.
**Main:** this is the only model merge.

---

## 5. Workstreams, ownership, parallelism

| WS                     | Owns                                                          | Depends on          | Starts                        |
| ---------------------- | ------------------------------------------------------------- | ------------------- | ----------------------------- |
| **WS0** Integration    | branch, CI, merge queue, slice coordination                   | —                   | day 0                         |
| **WS1** Catalog/schema | `packages/authz`, `supabase/migrations`, seeds, backfills     | —                   | day 0                         |
| **WS2** Authority core | `with-auth`, `authz.ts`, group scopes, `requirePermission`    | Slice 1             | after Slice 1                 |
| **WS3** Role admin     | `org-role.*`, role editor API, guardrails                     | Slice 1/2           | parallel with WS2             |
| **WS4** Entitlements   | `feature/limits.resolver`, `resolveEntitlements`, plan change | Slice 2             | parallel with WS3             |
| **WS5** Seats/personal | `seat.service`, licenses, `solo`, backfill                    | Slice 3             | after Slice 3                 |
| **WS6** UI             | hooks, nav, role editor, allocation, cache                    | Slice 2/3 contracts | parallel, merge after backend |
| **WS7** RLS/security   | control-plane policies, content decision                      | Slice 2             | parallel, merge late          |
| **WS8** Quality        | compat matrix, test inventory, QA, docs, observability        | all                 | day 0                         |

### File ownership (to avoid conflicts)

| Path                                                                             | Owner                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/authz/**`                                                              | WS1                                             |
| `supabase/migrations/**`                                                         | WS1 (shepherd)                                  |
| `packages/server/src/lib/{with-auth,authz}.ts`                                   | WS2                                             |
| `packages/server/src/services/{feature,limits}.resolver.ts` + `lib/authority/**` | WS4                                             |
| `packages/server/src/services/{org-role,organization-member}.*`                  | WS3                                             |
| `packages/server/src/services/{seat,subscription-plan,mock-stripe}.*`            | WS5                                             |
| `apps/web/src/hooks/**`, `app-sidebar`, role/entitlement UI                      | WS6                                             |
| `__tests__/**`                                                                   | WS8 coordinates; each WS adds tests in its area |

### Merge order and parallelism

```
Slice 0
  └─ Slice 1 (WS1)
       ├─ Slice 2 (WS2 + WS3 + WS6 hooks)
       │    ├─ Slice 3 (WS4)
       │    │    ├─ Slice 4 (WS5)
       │    │    └─ Slice 5 (WS2/WS4/WS6)
       │    │         └─ Slice 6 (WS6)
       │    └─ Slice 7 (WS7)  [can merge before/after 4–6]
       └─ Slice 8 (all)
```

- Slices 2/3/4/5/6 are **serialized at merge** but can be **developed in parallel** on
  `feat/ra-*` branches after Slice 1 lands.
- Slices 5 and 6 can overlap; Slice 7 can land anywhere after Slice 2.
- `exp` is green after each merge. A slice with stacked PRs merges only when the top is green.
- Agents rebase on `exp` daily; max 2 days divergence.

---

## 6. Regression strategy: QA/E2E first

### 6.1 Test hierarchy

| Layer                                                         | What it proves                                                   | Gate?                       | Expected churn                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| **QA suite** (`qa/cases` + `__tests__/qa`, `bun run test:qa`) | The actual product: real UI, real API, tenant-isolated journeys  | **Primary regression gate** | Case text + spec updated per slice |
| **E2E** (`__tests__/e2e`, `bun run test:e2e`)                 | Browser/product flows not covered by QA, or legacy-seed flows    | Secondary                   | Migrate or retire per spec         |
| **Integration** (`__tests__/integration`)                     | Schema constraints, RLS, resolver/limit invariants QA cannot see | Supporting                  | Many rewritten per slice           |
| **Unit** (`__tests__/unit`)                                   | Pure logic, fast feedback                                        | Not a compatibility gate    | Rewrite freely per slice           |

**The rule:** unit and integration tests only exercise small slices. They are expected to
change in large numbers. The product regression net is the QA suite (215 cases) plus the
E2E suite. Do not optimize for keeping implementation-coupled unit tests alive; do optimize
for keeping the QA corpus green and honest.

### 6.2 The QA suite is the product contract

`qa/QA-SUITE-APPROACH.md` already defines the right model: one case → one spec → one tenant,
no skips, no `test.fixme`, no expected-failure wrappers, 5/5 runs. This programme adopts it as
the acceptance gate.

Per slice:

1. Read the affected cases in `qa/cases/<ID>.md`.
2. Walk the case on the exp stack **before** changing code, then after; record the delta.
3. Update the case text/prereqs/expected result when the ADR changes the product behaviour.
4. Update the spec in `__tests__/qa/<AREA>/<ID>.spec.ts`; run 5/5 with a fresh tenant.
5. Update `qa/coverage.md` and the slice’s QA coverage map.
6. No `test.skip`/`fixme` for model differences. If a case cannot pass, the slice is not ready.

The QA corpus is the product specification. A case that encodes a bug is **edited** (case +
spec) with QA/product sign-off; it is not skipped.

### 6.3 Unit and integration policy

- Rewrite the tests that assert changed behaviour in the slice that changes it. No
  `legacyOnly` / `nextOnly`, no skipped-test manifest.
- Keep integration tests for invariants the QA suite cannot see: catalog disjointness, every
  plan defines every limit, subset triggers, RLS parity, resolver truth tables. These are cheap
  and catch real regressions.
- Delete tests that only assert an implementation detail of the old model (shape of
  `org_role_features`, seat exclusivity, persona route gates). Replace them with the invariant
  in the same PR.
- Every rewrite is listed in the model-change inventory with the FP/ADR id and the slice.

### 6.4 QA cases that encode current bugs (must be edited, not skipped)

Confirm and assign in Slice 0. Likely candidates:

| Case                   | Current assertion                                                         | Change                                                                     |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `MGR-SEAT-02`          | only 3 admin-only keys; seat plan is the effective plan                   | full structural set; `max(org, seat, personal)` (FP-02/FP-07)              |
| `EDU-02`               | `group.manage` comes from the plan/sidebar; educator has no class role    | group teacher permission; plan no longer grants it (FP-06)                 |
| `BIL-04`               | branding/role builder locks after checkout; personal plan untouched       | entitlement invalidation; effective plan display (#799, FP-17)             |
| `PUB-02`               | `/features` lists management keys as plan features                        | entitlements only; permissions are role-based (FP-06)                      |
| `LIM-02..05`           | org/personal precedence, seat exclusivity                                 | #971 + `max` rule (FP-07/FP-08)                                            |
| `MGR-ROL-*`            | role builder gated by `role.builder` feature; permissions as free strings | `org.role.manage` permission; catalog + scope ceiling (FP-04)              |
| `MGR-MEM-*`            | member management gated by `member.manage` feature                        | `org.member.manage` permission (FP-09)                                     |
| `AUT-07`, `AUT-15..19` | persona-based redirects / route access                                    | role-derived shell; permission gates (FP-09)                               |
| `SEC-04`               | org isolation via persona/feature assumptions                             | same product guarantee, now permission-based (FP-03/FP-11)                 |
| `ADM-PLN/FLG/OVR`      | plan features/flags/overrides include model keys                          | entitlement-only catalog; overrides cannot grant permissions (FP-12/FP-13) |

The table is a starting point; Slice 0 produces the full map from `qa/cases/`.

### 6.5 QA gate per slice

Run the affected QA areas at every slice exit, and the **full 215-case suite** at Slice 8.
The final merge requires the full QA suite + E2E.

| Slice | QA areas that must be green    | Notes                                              |
| ----- | ------------------------------ | -------------------------------------------------- |
| 1     | PUB, ADM, LIM, BIL             | plan/feature/flag catalogue; pricing pages         |
| 2     | AUT, MGR-ROL/MEM, EDU-GRP, SEC | roles, members, group scopes, persona redirects    |
| 3     | LIM, STU/EDU AI, MGR-SEAT, BIL | entitlements, #971, limits, custom role            |
| 4     | MGR-SEAT, BIL, LIM             | seats, `solo`, plan scope                          |
| 5     | STU/EDU AI, MGR, PUB           | paid surfaces, branding, management surfaces       |
| 6     | all UI-facing areas            | nav, role editor, allocation, effective plan, #799 |
| 7     | SEC, MGR, EDU                  | RLS parity, org isolation                          |
| 8     | **all 215 + E2E**              | final gate                                         |

### 6.6 E2E suite

The E2E suite is secondary but still valuable. Slice 0 classifies each spec:

- **migrate** — update to tenant fixtures and `/me/entitlements`:
  `ai-assistant.spec.ts`, `manage-roles-plan-gate.spec.ts`, `manage-members-role.spec.ts`,
  `manager-org-switch.spec.ts`, `teacher-org-switch-decks.spec.ts`, `checkout-org.spec.ts`,
  `student-sidebar-labels.spec.ts`.
- **retire** — if the flow is already covered by a QA case and the spec only duplicates it.
- **keep** — flows QA does not cover (browser-specific UI, editor DnD, etc.).

No E2E spec may keep using the legacy `@dev.local` accounts or `/features/me` after Slice 6.

### 6.7 New QA cases for the ADR invariants

Add cases (IDs to be assigned by the QA owner) for:

1. **Persona vs role across orgs** — student persona is Admin in org B, Member in org A; nav
   and API follow the active org; no cross-org authorization.
2. **Custom role, zero permissions** — can do nothing; zero entitlements = no paid surface.
3. **Custom role, zero rows** — does not inherit the org plan; explicit allocation only.
4. **Role editor self-escalation** — cannot edit own role / exceed own scope / grant beyond
   own permissions.
5. **Seat base in hub** — member has `ai.chat` from the role but a 0-token seat; the product
   must show it as unavailable, not “on + 429”.
6. **Personal Pro in a free org (#971)** — AI works; org capacity unchanged.
7. **Checkout invalidation (#799)** — branding/role builder appear without a reload.
8. **Feature on, quota 0** — hidden/disabled consistently in API and UI.
9. **Group teacher class flow** — manage class roster/invites without `org.member.manage`.
10. **Pricing** — management keys are not listed as plan features.

### 6.8 Supplementary compatibility matrix

`__tests__/compat/` remains as a small, fast check for auth/limits/status codes not covered by
QA. It is supporting evidence, not the primary gate. The QA suite is authoritative for
product behaviour.

### 6.9 QA environment and seeding

- The shared QA stack is on the current schema. The exp branch has a different schema; run QA
  on the **exp stack** (disposable app + Supabase, `db reset` allowed), not the shared QA DB.
- Point the runner at the exp stack via `QA_APP_URL` / the Supabase env; seed with
  `bun scripts/qa-tenant.ts --all --run "exp$GITHUB_RUN_ID"`.
- Update `scripts/qa-tenant.ts` and `__tests__/helpers/tenant-seed.ts` in Slice 1/3 for the
  new catalog, `change_org_plan`, role entitlements and `solo`. Without this, every QA case
  fails at seed time.
- Global mutations (plans, flags) are serialized; per-slice subsets avoid running all 215 cases
  on every PR. Full suite at slice boundaries and Slice 8, in CI (`QA_WORKERS`) or sharded on
  the dedicated exp runner — not on the shared dev VM (see `qa/QA-SUITE-APPROACH.md`).

---

## 7. CI and merge gates

### PR → `exp/role-authority`

- [ ] `lint`, `typecheck:all`, `test:unit`, `test:integration`.
- [ ] The slice’s **QA subset** is green (`bun run test:qa -- <affected specs>`), with 5/5
      runs for every changed case.
- [ ] No `test.skip` / `fixme` / expected-failure wrapper for model differences.
- [ ] QA case text + spec + `qa/coverage.md` updated together (if the slice changes product
      behaviour).
- [ ] Model-change inventory updated (unit/integration + QA cases).
- [ ] FP/ADR id in the PR description.
- [ ] Migration approved by WS1 shepherd.
- [ ] Rebased on `exp` within 2 days.
- [ ] `exp` is green after the merge.

### Final PR → `main`

- [ ] Full CI (lint, typecheck, unit, integration).
- [ ] **Full QA suite**: `bun run test:qa` — all 215 cases green on the exp stack.
- [ ] **E2E suite**: `bun run test:e2e` green (migrated/retired specs accounted for).
- [ ] QA coverage map fully closed; no skipped, disabled or expected-failure case.
- [ ] Model-change inventory fully closed: every rewritten unit/integration test and QA case
      has the FP/ADR id and the product/QA sign-off.
- [ ] Grep gate: no `AUTHORITY_MODEL`, `legacyOnly`, `nextOnly`, `shadow`, old table names,
      `org.manage`, `ADMIN_ONLY_FEATURES`, `org_role_features`, `FEATURES`.
- [ ] Full QA on a disposable stack (not the shared QA DB), seeded from a clean reset.
- [ ] DB migration chain verified from a clean reset (`supabase db reset`).
- [ ] Product/QA sign-off on the changed tests and cases.
- [ ] Delete `exp/role-authority`.

---

## 8. Risks and rollback

| Risk                                     | Mitigation                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Long-lived branch with schema divergence | Daily `main` merge; one shepherd; small slices; `db reset` on exp.                                       |
| Exp goes red between slices              | Slice PRs are vertical and complete; stacked PRs merge only at the top; no red `exp`.                    |
| QA case text encodes the current bug     | Slice 0 maps every case; edit case + spec with QA/product sign-off; no skip.                             |
| Unit/integration churn is large          | Treat them as implementation tests; rewrite per slice; only integration invariants + QA gate acceptance. |
| Shared QA stack has the old schema       | Run QA on the dedicated exp stack; `QA_APP_URL`/Supabase env; `db reset`; do not touch `:3010`/`:54421`. |
| QA suite runtime (215 cases)             | Per-slice subsets + full area for changed surfaces; full 215 only at Slice 8.                            |
| Big-bang final merge risk                | Treat `exp` as release candidate for a week; freeze unrelated changes; full QA + E2E.                    |
| Test edits hide regressions              | QA is the product gate; changed cases show before/after; product/QA sign-off.                            |
| Migration conflicts                      | Shepherd; one migration chain; rebase daily.                                                             |
| Content RLS scope creep                  | Separate ADR; do not block the model.                                                                    |
| Seat billing scope creep                 | v1 only seats included in the org plan.                                                                  |
| Class invites to non-members             | v1 restricted to existing org members; revisit with `max_students`.                                      |

**Rollback:** no runtime flag. Revert the slice on `exp` (and reset the disposable DB). On
`main`, the model only exists after the final merge; rollback = revert the merge commit and
restore the pre-merge DB snapshot. Pre-market, a reset is acceptable.

---

## 9. Effort and critical path

Rough order of magnitude with 4–6 agents:

| Slice | Effort       | Parallel with   |
| ----- | ------------ | --------------- |
| 0     | 2–3 days     | —               |
| 1     | ~1 week      | WS2/WS4 design  |
| 2     | ~1–1.5 weeks | WS3, WS6 hooks  |
| 3     | ~1.5–2 weeks | WS5 design, WS7 |
| 4     | ~1 week      | WS6             |
| 5     | ~1 week      | WS6             |
| 6     | ~1–1.5 weeks | WS7             |
| 7     | ~1 week      | Slice 5/6       |
| 8     | ~1 week + QA | —               |

End-to-end: roughly **4–5 weeks** to the final merge, plus QA. Critical path:
0 → 1 → 2 → 3 → 8.

---

## 10. First PRs (in order)

1. `chore(authority): create exp branch + exp QA stack + CI + merge queue` — WS0.
2. `test(qa): baseline run + coverage map + model-change inventory` — WS8.
3. `refactor(catalog): split ENTITLEMENTS and PERMISSIONS; remove management keys from plans; update QA seeder` — WS1 (Slice 1).
4. `feat(authority): role permissions, group scopes, route gates` — WS2/WS3 (Slice 2).
5. `feat(entitlements): one resolver, role allocation, max limits` — WS4 (Slice 3).
6. `feat(seats): plan scope, solo, licenses` — WS5 (Slice 4).
7. `feat(enforcement): requireEntitlement/requirePermission everywhere` — WS2/WS4/WS6 (Slice 5).
8. `feat(ui): permission nav, role editor, allocation, cache` — WS6 (Slice 6).
9. `feat(rls): permission policies` — WS7 (Slice 7).
10. `chore: delete legacy + full QA + final merge` — all (Slice 8).

---

## 11. Decisions to lock before Slice 0

1. Branch name/lifecycle: `exp/role-authority`, deleted after the final PR.
2. No runtime flag, no dual model (this document assumes it).
3. Main merge policy: one final model merge; unrelated work can land on main and is merged
   into exp daily.
4. Migration shepherd and slice cadence.
5. Who signs off `model-change` test rewrites and QA case edits (product + QA).
6. QA owner for the suite, and who runs the full 215-case suite at Slice 8.
7. Exp QA stack: URLs, database, seeding command, who can reset it.
8. QA area subsets per slice (confirm §6.5) and the new-case budget/IDs.
9. RLS: control-plane in Slice 7; content RLS as a separate ADR.
10. Group invites: v1 restricted to existing org members?
11. Seats: included-in-org-plan only for v1?
12. `solo` as a new free manager plan vs manager on `base`.
13. Catalog home (`@studiq/authz`); `FEATURES` is deleted, not aliased.

---

## Appendix A — contracts to land in Slice 1/2

```ts
// @studiq/authz
export type CapabilityKind = 'entitlement' | 'permission';
export interface CapabilityMeta {
  key: string;
  kind: CapabilityKind;
  scope: 'personal' | 'org' | 'group';
  seatEligible?: boolean;
  personalPortable?: boolean;
  quota?: string | null;
}
export const ENTITLEMENTS: readonly CapabilityMeta[];
export const PERMISSIONS: readonly CapabilityMeta[];
// FEATURES is deleted in Slice 1; no alias.
```

```ts
// packages/server/src/lib/authority/types.ts
export interface EntitlementResolution {
  entitlements: string[];
  limits: Record<string, number>;
  sources: Record<string, 'role' | 'seat' | 'personal' | 'override'>;
  plan: { primary: string | null; sources: string[] };
}
export interface PermissionResolution {
  permissions: Record<string, 'own' | 'group' | 'organization'>;
  groupRoles: Record<string, 'teacher' | 'member'>;
}
export function resolveEntitlements(ctx: RequestContext): Promise<EntitlementResolution>;
export function resolvePermissions(ctx: RequestContext): Promise<PermissionResolution>;
export function requireEntitlement(ctx: RequestContext, key: string): Promise<void>;
export function requirePermission(
  ctx: RequestContext,
  key: string,
  resource?: ResourceRef,
): Promise<void>;
export function verifiedOrg(ctx: RequestContext): Promise<{ orgId: string; roleId: string } | null>;
```

```ts
// API shapes (replace the old endpoints in Slice 6; no aliases)
GET /api/v1/me/entitlements -> { entitlements: string[]; limits: Record<string, number>;
  sources: Record<string, string>; plan: { primary: string | null; sources: string[] } }
GET /api/v1/me/permissions  -> { permissions: Record<string, string>;
  groupRoles: Record<string, 'teacher' | 'member'> }
```

## Appendix B — compatibility matrix template

`__tests__/compat/` records the expected outcome. “Current” means the current product
behaviour, not a runtime mode; the final merge runs the new model against the same table.

| Account  | Org plan | Role    | Seat   | Personal | Override | Flag | Expected features | AI limit                 | `/manage` | Members API | Kind                |
| -------- | -------- | ------- | ------ | -------- | -------- | ---- | ----------------- | ------------------------ | --------- | ----------- | ------------------- |
| student1 | launch   | member  | —      | base     | —        | on   | flashcards, quiz  | 0                        | —         | 403         | must remain         |
| student1 | launch   | member  | —      | pro      | —        | on   | + ai.chat         | max(personal, org)       | —         | 403         | intentional (#971)  |
| student1 | launch   | member  | base   | pro      | —        | on   | + ai.chat         | max(personal, org, seat) | —         | 403         | intentional (FP-07) |
| teacher1 | hub      | teacher | —      | lite     | —        | on   | role allocation   | 200k                     | —         | 403         | intentional         |
| teacher1 | hub      | custom  | —      | lite     | —        | on   | empty             | 0                        | —         | 403         | intentional (FP-01) |
| manager1 | hub      | admin   | —      | solo     | —        | on   | all hub           | 200k                     | 200       | 200         | must remain         |
| manager1 | hub      | admin   | campus | solo     | —        | on   | all hub           | 200k                     | 200       | 200         | must remain         |
| student1 | —        | —       | —      | pro      | —        | off  | personal          | -1                       | —         | 401/403     | must remain         |

## Appendix C — slice checklist

### Slice 0

- [ ] branch + protection + merge queue
- [ ] exp QA stack (app + Supabase, disposable)
- [ ] CI jobs
- [ ] QA baseline (current schema)
- [ ] QA coverage map (case → spec → FP → slice)
- [ ] bug-encoding QA cases identified
- [ ] E2E migrate/retire inventory
- [ ] model-change inventory (unit/integration + QA)
- [ ] QA seeder impact list

### Slice 1

- [ ] `ENTITLEMENTS` / `PERMISSIONS`
- [ ] table renames / catalog rows
- [ ] remove management keys from plans
- [ ] update server/admin/seeds/tests
- [ ] update `scripts/qa-tenant.ts` / `tenant-seed.ts`
- [ ] catalog invariants
- [ ] QA: PUB, ADM, LIM, BIL

### Slice 2

- [ ] `resolvePermissions` + `requirePermission`
- [ ] `withAuth` permissions + group roles
- [ ] `resolveScope` default fix
- [ ] group-scoped `can`/filters
- [ ] route gates
- [ ] role editor guards
- [ ] QA: AUT, MGR-ROL/MEM, EDU-GRP, SEC

### Slice 3

- [ ] `org_role_entitlements` + `inherit`
- [ ] `resolveEntitlements` (features + limits)
- [ ] `change_org_plan`
- [ ] max rule + `effective` rule
- [ ] rewrite #971/#233/seat/custom-role tests and QA cases
- [ ] QA: LIM, STU/EDU AI, MGR-SEAT, BIL

### Slice 4

- [ ] plan `scope`/`audience` + `solo`
- [ ] seat licenses + validation
- [ ] no seat permissions/org capacity
- [ ] personal backfill
- [ ] QA: MGR-SEAT, BIL, LIM

### Slice 5

- [ ] paid-surface entitlements
- [ ] management-surface permissions
- [ ] branding permission + entitlement
- [ ] enforcement matrix
- [ ] QA: STU/EDU AI, MGR, PUB

### Slice 6

- [ ] `/me/entitlements` + `/me/permissions`
- [ ] permission nav + role-derived shell
- [ ] org-keyed cache + invalidation
- [ ] role editor + allocation UI
- [ ] effective plan display
- [ ] #799 regression
- [ ] QA: all UI-facing areas

### Slice 7

- [ ] `rls_caller_has_permission`
- [ ] control-plane policies
- [ ] remove `has_org_feature`
- [ ] content-RLS ADR
- [ ] RLS parity
- [ ] QA: SEC, MGR, EDU

### Slice 8

- [ ] delete legacy code/tables
- [ ] docs updated
- [ ] full QA 215 + E2E
- [ ] grep gate
- [ ] final merge + delete exp
