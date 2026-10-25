# Testing

## Overview

The project uses two testing frameworks:

| Framework | Purpose | Location |
|-----------|---------|----------|
| Vitest | Unit and integration tests | `__tests__/unit/`, `__tests__/integration/` |
| Playwright | End-to-end tests | `e2e/` |

## Unit Tests

Unit tests cover individual services, controllers, models, and guards. They mock the Supabase client to isolate business logic from the database.

**Location:** `__tests__/unit/`

```
__tests__/unit/
  controllers/        # Controller unit tests (auth, flashcards, quizzes, etc.)
  guards/             # Guard unit tests (auth.guard, role.guard)
  models/             # Model validation tests
  services/           # Service unit tests (mocked Supabase)
```

## Integration Tests

Integration tests hit a real local Supabase instance. They verify that API routes, controllers, services, and the database work together end-to-end.

**Location:** `__tests__/integration/`

**Covered domains:**
- Authentication (register, login, logout)
- Subjects, questions, quizzes, quiz attempts
- Flashcards, decks, topics, practice
- Invitations, university members
- Statistics, health checks

## E2E Tests

Playwright tests run against the full application in a real browser.

**Location:** `__tests__/e2e/` — conventions and the target architecture are in
[`e2e-campaign.md`](e2e-campaign.md).

**Target architecture:** one spec per QA case (`__tests__/e2e/cases/<ID>.spec.ts`), each test
provisioning its own organization and accounts, so specs can run in any order at N workers.
Cross-test interference is a tenant leak, not a flake.

**Covered flows today:** login and registration, student flashcard practice, teacher question
management, quiz editor, invites. Case coverage: [`qa/coverage.md`](../qa/coverage.md) —
195 e2e · 12 API-level · 8 semantic (campaign parked until the backlog closes).

**Typecheck:** `__tests__/e2e/tsconfig.json` is a dedicated program for the specs,
`utils.ts`, `playwright.config.ts` and `scripts/e2e-smoke.ts`, wired into
`bun run typecheck:e2e` and therefore into `typecheck:all` (and the git hooks). The root
`tsconfig.json` still excludes the folder, so use the e2e program for editor/CI checks.

### E2E smoke gate (#459)

`bun run test:e2e:smoke` is the deterministic subset that runs on **pre-push**: the
`student-quiz-open-answer.spec.ts` regression for #320, Chromium, one worker. The full suite
is still manual (`bun test:e2e`) — it is slow and several specs share seeded accounts.

The script (`scripts/e2e-smoke.ts`):

1. checks `NEXT_PUBLIC_SUPABASE_URL`, refuses non-loopback targets
   (`E2E_SMOKE_ALLOW_REMOTE=1` overrides) and pings `/auth/v1/health`, failing with the
   `bunx supabase start && bunx supabase db reset` instructions;
2. deletes the smoke student's (`student-classroom@dev.local`) standalone quiz attempts
   started today, so `max_quiz_attempts_per_day` (10 on the base plan) cannot turn the gate
   red on the 11th push of the day (`E2E_SMOKE_KEEP_ATTEMPTS=1` opts out; requires
   `SUPABASE_SERVICE_ROLE_KEY`);
3. fails fast when its port is taken — it never reuses another checkout's dev server, which
   would report green for untested code. Default port `3100` (`E2E_SMOKE_PORT`); or reuse a
   running app explicitly with `E2E_SMOKE_REUSE=1 PLAYWRIGHT_BASE_URL=http://localhost:<port>`.

Requirements: Docker + `bunx supabase start && bunx supabase db reset` (seeds the Classroom
open questions and `quiz` on the base plan), `bunx playwright install chromium`, and a `.env`
in the worktree (same as `bun dev`).

Skip it for one push with `SKIP_E2E_SMOKE=1 git push` (the lefthook `skip` condition); it is
a local gate only — this repo has no PR CI, so a contributor who does not install lefthook or
pushes with `--no-verify` bypasses it.

## Running Tests

```bash
bun test              # Reset DB + run all tests
bun test:unit         # Run unit tests only
bun test:integration  # Run integration tests only
bun test:watch        # Watch mode (re-runs on file changes)
bun test:coverage     # Run with coverage report
bun test:e2e          # Full Playwright suite (manual; needs the seeded DB)
bun test:e2e:smoke    # Pre-push Playwright smoke (deterministic #320 spec)
```

## Manual QA (agent-driven)

The manual test plan lives in [`qa/`](../qa/README.md) — 215 scenarios with
steps, expected results and prerequisite chains. Agents run them in a real
browser against the observability stack (Tempo + Loki + Prometheus) so failures
are reported with the underlying span/log evidence instead of a bare status code.

- Start here: [`qa/AGENT-PROMPT.md`](../qa/AGENT-PROMPT.md) (copy-paste prompt, one scenario per session).
- Corpus index: [`qa/index.md`](../qa/index.md); global rules and seed data: [`qa/context.md`](../qa/context.md).
- Debugging loop: [`docs/observability-debugging.md`](./observability-debugging.md).

## Test Configuration

- **Setup file:** `__tests__/setup.ts` — configures Supabase mock passthrough
- **Mocks:** `__tests__/mocks/supabase.ts` — reusable Supabase mock
- **Helpers:** `__tests__/helpers/supabase-mock.ts` — mock utilities
- **Config:** `vitest.config.ts` — defines test environment, aliases, and sequential execution
