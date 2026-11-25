# Extending and retiring an entitlement

**Status:** normative, measured 2026-11-25 (ADR-0015 phase 8, D23).
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

| #   | Step                                                                                                                                                                                        | Where                                                        | Layer          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------- |
| 1   | Fix the metadata: `category` (`baseline`/`surface`), `scope`, `seatEligible`, `personalPortable`, `quota`. `baseline` is never gated; a personal key inside an org needs `personalPortable` | decision, then the two catalogs                              | —              |
| 2   | Append the key to `ENTITLEMENTS` (never reorder: declaration order is `/me/entitlements` order)                                                                                             | `packages/authz/src/entitlements.ts`                         | code           |
| 3   | One `entitlement_catalog` row with the same metadata                                                                                                                                        | migration                                                    | data           |
| 4   | One **enabled** `entitlement_flags` row — a missing row fails the resolver closed                                                                                                           | migration                                                    | data           |
| 5   | `plan_entitlements` rows for the plans that should carry it                                                                                                                                 | migration, **and** `supabase/seeds/00_plans.sql` (see below) | data           |
| 6   | Grants and policies: **none**. `authenticated` already has table-level `SELECT` and the catalog policies are `using (true)`; a new row is readable like the existing ones                   | —                                                            | —              |
| 7   | One `requireEntitlement(ctx, key)` on the surface, first statement before the permission check and the parse                                                                                | the surface's controller                                     | code           |
| 8   | The surface's disabled state: `useEntitlement()(key)` plus copy, only if the page needs one. The generic `ErrorState` is not a product denial                                               | the page + `apps/web/src/i18n/messages/{pl,en}.json`         | code           |
| 9   | Admin panel: nothing. `/feature-flags` reads `entitlement_flags` live; the row appears on reload                                                                                            | —                                                            | data           |
| 10  | Tenant/QA fixture: seed the case on a plan that carries the key (`bun scripts/qa-tenant.ts <CASE> --plan <plan>`)                                                                           | `qa/.tenants/**` (generated)                                 | data (fixture) |
| 11  | Tests: `catalog-invariants` already pins TS `ENTITLEMENTS` to `entitlement_catalog` and every surface key to a flag row; nothing new to write                                               | `__tests__/integration/catalog-invariants.test.ts`           | —              |
| 12  | Deploy: apply the migration to the running database (`supabase migration up` / `db push`), then **rebuild and restart the app** — the TS constant is baked into the build                   | deploy                                                       | both           |

Measured cost for the whole simulation: **one migration + one catalog constant +
one surface call**, plus the surface's own UI copy. Resolver change: **none**.
The migration applied to the live database with no restart; `/me/entitlements`
gained the key after the app rebuild only, because the DB row alone is inert
until the TS catalog knows the key (step 12 is not optional).

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

### The second data home: the dev seed

`supabase/seeds/00_plans.sql` **deletes** every `plan_entitlements` row and
re-inserts a hard-coded plan list, so a migration-added plan row does not survive
`supabase db reset`. This is dev-only: production applies migrations (`db push`)
and never runs the seeds. Until the seed derives its plan rows from one list,
add the row in both places — it is data for data, not a code change forced by a
data change. Owner: the integrator/ops who own `supabase/seeds/**`.

Measured on a fresh reset (the two replay shapes):

- migration + **seed edit** → catalog 1, flag 1, **plan rows 3**; the migration's
  closing guard passes;
- migration + **no seed edit** → catalog 1, flag 1, **plan rows 0** — the key
  reaches nobody, and nothing fails, so the loss is silent.

A corollary the first draft got wrong: a migration that inserts plan rows must
be **conditional on the plan existing** and must assert "one row per plan that
exists at this point", not a hard-coded count. On a fresh reset the migration
runs _before_ the seed creates `subscription_plans`, so an unconditional insert
is a foreign-key error and an unconditional `count = 3` guard fails the whole
reset. That is a real trap in the current shape, not a simulation artefact.

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
   exist without a catalog row (red).
6. **Remove the surface UI branch and its copy** if the surface is gone — code.
7. **Clients narrow on their next authority event.** There is no push channel:
   `invalidateAuthority` (org switch, role save, seat change, checkout, plan
   change) drops `entitlementKeys.all`, and `useEntitlements` refetches on focus
   after 60 s. A data-only removal performed behind the app's back is invisible
   until one of those happens, which is by design.

`documents` is the model for all of this: absent until its surface ships, and
re-entry is the adding checklist (minus the surface call until the surface
exists) — catalog + flag + plan rows, no resolver change (D22).

