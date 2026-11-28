# Extending and retiring an entitlement

**Status:** normative for the two checklists, measured 2026-11-25 (ADR-0015 phase
8, D23). The "When there are users" rows are design recommendations; the ones
marked **proposed** are not decisions and nothing implements them.
**Decision record:** [ADR-0015 §5.1](../decisions/0015-role-based-authority.md#51-entitlement-catalog).
**Measured on:** a served production build of `feat/authority-8` (`b08321d8` + the
simulation diff), this checkout's own Supabase stack, with existing orgs and
users. Simulation key: fictional `voice.notes`; surface:
`GET /api/v1/stats/teacher/quizzes` and the `/edu/stats/quizzes` page that reads
it. The first attempt put the gate on `GET /api/v1/teacher/quizzes` and broke
three pinned contracts (`AUT-19` requires the authorized teacher to get `200` on
that read, `SEC-05` requires the student's own list to stay `200`, `EDU-QZ-06`
pins the free-teacher page) — see "Retrofitting a gate onto a free read" below.

An entitlement key is **product access**, never authority (ADR-0015 §4.1). Its
whole state lives in five places, and only one of them is code:

| Where                                                 | What it owns                                           | Layer |
| ----------------------------------------------------- | ------------------------------------------------------ | ----- |
| `packages/authz/src/entitlements.ts` (`ENTITLEMENTS`) | the key + metadata, and the `/me/entitlements` order   | code  |
| `entitlement_catalog`                                 | the same metadata, for the DB readers and the admin UI | data  |
| `entitlement_flags`                                   | the kill switch (a missing row fails closed, D8)       | data  |
| `plan_entitlements`                                   | which plans carry it (the ceiling)                     | data  |
| `user_feature_overrides`                              | per-user grant/revoke, the final word on its key (D26) | data  |

`packages/server/src/services/entitlement.resolver.ts` has **no per-key branch**:
it reads the catalog metadata and the tables above. That is why both checklists
below are almost entirely data, and why the resolver diff for the whole
simulation was **zero lines**.

## Adding an entitlement

Do it in the same PR as the surface — a key with no surface is a gate nobody
reads, and the catalog is open (D22): ship it when its surface does.

| #   | Step                                                                                                                                                                                        | Where                                                             | Layer          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------- |
| 1   | Fix the metadata: `category` (`baseline`/`surface`), `scope`, `seatEligible`, `personalPortable`, `quota`. `baseline` is never gated; a personal key inside an org needs `personalPortable` | decision, then the two catalogs                                   | —              |
| 2   | Append the key to `ENTITLEMENTS` (never reorder: declaration order is `/me/entitlements` order)                                                                                             | `packages/authz/src/entitlements.ts`                              | code           |
| 3   | One `entitlement_catalog` row with the same metadata                                                                                                                                        | migration                                                         | data           |
| 4   | One **enabled** `entitlement_flags` row — a missing row fails the resolver closed                                                                                                           | migration                                                         | data           |
| 5   | `plan_entitlements` rows for the plans that should carry it                                                                                                                                 | migration — the seed no longer owns plan rows (#1494)             | data           |
| 6   | Grants and policies: **none**. `authenticated` already has table-level `SELECT` and the catalog policies are `using (true)`; a new row is readable like the existing ones                   | —                                                                 | —              |
| 7   | One `requireEntitlement(ctx, key)` on the surface, first statement before the permission check and the parse                                                                                | the surface's controller                                          | code           |
| 8   | The surface's disabled state: `useEntitlement()(key)` plus copy, only if the page needs one. The generic `ErrorState` is not a product denial                                               | the page + `apps/web/src/i18n/messages/{pl,en}.json`              | code           |
| 9   | Admin panel: nothing. `/feature-flags` reads `entitlement_flags` live; the row appears on reload                                                                                            | —                                                                 | data           |
| 10  | Tenant/QA fixture: seed the case on a plan that carries the key (`bun scripts/qa-tenant.ts <CASE> --plan <plan>`)                                                                           | `qa/.tenants/**` (generated)                                      | data (fixture) |
| 11  | Tests: `catalog-invariants` already pins TS `ENTITLEMENTS` to `entitlement_catalog` and every surface key to a flag row; `plan-catalog` pins the plan matrix, so mirror step 5's row there  | `__tests__/integration/{catalog-invariants,plan-catalog}.test.ts` | —              |
| 12  | Deploy: apply the migration to the running database (`supabase migration up` / `db push`), then **rebuild and restart the app** — the TS constant is baked into the build                   | deploy                                                            | both           |

Measured cost for the whole simulation: **one migration + one catalog constant +
one surface call**, plus the surface's own UI copy. Resolver change: **none**.
The migration applied to the live database with no restart; `/me/entitlements`
gained the key after the app rebuild only, because the DB row alone is inert
until the TS catalog knows the key (step 12 is not optional).

The plan catalogue is migration-owned code (#1494): the eleven plans (the four
personal plans, the four organization tiers and the three AI licences) live in
one declarative matrix owned by
`supabase/migrations/20261128090000_ai_seat_licences.sql`, together with their
entitlement sets and limits, and `supabase/seeds/00_plans.sql` writes no plan
data. A new key's plan rows go into the matrix that owns those plans;
`__tests__/integration/plan-catalog.test.ts` mirrors the matrix literally, so it
fails until the test is updated in the same PR. An admin-panel price/key/entitlement edit is a dev-only experiment that the
next migration re-asserts.

## Adding a sales-led contract plan (unlisted)

A contract plan is an ordinary `subscription_plans` row, not a new entitlement
layer and not a per-organization copy (B3, #1495). The resolver does not change:
the organization's plan key is still the ceiling, and the plan carries catalogue
keys and limits like every other plan.

| #   | Step                                                                                                                                                                                                                              | Where                                       | Layer |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----- |
| 1   | Create the plan with `scope = 'organization'`, `visibility = 'unlisted'`, a `billing_mode`, and the price the contract records                                                                                                    | admin `/subscription-plans`                 | data  |
| 2   | Select only keys that exist in `entitlement_catalog`, and set `plan_limits` values from `limit_catalog`                                                                                                                           | admin plan editor                           | data  |
| 3   | Assign the organizations the contract covers. Assigning pins the plan **and** moves the organization onto it in one transaction (`assign_plan_to_org`); the relation is many-to-many, so two organizations can share one contract | admin plan editor, "Assigned organizations" | data  |
| 4   | To end a contract, move the organization to another plan (the `/orgs` plan picker, `change_org_plan`), then remove the pin                                                                                                        | admin `/orgs` + plan editor                 | data  |
| 5   | A contract that includes seats also needs a bespoke personal seat-licence plan — see "Seats in a contract plan" below                                                                                                             | migration or admin panel                    | data  |

The schema and the server enforce the rest:

- **Assignment is one step.** `assign_plan_to_org` inserts the pin
  (`on conflict do nothing`, so a second call is a no-op) and moves
  `organizations.plan` in the same transaction. A linked plan that grants
  nothing would be a contract the operator believes is live.
- **The plan must be an organization plan.** `change_org_plan` and
  `assign_plan_to_org` both refuse a plan whose `scope` is not `organization`
  (`22023`), because `organizations.plan` is the organization ceiling: a
  personal plan there would grant personal entitlements to the organization.
  The admin `/orgs` picker offers organization plans only.
- **Public reads hide it.** `SubscriptionPlanService.listActive` filters
  `is_active = true AND visibility = 'public'`, and `getByKey` answers
  `NOT_FOUND` for an unlisted plan. The pricing pages, the upgrade grids, the
  seats picker, `manage/settings`, `manage/billing` and the mock checkout form
  read the **list** or the detail through one of those two methods, so none of
  those lists can contain the plan. `/me/plan` is a different read: the assigned
  organization's managers still see the plan as their current plan on
  `manage/billing` and `manage/settings`, because that read is the caller's own
  plan row (see [deployment.md](../deployment.md#sales-led-contract-plans-unlisted)).
- **Anonymous PostgREST reads only the listed catalogue.** The `anon` policies
  on `subscription_plans`, `plan_entitlements` and `plan_limits` require
  `visibility = 'public' AND is_active`, so the publishable key cannot read a
  contract plan or its rows even with a direct table query. A signed-in caller
  still can (pre-existing D34); only the service reads are filtered for them.
- **Checkout refuses it.** `billingModeAllowsSelfServe` admits only the `stripe`
  mode, and `resolvePlanAssignment` refuses an unlisted plan for any owner that
  is not one of its assigned organizations. The mock completion path calls the
  same two rules.
- **`change_org_plan` refuses it.** An unlisted plan is refused for an
  organization with no assignment row (`42501`). The `/orgs` plan picker writes
  through the same function, so the panel shows the "assign it first" message
  instead of a stack trace.
- **Unpinning is guarded.** An assignment cannot be deleted while the
  organization is on the plan (409 from the service, `23503` from a
  `before delete` trigger): move the organization to another plan first, then
  unpin. A plan an assignment references cannot be deleted (FK
  `on delete restrict`).
- **Catalogue sweeps spare it.** A new matrix sweep must add
  `and visibility = 'public'` to its `delete from public.subscription_plans`,
  because a contract plan is created at runtime and is not in a migration
  matrix. `__tests__/unit/guards/plan-catalog-sweep.test.ts` fails a new sweep
  without the predicate; the sweeps before B3 are allowlisted there.
- **The billing seam is one module.**
  `packages/server/src/lib/payment/plan-availability.ts` decides who may
  self-serve, and `PlanInfo.selfServe` is the derived boolean the web app reads.
  A new payment path — a private Stripe subscription created by sales, or
  another integration — adds a mode value and one arm there, not a new
  comparison in a service, a controller or a component.

### Seats in a contract plan

Per D15/D33 an organization contract that includes seats needs a matching
bespoke **personal** seat-licence plan: `scope = 'personal'`, every key
`seatEligible`, `visibility = 'unlisted'`. The pool is that plan's licence.

The pin and the move are organization-plan concepts, and this plan is personal:
`assign_plan_to_org` refuses a plan whose `scope` is not `organization`, and no
reader consults `plan_assignments` for a personal plan. So the seat-licence plan
is **not** pinned, and the plan editor's "Assigned organizations" section does
not list it. This slice adds no pin path for personal plans.

The seats picker (`/manage/seats`, PR2) reads
`SubscriptionPlanService.listLicencePlans`: active, personal plans sold on the
`seat_pool` channel, authenticated and gated by `org.seat.manage`. It does not
filter `visibility`, so a bespoke unlisted licence plan is offerable there. The
three AI licences are `public` anyway, which is the accepted price-list exposure
(#1511 §7.3). Purchase and assignment are PR2+; this slice ships the catalogue,
the resolver arm and the read.

### Retrofitting a gate onto a free read is a breaking change

A paid key belongs on a surface that is **already paid** or **new**. The first
attempt at this audit gated `GET /api/v1/teacher/quizzes`, a read the student and
the free teacher both use, and three pinned cases went red in the same run:
`AUT-19` (an authorized teacher must get `200` on that read), `SEC-05` (a
student's own list must stay `200`) and `EDU-QZ-06` (the free-teacher page). The
gate was correct; the surface was not. The entitlement plane needed no change —
the move to `/api/v1/stats/teacher/quizzes` (a teacher-only analytics read) was
one line and every case stayed green.

Rule: choose a surface whose existing contract the key's plan set already covers.
Gating a free read shared across personas means re-baselining every consumer and
its QA cases in the same PR — a product decision, not an entitlement one.

## Adding a sales channel

A channel is a **value**, not a column (#1511). `subscription_plans.sales_channels`
is `text[] not null default '{individual}'`, and `SALES_CHANNELS`
(`packages/authz/src/plans.ts`) is the one owner of the closed set.

| #   | Step                                                                                       | Where                           | Layer |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------- | ----- |
| 1   | Append the value to `SALES_CHANNELS` and name it once (`SALES_CHANNEL_*`)                  | `packages/authz/src/plans.ts`   | code  |
| 2   | Add it to the CHECK on `subscription_plans.sales_channels` in a new migration              | `supabase/migrations/`          | data  |
| 3   | Add one filter at the new selling surface (`.contains('sales_channels', [value])`)         | the service that reads the plan | code  |
| 4   | Put a plan on the channel with an array update; a plan sold through both keeps both values | admin plan editor or the matrix | data  |

- **No DDL on plans and no change to an existing surface.** Each surface reads
  one value: `listActive`/`getByKey` filter `individual`,
  `listLicencePlans` filters `seat_pool`, and the individual checkout refuses a
  plan without `individual`. A third channel touches only its own surface.
- **`visibility` is applied first.** The channel narrows what a read offers; it
  never replaces the `visibility='public' AND is_active` predicate.
- **The TS tuple and the CHECK are pinned together.**
  `__tests__/integration/catalog-invariants.test.ts` reads
  `pg_get_constraintdef` and fails when the two disagree; the CHECK itself
  rejects an empty array and any value outside the set.
- **A channel is not a scope.** A seat licence is a `scope='personal'` plan on
  `{seat_pool}`; `addPool` requires that channel, and the individual checkout
  refuses the plan (`BAD_REQUEST`).

## Retiring an entitlement

Order matters, and the database enforces most of it. Measured on the live stack:

1. **Remove or redirect the surface call** (`requireEntitlement`) — code. A
   retired key that still gates a live route is a 403 outage.
2. **Delete the `plan_entitlements` rows** — data. The ceiling narrows and every
   caller on those plans loses the key on its next resolution; no prune job runs
   and none is needed.
3. **Delete the `entitlement_flags` row** — data. This **cascades**:
   `plan_entitlements.entitlement_key` → `entitlement_flags(key)` is
   `ON DELETE CASCADE`, and so is `user_feature_overrides.feature_key`. Deleting
   the flag first therefore silently deletes the plan rows and any active
   per-user override (an admin grant) along with it. Do it after step 2 so those
   deletions are explicit.
4. **Delete the `entitlement_catalog` row** — data. This fails with `23503` while
   any `plan_entitlements` row still points at the key (the FK has no cascade).
5. **Remove the key from `ENTITLEMENTS`** — code, in the same change as step 4.
   `catalog-invariants` compares the two sets in both directions, so a DB row
   cannot disappear while the TS constant remains (red), and a TS key cannot
   exist without a catalog row (red). **Steps 3–5 land in one change**: between
   the flag delete and the constant's removal `catalog-invariants` is
   transiently red in the surface-key direction (every surface key in
   `ENTITLEMENTS` needs a flag row), so they are never separate commits.
6. **Remove the surface UI branch and its copy** if the surface is gone — code.
7. **Clients narrow on their next authority event.** There is no push channel:
   `invalidateAuthority` (org switch, role save, seat change, checkout, plan
   change) drops `entitlementKeys.all`, and `useEntitlements` refetches on focus
   after 60 s. A data-only removal performed behind the app's back is invisible
   until one of those happens, which is by design.

`documents` is the model for all of this: absent until its surface ships, and
re-entry is the adding checklist (minus the surface call until the surface
exists) — catalog + flag + plan rows, no resolver change (D22), and add-step 12's
rebuild while the constant is out of the served build.

## Steps that are still code

| Step                                           | Why it cannot be data-only                                                                                                                                                                                                      | Owner            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| The `ENTITLEMENTS` entry                       | the resolver drops any `plan_entitlements`/`catalog` key `isEntitlementKey` does not know. Measured: with the DB rows applied and the old build serving, `/me/entitlements` was unchanged; after the rebuild it gained the key. | the surface's PR |
| The surface call and its UI/denial copy        | the surface itself is code. Nothing in the entitlement layer needs touching                                                                                                                                                     | the surface's PR |
| Retiring: the TS constant with the catalog row | keeping them apart makes `catalog-invariants` red in one direction or the other                                                                                                                                                 | the retiring PR  |

Nothing else. In particular the resolver, the controller layer, `/me/entitlements`,
`/me/permissions`, the admin panel and RLS/policies needed **no** change for a new
key — a data-only change that forced code there would be the defect D23 names.

## When there are users

Phase 8 ran on a premarket stack; the licence to "delete, never shim" expires
with the first real user. These are the growth questions answered **before**
that, from the code as it stands — design only, nothing here is implemented.

### Today: derived

A new entitlement key that should reach **everyone** already entitled costs
catalog rows, not entity rows. Since #1493 the organization ladder is capacity
only: every organization plan carries the two baseline keys and nothing else, so
a new paid key needs a personal plan (or, from #1511, an organization licence),
not a hub/campus row. Resolution is a per-request composition
(`entitlement.resolver.ts`), so the write set is:

| Table                 | Rows per new default  | Multiplier                                            |
| --------------------- | --------------------- | ----------------------------------------------------- |
| `entitlement_catalog` | 1                     | —                                                     |
| `entitlement_flags`   | 1                     | surface keys only (baseline keys are never gated, D9) |
| `plan_entitlements`   | one per carrying plan | 2 today (`stats.insights` is on `pro` and `max`)      |
| `limit_catalog`       | 0–1                   | only a key with a **new** quota limit                 |
| `plan_limits`         | one per carrying plan | only that new limit key                               |

**Zero** rows in `profiles`, `org_members`, `org_roles`,
`org_roles`-adjacent stores or `org_seat_assignments`. The row populations those
would touch at measurement (2026-11-25, after the QA corpus seed — the count
tracks however many tenants the stack has):

```sql
select count(*) from public.org_roles;    -- 522
select count(*) from public.org_members;  -- 530
```

Seeding one row per entity would be O(orgs × roles) for
a change that is O(plans) — **the wrong answer**, named here so it is not
rediscovered: it is unreplayable on `db reset` (the seed would have to carry it),
it cannot be reconciled when a plan later drops the key, and it would need a
hand-written `INSERT … SELECT` over every tenant.

The layers, verbatim from the resolver: org ceiling = `plan_entitlements`
(plan key), role = `org_roles.entitlement_profile` — a **selector**
(`all` | `learner` | `none`, `applyProfile`), not a per-key list; `all` is the
plan ceiling itself and `learner` is the TS constant `LEARNER_ENTITLEMENTS`,
so a key added to a plan reaches every `all` role with **no role write**. Seats
resolve through `org_seat_assignments` → `org_seat_pools.plan_key` (a
`seatEligible` key lands for every seated member of that licence with no
per-seat row). Personal plans are `profiles.personal_plan_key` (one row, the
user's). The only materialised per-user exception is `user_feature_overrides`.

| Question                                                              | Recommended direction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Trade-off                                                                                                                            | Owner / status                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| How does a new default reach existing orgs/users?                     | **Derived.** Catalog + flag + plan rows only. Do not write per-org or per-user rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A plan that does not carry the key silently does not grant it — that is the contract, not a gap.                                     | decided (D23, restated)                                                                                      |
| A key that must be default **outside any plan** (free safety feature) | No layer exists today: `category: 'baseline'` is pricing display only and never grants — `flashcards`/`quiz` are baseline _and_ on every plan. Preferred: a `default_entitlements(audience, key)` table read as one extra resolver layer (bounded rows, data-only to change, one reader). Alternatives: an `is_default` column on `entitlement_catalog` (coarser: one policy per key, cannot vary by audience); a `BASELINE_ALWAYS_ON` code union (no data change, but a deploy per policy change and invisible to `catalog-invariants`). | A new resolution layer must be added to the documented §6.1 order and to the `/me/entitlements` provenance, or the UI and API drift. | operator (product) — **proposed**; needs an ADR-0015 amendment (D37, also only proposed); no rule added here |
| Custom roles never receive a new key (`none`/`learner`)               | Notify org admins that a grant exists: compute the diff (plan ceiling − role effective set, both derived) on the role editor, badge "new since your last visit". No per-user or per-role write; a dismiss marker is per admin, not per key. Invariant: **never auto-grant into a `none` role**, never surprise-charge.                                                                                                                                                                                                                    | The diff is computed per editor load; a "seen" marker is UI state and must not become a grant store.                                 | owner #1483 (role-editor follow-up)                                                                          |
| Per-key per-role grants                                               | **Do not reintroduce a per-role key store.** Phase 7 deleted `org_role_features` for exactly this reason: every catalog addition would become an O(orgs × roles) write (522 role rows at measurement, and it grows with every seeded tenant) and break replay. If product ever wants per-role keys, model them as a **materialised exception** (like `user_feature_overrides`): explicit, enumerable, replayable — never the default path.                                                                                                | An exception store needs a writer, an audit trail and a prune story; that is a phase of its own.                                     | decided (D19/D27, restated)                                                                                  |
| Retiring at scale                                                     | Plan rows → flag → catalog row (matrix cell I's FK is the guard). Removing a default from a plan touches **no user**. Before the catalog row goes, enumerate `user_feature_overrides` rows for the key and decide per row (grant gone, revoke gone).                                                                                                                                                                                                                                                                                      | An override for a retired key that is not enumerated cascades away with the flag row — silent, so enumerate first.                   | decided (extends the retiring checklist)                                                                     |
| Rollout observability                                                 | Count inputs, never scan users: `plan_entitlements` rows for the key (plans carrying), the enabled flag row, `org_roles` grouped by `entitlement_profile` for orgs on those plans, `profiles.personal_plan_key` for personal plans, `org_seat_pools.plan_key` for seats. "Complete" = every org/user whose plan carries the key resolves it, asserted by a join on those inputs.                                                                                                                                                          | It proves reachability, not that a surface used it; product telemetry owns that.                                                     | `logyQT` (operator) — follow-up, no issue filed                                                              |
| Migration safety for the user era                                     | `on conflict … do nothing`, O(plans), never `INSERT … SELECT` over `profiles`/`org_members`. A change that genuinely needs entities is a separate, **resumable** job with a marker (batch, idempotent, observable), not inline in a migration. The plan catalogue is migration-owned (#1494), so a new key's plan rows belong in the same declarative matrix.                                                                                                                                                                             | A resumable job is real infrastructure; that is the point — it only appears when a per-entity change is genuinely needed.            | **proposed** — `logyQT` (operator); no ADR decision recorded (D37 is only proposed)                          |

**Not in scope for phase 8:** the admin "new feature available" notification and
its seen-marker store (#1483); the default-outside-any-plan layer
(`default_entitlements` or equivalent, D37 — proposed, not decided); retirement
jobs and override enumeration tooling (`logyQT`, no issue filed yet); rollout
metrics/dashboards (`logyQT`, no issue filed yet); any per-role key store. The
recommendation above is prose — if the default layer is wanted, it is an
ADR-0015 amendment (a numbered decision), not a rule smuggled into §3.

## Drift detection

- `__tests__/integration/catalog-invariants.test.ts` fails in **both** directions
  when TypeScript and the database disagree. Proven 2026-11-25 by a bogus TS key
  (`voice.bogus`, 2 assertions red) and a bogus DB row (1 assertion red), each
  reverted immediately.
- `__tests__/integration/plan-catalog.test.ts` pins the seven-plan matrix
  (scope, each plan's entitlement set and limits) and re-applies the
  owning migration twice to prove it is declarative and idempotent.
  `__tests__/unit/guards/seed-purity.test.ts` fails if any file under
  `supabase/seeds/` writes a configuration table (`permissions`,
  `subscription_plans`, `plan_entitlements`, `plan_limits`,
  `entitlement_catalog`, `entitlement_flags`, `limit_catalog`) or runs DDL —
  the second home cannot come back.
- `packages/server/src/types/database.ts` is **not** regenerated or diffed in CI
  (D36, ADR-0015 §15). It describes the schema, not catalog rows — a new key or
  plan row changes no type, so a diff gate would catch nothing this checklist
  adds. It would also need the pinned CLI and a running database in CI, and the
  phase-1a review recorded that the pinned CLI cannot reproduce the committed
  file byte-for-byte, so a strict diff would be red on `main` for reasons
  unrelated to the PR. Schema changes keep the existing manual regeneration
  step, reviewed by the integrator.
- The decidable matrix cells are covered where they can be run safely:
  **unit** — unknown keys in plan rows (personal path, load-bearing), unknown
  keys in `user_feature_overrides`, a missing flag row failing closed, an
  unknown or missing role profile resolving to `none` (cell M), and a
  plan row added between resolutions (backfill); **integration** —
  `__tests__/integration/entitlement-deploy-order.test.ts` (the plan-change
  backfill and an unknown override key against a real org/user). The catalog-row
  cells stay unit-only on purpose: `catalog-invariants` reads
  `entitlement_catalog` and runs in a parallel file, so a temporary row would be
  a cross-file race.

## Deploy-order and split-brain matrix

Measured on the served build with the key added to `hub`/`campus`/`master`; the
DB cells are row inserts/deletes, the app was never restarted. "Gate" below is
`GET /api/v1/stats/teacher/quizzes` (the surface) and "payload" is
`/api/v1/me/entitlements` for the hub-org educator. `FORBIDDEN` is `403` with
the JSON envelope and `x-error-code: FORBIDDEN`. Cell M is the exception to the
intro: it is a **unit-level** case over the resolver's fixture, not a served-app
probe.

**The rules the cells prove** — put them in the PR description:

1. **Adding a key: data may land before or after the code, and either order is
   safe.** Before the data lands the key is simply not granted (cells A, B, C);
   before the _code_ lands it is inert (cells E–G). Safe order: data first, then
   the build — the key is absent, never broken, in between.
2. **Removing a key: plan rows → flag → catalog row**; the FK refuses a
   catalog-first delete (cell I), and that refusal is the guard. The flag delete
   cascades (see "Retiring an entitlement").
3. **Data ahead of code is inert**: an unknown catalog/flag/plan/override row is
   ignored by the resolver and every entitlement reader, and the anonymous
   pricing list drops it too (cells C and E–G; #1484), not an error and not a
   crash.
4. **An unknown role profile grants nothing.** `org_roles.entitlement_profile`
   is three-valued (`all` | `learner` | `none`), and a value the code does not
   know — a migration that ships `role_v2` before the reader learns it, or a hand
   edit — must resolve as `none`, **never** as `learner`. The
   `isEntitlementProfile` guard at
   `packages/server/src/services/entitlement.resolver.ts:183` is the only thing
   deciding that (`applyProfile` takes its learner arm for any value that is not
   `all`/`none`, so a relaxed guard silently hands a role the fixed member set);
   cell M pins it, and relaxing the guard turns that case red.

| Cell | Setup                                                                                                                                                                                | Request                          | Status | Payload / behaviour                                                                                                                                                                                                                                                                                                                                                | Verdict                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| A    | **Code ahead of DB**: build has the key, no DB rows                                                                                                                                  | gate                             | `403`  | absent; payload `200` with the six existing keys, same order; `/me/permissions`, `/me/plan`, `/flashcards`, `/questions/banks`, `/teacher/quizzes`, health all `200`; UI: heading + plan card, no table, no error state, 0 page errors; 0 unhandled rejections in the server log                                                                                   | pass — fails closed, no crash     |
| B    | Catalog row only (no flag, no plan rows)                                                                                                                                             | gate                             | `403`  | absent; `200` six keys. A plan row without a flag row is refused by `plan_entitlements_entitlement_key_flag_fkey` (`23503`), so the resolver's missing-flag branch is the second line of defence (unit-tested)                                                                                                                                                     | pass                              |
| C    | Flag row present, `is_enabled = false`, plan rows present                                                                                                                            | gate                             | `403`  | absent; `200` six keys; UI plan card. The anonymous pricing payload drops the key too: the public read applies the same flag gate, so a kill-switched key is absent from `/subscription-plans` (`0 of 13` plans with `quiz.templates` disabled, `6` after the restore; #1484)                                                                                      | pass — kill switch (D8)           |
| D    | Plan row missing from the org's plan                                                                                                                                                 | gate                             | `403`  | absent; `200` six keys; UI plan card. Insert the plan row → **next request, no restart**: gate `200`, payload gains `voice.notes`, UI renders the table                                                                                                                                                                                                            | pass — derived, no prune job      |
| E    | **DB ahead of code**: unknown key `voice.notes.dbonly` in catalog + flag, no plan row                                                                                                | all reads                        | `200`  | unknown key **absent** from the payload; every endpoint `200`; health `200`; no `500`; the gate is `403` because no plan row grants anything. Inertness runs both ways here: with no plan row the anonymous pricing list has nothing to render, and G shows that the plan row does not advertise it either                                                         | pass — ignored by the resolver    |
| F    | G + `user_feature_overrides` row for the unknown key                                                                                                                                 | gate                             | `200`  | unchanged: the override is ignored (the TS catalog filters it), no crash                                                                                                                                                                                                                                                                                           | pass                              |
| G    | E + a `plan_entitlements` row for the unknown key                                                                                                                                    | gate                             | `200`  | unchanged: the resolver drops the row, so the payload stays the six keys. The anonymous pricing payload does **not** list it: the public read drops a key `isEntitlementKey` does not know, so a DB-ahead key stays off `/subscription-plans` until the code catches up (#1484); measured `0 of 13` plans advertise `voice.probe`                                  | pass                              |
| H    | Catalog row whose `quota_limit_key` names no limit                                                                                                                                   | insert                           | ref.   | `23503` `entitlement_catalog_quota_limit_key_fkey` — the DB refuses it, never the app                                                                                                                                                                                                                                                                              | pass — integrity guard            |
| I    | Retire: delete the catalog row while plan rows reference it                                                                                                                          | delete                           | ref.   | `23503` `plan_entitlements_entitlement_key_fkey` — the FK is the retirement guard (measured again after the earlier run)                                                                                                                                                                                                                                           | pass                              |
| J    | `revoke select on public.entitlement_flags from authenticated`                                                                                                                       | entitlements / gate              | `403`  | `/me/entitlements` `403 FORBIDDEN`, `/me/plan` `403`, gate `403`; `/me/permissions`, `/teacher/quizzes`, `/flashcards`, `/questions/banks`, health `200`; grant restored (`has_table_privilege('authenticated', …, 'select') = true`). A failed resolver-input read fails the whole resolution closed (#1435) — controlled, JSON, server alive; no `500`, no crash | pass — fail closed                |
| K    | UI for A/B/C/D (Playwright on `/edu/stats/quizzes`)                                                                                                                                  | page                             | `200`  | plan card replaces the table, "Zobacz plany" present, no error toast, no page error; the gated read is not requested. A direct API call is `403`, never `404`. After the plan row returns (D), the page renders the table without reload                                                                                                                           | pass                              |
| L    | Anonymous pricing, with and without the key                                                                                                                                          | `GET /subscription-plans` (anon) | `200`  | plans 13 both ways; `voice.notes` appears additively on `hub`/`master`/`campus`; no anon `403`; after removal the entry is gone                                                                                                                                                                                                                                    | pass                              |
| M    | **Role profile unknown or absent**: `org_roles.entitlement_profile = 'role_v2'` (a future value, or a hand edit), and separately the membership's role embed missing, on a `hub` org | resolution                       | `200`  | resolved entitlements exactly `[]`, no throw. The learner fallback would have yielded `ai.chat`, `flashcards`, `quiz`, `branding` (the four `LEARNER_ENTITLEMENTS` keys the hub ceiling carries), which is the fail-open shape the case excludes. **Unit-level** (`__tests__/unit/services/entitlement.resolver.test.ts`), not a served-app measurement            | pass — unit case, mutation-proved |

How the FK and privilege cells were probed: H and I are a direct `insert`/`delete`
on the table the cell names (the message carries the code and constraint), and J
is the two-line `revoke`/`grant` pair above with the grant checked by
`select has_table_privilege('authenticated', 'public.entitlement_flags',
'select');`. The exact `--find`/`--replace` pair behind each mutation proof is in
[role-authority-plan.md](role-authority-plan.md#phase-8--extendability-release-gate).

Mutation proofs (`bun run mutate`, tree clean). All four end **KILLED**:

- delete the `isEntitlementKey` filter on `plan_entitlements` rows → **KILLED**
  (`TypeError: Cannot read properties of undefined (reading 'category')`).
  Finding: the mutation first **SURVIVED** against the pre-existing
  "ignores non-catalog keys in plan rows" assertion, because with profile `all`
  the resolver iterates the catalog and only checks ceiling membership — that
  assertion could not distinguish a removed filter. The guard was rewritten on
  the personal-plan path (outside an org the personal layer adds every row, and
  the flag pass dereferences `ENTITLEMENTS[key]`, which is exactly cell E's
  crash); the profile-`all` case stays as a separate test that states what it
  pins.
- make a missing flag row default to enabled (`!== true` → `=== false`) →
  **KILLED** (`expected ['ai.chat','flashcards',…] to deeply equal ['ai.chat','flashcards','quiz']`).
- remove a `requireEntitlement` gate from an existing surface
  (`quiz-teacher.create`) → **KILLED**: `promise resolved … instead of rejecting`
  — the controller's gated-write test was the fail-safe.
- read an unrecognised role profile as a grant (the `isEntitlementProfile` guard
  at `entitlement.resolver.ts:183` replaced by a bare `as EntitlementProfile`
  cast) → **KILLED**:
  `expected [ 'ai.chat', 'flashcards', …(2) ] to deeply equal []`. The unknown
  `role_v2` value fell through to `applyProfile`'s learner arm and the hub
  ceiling resolved the four `LEARNER_ENTITLEMENTS` keys. Cell M.

## Measured evidence (2026-11-25)

Key `voice.notes`: `surface` / `personal` / `seatEligible` / `personalPortable` /
no quota. Plans: `hub`, `campus` (org) and `master` (personal).

`/api/v1/me/entitlements` for the same hub-org educator, before and after:

```
before: ["ai.chat","flashcards","quiz","quiz.templates","stats.insights","branding"]
after:  ["ai.chat","flashcards","quiz","quiz.templates","stats.insights","branding","voice.notes"]
```

Existing keys and their order are unchanged; the diff is one appended key.

| Observation                                                             | Result                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org created **before** the key (hub), then the key applied              | same payload as a fresh org: the key appears with no backfill job                                                                                                                                                                        |
| Org created **after** the key (hub)                                     | identical payload                                                                                                                                                                                                                        |
| Plan change `launch` → `hub` on an existing org                         | key appears on the next resolution; `change_org_plan` is a plan move only, no prune job                                                                                                                                                  |
| Org on `team` (carries `quiz.templates`, not `voice.notes`)             | `/stats/teacher/quizzes` → `403 FORBIDDEN`; the page shows the plan card, the read is not fetched                                                                                                                                        |
| `team` org + personal `master` (a `personalPortable` key inside an org) | key present, `/stats/teacher/quizzes` → `200`                                                                                                                                                                                            |
| Key removed from `hub` while the user was entitled                      | payload loses it; `/stats/teacher/quizzes` → `403`; UI hides the table; `/me/entitlements`, `/me/permissions`, `/me/plan`, `/flashcards`, `/questions/banks`, `/organization/groups`, `/notifications` all stay `200` — no 404, no 500   |
| Retire with the catalog row first                                       | `23503` — `plan_entitlements_entitlement_key_fkey` refuses                                                                                                                                                                               |
| Retire with the flag row first                                          | cascades: 2 plan rows deleted silently, catalog row left                                                                                                                                                                                 |
| Catalog row deleted while the TS constant exists                        | `catalog-invariants` red (2 assertions) until the constant goes                                                                                                                                                                          |
| Re-entry while the served build still carries the constant              | catalog + flag + plan rows re-inserted → `/me/entitlements` returns the key immediately; invariants green. Data-only **because** the constant was still in the build: once the constant is gone, re-entry owes add-step 12's rebuild too |
| Admin `/feature-flags`                                                  | reads the flag table: `voice.notes` present with no admin code or rebuild                                                                                                                                                                |

### #1484 follow-up: the public pricing read (measured 2026-11-25)

On a served production build of `fix/1484-pricing-authority` (`7dd67e58`), this
checkout's stack, **anonymous** (no cookie). Cells C and G, re-measured after the
fix:

| Probe                                                                        | Result                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/subscription-plans`                                             | `200`, **13** plans                                                                                                                                                                                                                  |
| `GET /pricing`                                                               | `200`                                                                                                                                                                                                                                |
| Cell C: `quiz.templates` flag `is_enabled = false`                           | **0 of 13** plans advertise the key. `6` do before the switch and after the restore: `guide`, `team`, `creator`, `hub`, `master`, `campus`. `GET /api/v1/subscription-plans/guide` returns 2 features while off, 3 after the restore |
| Cell G: DB-ahead `voice.probe` (catalog row + enabled flag + `hub` plan row) | `200`, **13** plans, the key is absent from all of them. `hub.seatEligible` stays `false`; the unfiltered-rows property is pinned by the unit case, not by this probe (`hub` is already `false` because of `branding`)               |

The anonymous read needs the kill switch, so `anon` gained SELECT on
`entitlement_flags` with a read policy (#1484). The rogue rows were removed after
the probe and the catalogue, flag and plan-row counts returned to `0 / 0 / 0`.
