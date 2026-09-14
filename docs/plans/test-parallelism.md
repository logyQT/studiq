# Task: Full test parallelism + 3× concurrent self-stress (research first, then implement)

> Handoff prompt for the next agent. Phase A (API-first `before()` migration) is complete
> on `dev` at commit `080fdb3` — see `docs/plans/foundation-agentic-testing.md`. This task
> is standalone: enable parallelism and prove isolation.

## Goal

Integration tests must run, in a single normal invocation:

- **File parallelism ON** (`fileParallelism: true`) — test files run concurrently.
- **In-file concurrency ON** (`sequence.concurrent: true`) — tests within a file run concurrently.
- **Every test case runs 3 times SIDE BY SIDE** — i.e., test case #01 executes as
  **3 concurrent copies of itself at the same time**, and so does every other test.
  This is a permanent part of the run, not a one-off verification flag.

The point of the 3× self-parallelism: in ONE run you prove that tests are 100% isolated
(3 copies of the same test share no mutable state) and that tests are not flaky — any
state collision or order dependence surfaces immediately, in a single pass.

Concurrency cap: effectively unlimited is fine; capping at the machine's logical CPU
count is also acceptable. Decide deliberately, document it, don't default to 1/3/5
arbitrarily (Vitest's default `maxConcurrency: 5` is not what "3× side by side" means).

When flakes appear (they WILL): debug each to the root cause and fix it. Do not mask,
retry-hack, or weaken assertions to make the stress pass.

## What "3× side by side" is NOT

- NOT `--repeat` — Vitest's `--repeat` runs replicas sequentially, which proves nothing
  about isolation. Do not use it.
- NOT `maxConcurrency: 3` — that's a global concurrency cap, a different concept.
- NOT retries (`retry` config reruns failures, again sequentially).

There is no built-in Vitest feature for "each test, 3 concurrent copies". You must
research and build the mechanism yourself (see Implementation below).

## Current state (verified)

- Repo: StudiQ (Bun + Next.js 16 + real local Supabase).
- `vitest.config.ts` currently sets `fileParallelism: false` and `sequence.concurrent: false`
  (deliberate, now outdated). No `it.concurrent`/`maxConcurrency`/`poolOptions` anywhere yet.
- Integration tests hit a real local Supabase (`db reset` + seeds; seeds set
  `organizations.plan` default `'launch'`).
- `__tests__/setup.ts`: `vi.mock('@/lib/supabase/server')` wraps `createClient` as
  `vi.fn(actual.createClient)`; integration tests call `useRealSupabase()` (defined in
  `__tests__/integration/helpers.ts`) to hit the real DB. Investigate whether this mock
  state is worker-scoped or module-scoped — a top flake source under concurrency.
- Units mock Supabase (`__tests__/mocks/supabase.ts`, `__tests__/helpers/supabase-mock.ts`).
- Env via `loadEnv(mode, cwd, '')` — `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from `.env`).
- `bun test:integration` = `vitest run __tests__/integration` — 19 files / 186 tests,
  green at `080fdb3` on `dev` only because everything runs sequentially today.

## Research first (before any config change)

1. Read EVERY suite in `__tests__/integration/` + the helpers
   (`helpers.ts`, `__tests__/helpers/test-user.ts`, `test-utils.ts`). Per suite, inventory:
   shared DB state it creates (orgs/users/banks/questions/seats/invites…), naming patterns
   and prefixes, what cleanup deletes and at which scope, and any within-file order dependence.
2. Confirm Vitest semantics: `fileParallelism`, `sequence.concurrent`, `maxConcurrency`,
   `pool`/`poolOptions` (threads vs forks), and how shared module/mock state behaves across
   concurrently running tests in the same worker. Confirm what a per-file concurrency cap
   would mean; you may choose `maxConcurrency` = logical CPUs.
3. Design the 3× side-by-side mechanism. Ideas to evaluate (pick or improve, justify):
   - A harness that registers each `it()` as 3 `it.concurrent` copies (e.g., wrap test
     registration via a helper or a small transform).
   - Running the full suite 3 times concurrently in 3 separate `vitest` processes against
     the same Supabase — valid only if test data is globally unique per process AND the DB
     can take the load; document the trade-off. NOTE: with a shared real DB, 3 processes
     stress uniqueness constraints hard (token/name/seat uniqueness) — that's the point, but
     verify it's tractable; prefer the in-run harness if process-level chaos is too noisy.
   - Keep 3 copies of the same test from sharing ANY fixture (each copy needs its own
     org/user/names — randomized per copy, cleaned up by that copy).
4. Write a short isolation plan: every cross-test dependency found + exactly how you break it.

## Known hazards (from the migration that just landed — re-verify, don't trust blindly)

- **Shared prefixes across suites**: many suites use `before()` → orgs `seed-org-*`, and
  several `afterAll` call `cleanupOrganizationByName('seed-org-')` — parallel files can
  delete each other's orgs mid-run. Same class: `'org-create-'` (organization-create),
  `'of-test-org-'` (org-features), seats/other prefixes. Cleanup prefixes and runtime names
  must become per-suite (per-copy!) unique.
- **Fixed shared fixtures**: `TEST_USERS` (helpers.ts: SYS_ADMIN, TEACHER, STUDENT, STUDENT2,
  UNIVERSITY_ADMIN) mutated by keep-as-is suites (`university`, `rpc-questions`, `auth`).
- **Within-file order-dependent suites** (just migrated — re-isolate per-test, don't keep
  shared file-level orgs):
  - `seats.test.ts`: single shared org; `GET /pools` asserts `total===1, assigned===0`
    before `PUT` sets total=5; `DELETE` describe seeds `assigneeC` in nested `beforeEach`;
    hard-block describe resets `total=0` in nested `beforeEach` and asserts 429. DB has
    `org_seat_assignments UNIQUE(organization_id, user_id)` + BEFORE INSERT trigger
    `check_seat_available` (SEAT_POOL_FULL → `USAGE_LIMIT_EXCEEDED`).
  - `questions.test.ts`: file-level `beforeEach` `cleanupQuestions(educator.user.id)` deletes
    ALL educator questions — concurrent copies nuke each other; "filters by type" asserts
    `length === 1` for `type=true_false`.
  - `invitations.test.ts`: file-level `beforeEach` `cleanupInvitations(fixture.user.id)` +
    `cleanupInvitations(student.id)`.
- **DB uniqueness constraints**: `invitations.token` UNIQUE (per-run `Date.now()` tokens
  exist; 3 concurrent copies of the same test need 3 distinct tokens), seat assignment
  UNIQUE(org,user), fixed names like `q-test-Main Bank` (verify no unique constraint on
  `question_banks.name` / `groups.name`).
- **Nested `beforeEach`/`afterAll` scope**: file-level "clean everything" patterns break
  under interleaving; prefer per-test unique data + per-test scoped cleanup.
- `vi.clearAllMocks()` in `beforeEach` is fine; check nothing relies on cross-test module
  state ordering.
- Keep-as-is suites (`university`, `org-features`, `rpc-questions`, `auth`) stay
  semantically as-is; touching them for isolation is allowed, migrating them to `before()`
  is not (out of scope).

## Implementation requirements

- Build the 3× side-by-side mechanism so that the normal `bun test:integration` run does it
  — no separate "stress" command required (a wrapper script is fine as a thin alias).
- Full isolation: 3 concurrent copies of the same test + arbitrary interleaving with other
  tests/files must be safe. Prefer real isolation over serialization hacks (no locks, no
  `--no-file-parallelism` escapes, no hidden `maxWorkers: 1`).
- Do not weaken assertions (no `=== 1` → `>= 1` swaps, no dropping 403/429 checks).
- Keep `bun run lint` clean (tsc + biome + import-path guard; AGENTS.md: full aliases `@/`
  and `#test/`, no relative imports in `src/` or `__tests__/`).
- `bun test:unit` (580 tests) must stay green. `bun test:e2e` untouched.

## Definition of done

1. `vitest.config.ts`: file parallelism ON, in-file concurrency ON, concurrency cap
   documented (logical CPUs or unlimited as decided); comments explain the 3× mechanism
   and how it maps to fine-grained runs.
2. `bun test:integration` green with the 3× side-by-side stress ACTIVE — **5 consecutive
   full runs**, zero flakes. Every flake encountered → fixed at root cause and reported.
3. `bun run lint` clean; `bun test:unit` green (580).
4. Report (chat + optionally `docs/plans/`): isolation plan; per-suite changes + why;
   the 3× mechanism chosen + why (and why not the alternatives); flakes hit + root causes;
   final concurrency config values.
5. Commit on `dev` with a conventional message; do not push.