## Steps that are still code

| Step                                           | Why it cannot be data-only                                                                                                                                                                                                      | Owner            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| The `ENTITLEMENTS` entry                       | the resolver drops any `plan_entitlements`/`catalog` key `isEntitlementKey` does not know. Measured: with the DB rows applied and the old build serving, `/me/entitlements` was unchanged; after the rebuild it gained the key. | the surface's PR |
| The surface call and its UI/denial copy        | the surface itself is code. Nothing in the entitlement layer needs touching                                                                                                                                                     | the surface's PR |
| The plan rows in `supabase/seeds/00_plans.sql` | dev-only second data home (see above) — data for data, not code for data                                                                                                                                                        | integrator/ops   |
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
catalog rows, not entity rows. Resolution is a per-request composition
(`entitlement.resolver.ts`), so the write set is:

| Table                 | Rows per new default  | Multiplier                                            |
| --------------------- | --------------------- | ----------------------------------------------------- |
| `entitlement_catalog` | 1                     | —                                                     |
| `entitlement_flags`   | 1                     | surface keys only (baseline keys are never gated, D9) |
| `plan_entitlements`   | one per carrying plan | ~5 today (hub, campus, master in the simulation)      |
| `limit_catalog`       | 0–1                   | only a key with a **new** quota limit                 |
| `plan_limits`         | one per carrying plan | only that new limit key                               |

**Zero** rows in `profiles`, `org_members`, `org_roles`,
`org_roles`-adjacent stores or `org_seat_assignments`. The row populations those
would touch today (the QA tenants on this stack): `org_roles` **193**,
`org_members` **192**. Seeding one row per entity would be O(orgs × roles) for
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

