# Testing

## Overview

The project uses two testing frameworks:

| Framework | Purpose | Location |
|-----------|---------|----------|
| Vitest | Unit and integration tests | `src/**/*.test.ts`, `__tests__/integration/` |
| Playwright | End-to-end tests | `e2e/` |

## Unit Tests

Unit tests cover individual services and controllers. They mock the Supabase client to isolate business logic from the database.

**Pattern:** Each service/controller has a co-located `.test.ts` file.

```
src/server/services/
  auth.service.ts
  auth.service.test.ts        # Unit tests with mocked Supabase
```

## Integration Tests

Integration tests hit a real local Supabase instance. They verify that API routes, controllers, services, and the database work together end-to-end.

**Location:** `__tests__/integration/`

**Covered domains:**
- Authentication (register, login, logout)
- Subjects, questions, quizzes, quiz attempts
- Flashcards, topics, spaces, practice
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
pnpm test              # Reset DB + run all tests
pnpm test:unit         # Run unit tests only
pnpm test:integration  # Run integration tests only
pnpm test:watch        # Watch mode (re-runs on file changes)
pnpm test:coverage     # Run with coverage report
```

## Test Configuration

- **Setup file:** `__tests__/setup.ts` — configures Supabase mock passthrough
- **Config:** `vitest.config.ts` — defines test environment, aliases, and sequential execution
- **Test environment:** `.env.test` — Supabase connection for tests
