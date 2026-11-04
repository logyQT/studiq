# Testing

## Overview

The project uses two testing frameworks:

| Framework  | Purpose                    | Location                                    |
| ---------- | -------------------------- | ------------------------------------------- |
| Vitest     | Unit and integration tests | `__tests__/unit/`, `__tests__/integration/` |
| Playwright | End-to-end tests           | `__tests__/e2e/`                            |

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

Accounts, organizations, roles, the default group and memberships come from the shared
tenant seeder (`__tests__/helpers/tenant-seed.ts`, also used by `scripts/e2e-seed.ts`);
content is still created through the real API routes. There are no shared per-run accounts.

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
194 e2e · 12 API-level · 8 semantic (campaign parked until the backlog closes).

## Running Tests

```bash
bun run test              # Run the full Vitest unit/integration suite
bun run test:unit         # Run unit tests only
bun run test:integration  # Run integration tests only
bun run test:watch        # Watch mode (re-runs on file changes)
bun run test:coverage     # Run with coverage report
```

Vitest sets `APP_ENV=test` and `PAYMENT_DRIVER=mock` in `vitest.config.ts`, so
unit and integration tests never need Stripe configuration. Those two values
are the only reason the mock driver may run in CI; production is the default
posture when `APP_ENV` is unset and rejects `PAYMENT_DRIVER=mock` outright.
E2E and QA set `APP_ENV=qa` + `PAYMENT_DRIVER=mock` in the workflow env files.

## Stripe sandbox (opt-in)

The real-Stripe suites need the network, a **test-mode** secret and a reachable
local Supabase stack. They are skipped unless `RUN_STRIPE_TESTS=1`, and they
must **never** run on PRs from forks.

```bash
# One-off, after scripts/stripe-bootstrap.ts and with this checkout's DB up:
bun run test:stripe
```

Prerequisites (root `.env`; Vitest already forces the test posture, so the
sandbox suite needs no `APP_ENV`):

- `STRIPE_SECRET_KEY=rk_test_…` or `sk_test_…` (never a live key for this suite)
- `STRIPE_PORTAL_CONFIGURATION_ID=bpc_…` and the catalog/prices created by
  `bun scripts/stripe-bootstrap.ts`
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for a reachable local
  Supabase, plus the seeded `TEST_USERS` and at least two mapped student plans
- `RUN_STRIPE_TESTS=1` (the script sets it)

Run `bun run test:stripe` on its own, not as part of a full
`bun run test:integration` run: the lifecycle cases use the seeded student and
reset that user's billing rows.

What it covers:

- catalog/price/portal/checkout-session shape against the real sandbox;
- subscription lifecycle via **test clocks**: renewal → second `payments` row
  (replay stays idempotent), dunning with `4000 0000 0000 0341` → mirror
  `past_due` + unchanged plan, cancel-at-period-end → `deleted` → free plan,
  upgrade anchor reset, and downgrade applying at the period boundary.

Test-clock limits: at most **3 customers per clock** and **3 subscriptions per
customer**; advance at most two service periods at a time; clocks auto-delete
after 30 days. Each case creates one clock/customer/subscription and deletes the
clock again.

## Manual QA (agent-driven)

The manual test plan lives in [`qa/`](../qa/README.md) — 214 scenarios with
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
