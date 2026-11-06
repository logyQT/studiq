# QA suite on one shared app + one Supabase

Status: **infrastructure up; manager and PR→manager event wiring not built yet** (see
§Manager flow). This document is the contract for the QA-suite generation loop. It replaces the old “one app + one Supabase per slot” model for
QA-suite work; the old `qa-env-1..8` stacks are kept only as fallback and are not used as
separate apps.

## Goal

Turn confirmed QA cases into durable, executable Playwright tests, using:

- **one shared app** at `http://localhost:3010`
- **one shared Supabase** at `http://localhost:54421`
- **eight browser workers** (profiles/CDP `9221–9228`)
- **one isolated tenant per case**, not one database per worker

No app/Supabase reprovisioning per case. Fresh **session** per case is fine; fresh
database is not.

## Why one app/DB is safe

The app is stateless for the paths QA exercises. Isolation comes from a unique tenant per
case:

- `tenantKey("qa/<CASEID>.md", "<test title>", "qa-shared")` → deterministic key
- `tenantId(key, entity)` → RFC-4122 UUIDv5 IDs for orgs, users, groups, decks, banks,
  quizzes, assignments
- unique emails such as `qa+<shorthash>+teacher@test.local`
- `seedTenantGraph()` from `__tests__/helpers/tenant-seed.ts` creates the org/user/group
  graph idempotently

This is the same primitive the e2e suite already uses (`__tests__/e2e/fixtures/ids.ts`,
`scripts/e2e-seed.ts`). Do not invent a QA-only ID scheme.

## Hard rule — one worker, one spec, never the suite

Nobody in this loop runs the whole suite: not the workers, not the manager. Every run is
**one spec file with `--workers=1 --repeat-each=1`**. The shared VM also hosts the app,
Supabase, the dashboard and eight browser tiles; a parallel or suite-wide run OOM-kills the
machine and takes the loop down with it. The eight "workers" are sessions that each run one
spec sequentially — they are not eight parallel Playwright processes.

## Hard limits

These still need serialization or separate fixtures:

- global admin settings, feature flags, platform stats, plan catalog, singleton rows
- destructive migrations / schema changes: one shared DB cannot run 16 different PR
  schemas at once
- rate limits and quota counters that are global rather than tenant-scoped

For those, use one of: a dedicated tenant fixture, `test.describe.serial`, a separate
one-off env, or the old slot stack. Do not let 16 workers mutate the same singleton.

## Testcases and accounts

- Case ID is the existing `qa/cases/<CASEID>.md` ID (`PUB-01`, `STU-42`, …).
- Never use the legacy manual accounts (`manager@dev.local`, `student1@dev.local`, …)
  in an automated QA test. Use the per-case tenant users.
- The only exception is a test that explicitly verifies the legacy seed dataset; mark it
  clearly and do not let it depend on mutable state.
- Test file: `__tests__/qa/<AREA>/<CASEID>.spec.ts`.
- The test must derive all IDs from its tenant fixture; no hard-coded UUIDs or shared
  org/group names.
- Default password for seeded fixture users is `Seed4Test!` (from `tenant-seed.ts`);
  do not use `pass` for new fixtures.

## Asserting user-visible copy

Specs assert the **literal** string the case specifies (usually Polish), and they do **not**
resolve labels from `apps/web/src/i18n/messages/*.json`. Resolving from the app's own catalogue
would compare the app against itself: it can no longer catch a missing translation, a wrong
string, or a hard-coded English leak — which is exactly what NFR-01 exists to catch. The literal
is the contract, so hard-coded copy in a spec is **not** a review finding on its own.

The one exception is a **locale-parity sweep** (NFR-01, NFR-02), where the subject under test is
that both catalogues agree; there the messages are imported on purpose, for both locales.

What _is_ a finding: a literal the case does not specify, or literal copy used as a _selector_
where a role/`data-slot` locator would be stable.

## Worker flow (one case per fresh session)

1. Read `qa/cases/<CASEID>.md` and its prereqs.
2. **Reconcile the case with the seeder.** The cases were written against the legacy manual
   seed (`student1@dev.local`, `O1G1`, …). Rewrite the case's `Prereqs`/`Seed` block to the
   tenant model: the case's own tenant (`tenantKey("<CASEID>", …)`), its users, and the
   `bare`/`content` profile it needs. Keep the human observations; commit this case edit
   together with the spec.
3. Seed a tenant for the case (same deterministic key, fresh run suffix if needed).
4. **Walk the case yourself first.** In the assigned browser tile, against the shared app,
   execute every step of the case as a tester would: note the real screens, states, copy and
   selectors, and anything that contradicts the case text.
5. **If the walk shows the product does not do what the case says** — a failure, an
   ambiguous result, or any point where you cannot be sure what the correct behavior is:
   **stop. Do not write a failing, skipped or "expected to fail" test.** You cannot encode
   a behavior you have not confirmed. Instead:
   - open an issue: case ID, expected vs observed, the tenant key, evidence (screenshot,
     response, log);
   - say what is ambiguous, if it is a judgement call rather than a plain defect;
   - do **not** open the PR, do **not** try to fix the product, do **not** leave a placeholder
     spec behind.
     Issues are triaged in a separate batch, not by the worker.
