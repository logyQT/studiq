# QA suite on one shared app + one Supabase

Status: **infrastructure up, manager not started**. This document is the contract for the
QA-suite generation loop. It replaces the old “one app + one Supabase per slot” model for
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
- Test file: `qa/tests/<AREA>/<CASEID>.spec.ts`.
- The test must derive all IDs from its tenant fixture; no hard-coded UUIDs or shared
  org/group names.
- Default password for seeded fixture users is `Seed4Test!` (from `tenant-seed.ts`);
  do not use `pass` for new fixtures.

## Worker flow (one case per fresh session)

1. Read `qa/cases/<CASEID>.md` and its prereqs.
2. Seed a tenant for the case (same deterministic key, fresh run suffix if needed).
3. Start from the shared app URL; use the assigned browser profile/CDP port.
4. Write the Playwright spec against intended behavior, using the tenant fixture.
5. Run it **three independent times**, each with a fresh tenant/run suffix:
   - `bunx playwright test qa/tests/<AREA>/<CASEID>.spec.ts --workers=1 --repeat-each=1`
   - no `test.skip`, `test.fixme`, `test.soft`, or expected-failure wrappers
6. Only if **3/3 runs are green**:
   - branch from `qa-suite` as `qa/<CASEID>`
   - commit the spec + any fixture changes
   - open a PR **into `qa-suite`**, not `main`
7. If any run fails, is flaky, needs a manual step, or depends on shared mutable data:
   report it and do **not** add the test to the suite.

## Manager flow (not started yet)

The manager starts fresh sessions, one per case, on the eight workers. It does **not**
start/stop the shared app or Supabase, and it does not provision per-worker stacks.

It assigns:

- one case per worker
- one browser/CDP profile per worker
- the shared `APP_URL`/`SUPABASE_URL`

It admits a PR only when all are true:

1. worker reports **3/3 green independent runs**;
2. no skip/fixme/soft/expected-failure;
3. no legacy `@dev.local`/`pass` accounts;
4. test uses a per-case tenant and deterministic IDs;
5. no shared global mutation or order dependency;
6. the test asserts **intended** behavior, not current broken behavior;
7. re-run by the manager from a clean tenant is green.

Only then merge into `qa-suite`. A test that is expected to fail until a bug is fixed is
**not** a suite test; it stays a repro/issue until the fix lands and the test is green.

## Suite layout / CI

Proposed:

```text
qa/tests/
  PUB/  AUT/  ONB/  STU/  EDU/  MGR/
qa/fixtures/qa-tenant.ts     # reuses e2e tenantKey/seedTenantGraph
qa/playwright.qa.config.ts   # testDir qa/tests, chromium only
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
Only add specs after 3/3 green runs. Then wire the QA Playwright project and the CI matrix.

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
