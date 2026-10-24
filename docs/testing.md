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

**Location:** `e2e/`

**Covered flows:**
- Login and registration
- Student flashcard practice
- Teacher question management

## Running Tests

```bash
bun test              # Reset DB + run all tests
bun test:unit         # Run unit tests only
bun test:integration  # Run integration tests only
bun test:watch        # Watch mode (re-runs on file changes)
bun test:coverage     # Run with coverage report
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