| Question                                                              | Recommended direction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Trade-off                                                                                                                            | Owner / status                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| How does a new default reach existing orgs/users?                     | **Derived.** Catalog + flag + plan rows only. Do not write per-org or per-user rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A plan that does not carry the key silently does not grant it — that is the contract, not a gap.                                     | decided (this doc, D22/D36-adjacent)                                                     |
| A key that must be default **outside any plan** (free safety feature) | No layer exists today: `category: 'baseline'` is pricing display only and never grants — `flashcards`/`quiz` are baseline _and_ on every plan. Preferred: a `default_entitlements(audience, key)` table read as one extra resolver layer (bounded rows, data-only to change, one reader). Alternatives: an `is_default` column on `entitlement_catalog` (coarser: one policy per key, cannot vary by audience); a `BASELINE_ALWAYS_ON` code union (no data change, but a deploy per policy change and invisible to `catalog-invariants`). | A new resolution layer must be added to the documented §6.1 order and to the `/me/entitlements` provenance, or the UI and API drift. | operator (product) — **proposed**, needs an ADR-0015 amendment (D37); no rule added here |
| Custom roles never receive a new key (`none`/`learner`)               | Notify org admins that a grant exists: compute the diff (plan ceiling − role effective set, both derived) on the role editor, badge "new since your last visit". No per-user or per-role write; a dismiss marker is per admin, not per key. Invariant: **never auto-grant into a `none` role**, never surprise-charge.                                                                                                                                                                                                                    | The diff is computed per editor load; a "seen" marker is UI state and must not become a grant store.                                 | role-editor owner — follow-up                                                            |
| Per-key per-role grants                                               | **Do not reintroduce a per-role key store.** Phase 7 deleted `org_role_features` for exactly this reason: every catalog addition would become an O(orgs × roles) write (193 rows today) and break replay. If product ever wants per-role keys, model them as a **materialised exception** (like `user_feature_overrides`): explicit, enumerable, replayable — never the default path.                                                                                                                                                     | An exception store needs a writer, an audit trail and a prune story; that is a phase of its own.                                     | decided (D19/D27, restated)                                                              |
| Retiring at scale                                                     | Plan rows → flag → catalog row (matrix cell I's FK is the guard). Removing a default from a plan touches **no user**. Before the catalog row goes, enumerate `user_feature_overrides` rows for the key and decide per row (grant gone, revoke gone).                                                                                                                                                                                                                                                                                      | An override for a retired key that is not enumerated cascades away with the flag row — silent, so enumerate first.                   | decided (extends the retiring checklist)                                                 |
| Rollout observability                                                 | Count inputs, never scan users: `plan_entitlements` rows for the key (plans carrying), the enabled flag row, `org_roles` grouped by `entitlement_profile` for orgs on those plans, `profiles.personal_plan_key` for personal plans, `org_seat_pools.plan_key` for seats. "Complete" = every org/user whose plan carries the key resolves it, asserted by a join on those inputs.                                                                                                                                                          | It proves reachability, not that a surface used it; product telemetry owns that.                                                     | integrator — follow-up                                                                   |
| Migration safety for the user era                                     | `on conflict … do nothing`, O(plans), never `INSERT … SELECT` over `profiles`/`org_members`. A change that genuinely needs entities is a separate, **resumable** job with a marker (batch, idempotent, observable), not inline in a migration. Remember migrations run **before** the dev seed, which deletes `plan_entitlements`.                                                                                                                                                                                                        | A resumable job is real infrastructure; that is the point — it only appears when a per-entity change is genuinely needed.            | integrator/ops — decided                                                                 |

**Not in scope for phase 8:** the admin "new feature available" notification and
its seen-marker store; the default-outside-any-plan layer (`default_entitlements`
or equivalent); retirement jobs and override enumeration tooling; rollout
metrics/dashboards; any per-role key store. The recommendation above is prose —
if the default layer is wanted, it is an ADR-0015 amendment (a numbered
decision), not a rule smuggled into §3.

## Drift detection

- `__tests__/integration/catalog-invariants.test.ts` fails in **both** directions
  when TypeScript and the database disagree. Proven 2026-11-25 by a bogus TS key
  (`voice.bogus`, 2 assertions red) and a bogus DB row (1 assertion red), each
  reverted immediately.
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
  keys in `user_feature_overrides`, a missing flag row failing closed, and a
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
the JSON envelope and `x-error-code: FORBIDDEN`.

**The rules the cells prove** — put them in the PR description:

1. **Adding a key: data may land before or after the code, and either order is
   safe.** Before the data lands the key is simply not granted (cells A, B, C);
   before the _code_ lands it is inert (cells E–G). Safe order: data first, then
   the build — the key is absent, never broken, in between.
2. **Removing a key: plan rows → flag → catalog row**; the FK refuses a
   catalog-first delete (cell I), and that refusal is the guard. The flag delete
   cascades (see "Retiring an entitlement").
3. **Data ahead of code is inert**: an unknown catalog/flag/plan/override row is
   ignored by every reader (cells E–G), not an error and not a crash.

| Cell | Setup                                                                           | Request                          | Status | Payload / behaviour                                                                                                                                                                                                                                                                                                                                                | Verdict                        |
| ---- | ------------------------------------------------------------------------------- | -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| A    | **Code ahead of DB**: build has the key, no DB rows                             | gate                             | `403`  | absent; payload `200` with the six existing keys, same order; `/me/permissions`, `/me/plan`, `/flashcards`, `/questions/banks`, `/teacher/quizzes`, health all `200`; UI: heading + plan card, no table, no error state, 0 page errors; 0 unhandled rejections in the server log                                                                                   | pass — fails closed, no crash  |
| B    | Catalog row only (no flag, no plan rows)                                        | gate                             | `403`  | absent; `200` six keys. A plan row without a flag row is refused by `plan_entitlements_entitlement_key_flag_fkey` (`23503`), so the resolver's missing-flag branch is the second line of defence (unit-tested)                                                                                                                                                     | pass                           |
| C    | Flag row present, `is_enabled = false`, plan rows present                       | gate                             | `403`  | absent; `200` six keys; UI plan card                                                                                                                                                                                                                                                                                                                               | pass — kill switch (D8)        |
| D    | Plan row missing from the org's plan                                            | gate                             | `403`  | absent; `200` six keys; UI plan card. Insert the plan row → **next request, no restart**: gate `200`, payload gains `voice.notes`, UI renders the table                                                                                                                                                                                                            | pass — derived, no prune job   |
| E    | **DB ahead of code**: unknown key `voice.notes.dbonly` in catalog + flag + plan | gate / all reads                 | `200`  | unknown key **absent** from the payload; every endpoint `200`; health `200`; no `500`. Observation: the anonymous pricing payload _does_ list it — `/subscription-plans` reads `plan_entitlements` without the TS filter, so a DB-ahead key is advertised until the code catches up (a string in a list; the renderer tolerates it)                                | pass — ignored by the resolver |
| F    | E + `user_feature_overrides` row for the unknown key                            | gate                             | `200`  | unchanged: override ignored, no crash                                                                                                                                                                                                                                                                                                                              | pass                           |
| G    | E's `plan_entitlements` row for the unknown key                                 | gate                             | `200`  | unchanged (same as E)                                                                                                                                                                                                                                                                                                                                              | pass                           |
| H    | Catalog row whose `quota_limit_key` names no limit                              | insert                           | ref.   | `23503` `entitlement_catalog_quota_limit_key_fkey` — the DB refuses it, never the app                                                                                                                                                                                                                                                                              | pass — integrity guard         |
| I    | Retire: delete the catalog row while plan rows reference it                     | delete                           | ref.   | `23503` `plan_entitlements_entitlement_key_fkey` — the FK is the retirement guard (measured again after the earlier run)                                                                                                                                                                                                                                           | pass                           |
| J    | `revoke select on public.entitlement_flags from authenticated`                  | entitlements / gate              | `403`  | `/me/entitlements` `403 FORBIDDEN`, `/me/plan` `403`, gate `403`; `/me/permissions`, `/teacher/quizzes`, `/flashcards`, `/questions/banks`, health `200`; grant restored (`has_table_privilege('authenticated', …, 'select') = true`). A failed resolver-input read fails the whole resolution closed (#1435) — controlled, JSON, server alive; no `500`, no crash | pass — fail closed             |
| K    | UI for A/B/C/D (Playwright on `/edu/stats/quizzes`)                             | page                             | `200`  | plan card replaces the table, "Zobacz plany" present, no error toast, no page error; the gated read is not requested. A direct API call is `403`, never `404`. After the plan row returns (D), the page renders the table without reload                                                                                                                           | pass                           |
| L    | Anonymous pricing, with and without the key                                     | `GET /subscription-plans` (anon) | `200`  | plans 13 both ways; `voice.notes` appears additively on `hub`/`master`/`campus`; no anon `403`; after removal the entry is gone                                                                                                                                                                                                                                    | pass                           |

Mutation proofs (`bun run mutate`, tree clean). All three end **KILLED**:

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
  (`quiz-teacher.create`) → **KILLED** (`promise resolved … instead of
rejecting`; the controller's gated-write test was the fail-safe).

## Measured evidence (2026-11-25)

Key `voice.notes`: `surface` / `personal` / `seatEligible` / `personalPortable` /
no quota. Plans: `hub`, `campus` (org) and `master` (personal).

`/api/v1/me/entitlements` for the same hub-org educator, before and after:

```
before: ["ai.chat","flashcards","quiz","quiz.templates","stats.insights","branding"]
after:  ["ai.chat","flashcards","quiz","quiz.templates","stats.insights","branding","voice.notes"]
```

Existing keys and their order are unchanged; the diff is one appended key.

| Observation                                                             | Result                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org created **before** the key (hub), then the key applied              | same payload as a fresh org: the key appears with no backfill job                                                                                                                                                                      |
| Org created **after** the key (hub)                                     | identical payload                                                                                                                                                                                                                      |
| Plan change `launch` → `hub` on an existing org                         | key appears on the next resolution; `change_org_plan` is a plan move only, no prune job                                                                                                                                                |
| Org on `team` (carries `quiz.templates`, not `voice.notes`)             | `/stats/teacher/quizzes` → `403 FORBIDDEN`; the page shows the plan card, the read is not fetched                                                                                                                                      |
| `team` org + personal `master` (a `personalPortable` key inside an org) | key present, `/stats/teacher/quizzes` → `200`                                                                                                                                                                                          |
| Key removed from `hub` while the user was entitled                      | payload loses it; `/stats/teacher/quizzes` → `403`; UI hides the table; `/me/entitlements`, `/me/permissions`, `/me/plan`, `/flashcards`, `/questions/banks`, `/organization/groups`, `/notifications` all stay `200` — no 404, no 500 |
| Retire with the catalog row first                                       | `23503` — `plan_entitlements_entitlement_key_fkey` refuses                                                                                                                                                                             |
| Retire with the flag row first                                          | cascades: 2 plan rows deleted silently, catalog row left                                                                                                                                                                               |
| Catalog row deleted while the TS constant exists                        | `catalog-invariants` red (2 assertions) until the constant goes                                                                                                                                                                        |
| Re-entry, data-only, no rebuild                                         | catalog + flag + plan rows re-inserted → `/me/entitlements` returns the key immediately; invariants green                                                                                                                              |
| Admin `/feature-flags`                                                  | reads the flag table: `voice.notes` present with no admin code or rebuild                                                                                                                                                              |