6. Write the Playwright spec against the behavior you confirmed in the walk, using the
   tenant fixture.
7. Run it **five independent times**, each with a fresh tenant/run suffix:
   - `bunx playwright test __tests__/qa/<AREA>/<CASEID>.spec.ts --workers=1 --repeat-each=1`
   - no `test.skip`, `test.fixme`, `test.soft`, or expected-failure wrappers
8. Only if **5/5 runs are green**:
   - branch from `qa-suite` as `qa/<CASEID>`
   - commit the spec + the reconciled case + any fixture changes
   - open a PR **into `qa-suite`**, not `main`
9. If any run fails, is flaky, needs a manual step, or depends on shared mutable data:
   report it and do **not** add the test to the suite (step 5 applies).

## Manager flow (not started yet)

The manager starts fresh sessions, one per case, on the eight workers. It does **not**
start/stop the shared app or Supabase, and it does not provision per-worker stacks.

**Intended event path — not built yet.** When a worker opens a PR into `qa-suite`, a watcher
fires an event at the manager; the manager re-runs the spec five times from a clean tenant
and merges only if that re-run is green. Today dispatch is manual (`!suite <CASEID>`), and the
`qa/tools/qa-manager.py` referenced below does not exist on this branch — until both land,
treat dispatch and merging as manual, operator-driven steps.

It assigns:

- one case per worker
- one browser/CDP profile per worker
- the shared `APP_URL`/`SUPABASE_URL`

It admits a PR only when all are true:

1. worker reports **5/5 green independent runs**;
2. no skip/fixme/soft/expected-failure;
3. no legacy `@dev.local`/`pass` accounts;
4. test uses a per-case tenant and deterministic IDs;
5. no shared global mutation or order dependency;
6. the test asserts **intended** behavior, not current broken behavior;
7. re-run by the manager from a clean tenant is green.

Only then merge into `qa-suite`. A test that is expected to fail until a bug is fixed is
**not** a suite test: the worker opens an issue and leaves no spec behind. The issue is
triaged later, and the test is written only once the behavior is confirmed — never a
failing test that encodes a guess.

## Suite layout / CI

Proposed:

```text
__tests__/qa/
  PUB/  AUT/  ONB/  STU/  EDU/  MGR/
qa/fixtures/qa-tenant.ts     # reuses e2e tenantKey/seedTenantGraph
qa/playwright.qa.config.ts   # testDir __tests__/qa, chromium only
```

Split the GitHub job by area (or Playwright project), e.g.:

```text
qa-pub, qa-aut, qa-onb, qa-stu, qa-edu, qa-mgr
```

The existing `.github/workflows/verify.yml` already has `checks → unit → integration →
e2e` and a `chromium|firefox` matrix. Add QA as a separate matrix; keep `qa-suite` as
the integration branch until the suite is stable. WebKit remains blocked.

## Current shared infrastructure

- App: `http://localhost:3010` (qa-env-1 app)
- Supabase: `http://localhost:54421` (qa-env-1 DB)
- Browser tiles: `9221–9228` (one per worker)
- Dashboard: `http://localhost:5000`
- `qa-env-2..8/qa/env.json` point at the shared app/DB; their own app/Supabase remain down.
- Supervisor is paused so it cannot restart the seven unused app stacks.
- Discord/manager sessions are not started.

## Next step

Pick one small suite (PUB is the safest) and run 2–3 cases through this loop manually.
Only add specs after 5/5 green runs. Then wire the QA Playwright project and the CI matrix.

## Branch protection and CodeRabbit

- `qa-suite` is the integration branch. **Agents never commit to it directly.**
- Every case gets its own branch: `qa/<CASEID>`.
- Every change reaches `qa-suite` through a PR.
- PR title format: `[QA-SUITE] <CASEID> <short description>`.
- `.coderabbit.yaml` ignores the `[QA-SUITE]` title keyword, so the QA-suite noise
  does not consume a review; normal product PRs continue to be reviewed.

## Dispatching a worker

From Discord (`#manager` or an env channel), or on the box:

```text
!suite PUB-01            # first free worker
!suite PUB-01 --env 3    # a specific worker
python3 qa/tools/qa-manager.py suite PUB-01 --dry-run
```

The dispatcher creates a fresh session in that workers

## Dispatching a worker

From Discord (`#manager` or an env channel), or on the box:

```text
!suite PUB-01            # first free worker
!suite PUB-01 --env 3    # a specific worker
python3 qa/tools/qa-manager.py suite PUB-01 --dry-run
```

The dispatcher creates a fresh session in that worker's worktree with the
`QA-SUITE-WORKER.md` prompt filled in (`CASE_ID`, worker, CDP port, shared app,
shared Supabase), and titles it `[QA-SUITE] <CASEID> — qa-env-N`. It does not
create branches or start app/DB stacks; the worker does that.

`!run <ID>` remains the manual, report-only QA dispatch. `!suite` is the
suite-generation dispatch.
