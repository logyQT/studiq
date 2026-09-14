# Coverage Improvement Handoff

Status: TODO — for next agent
Created: 2026-09-14

## Current Coverage

| Layer | Stmts | Branches | Functions | Lines |
|-------|-------|----------|-----------|-------|
| **All files** | **43.16%** | **34.18%** | **48.98%** | **46.42%** |
| controllers | 42.91% | 36.94% | 54.91% | 44.34% |
| services | 40.47% | 32.89% | 45.03% | 44.01% |
| models | 100% | 100% | 100% | 100% |
| guards | 100% | 100% | 100% | 100% |
| ai | 100% | 90% | 100% | 100% |
| agents | 0% | 100% | 100% | 0% |

Models and guards are fully covered. **The gap is entirely in controllers and services** — many files have no unit tests at all.

## Priority Tier 1 — Business-critical services (< 5% stmts, 50+ lines)

These are core domain services with almost no unit test coverage. They're exercised by integration tests but the unit-level branch coverage is nearly zero.

| File | Stmts | Lines | Why it matters |
|------|-------|-------|----------------|
| `teacher-assignment.service.ts` | 0.70% | 0.91% | 341 lines, manages assignment lifecycle |
| `activity.service.ts` | 0.94% | 1.09% | 283 lines, activity tracking |
| `plan-limit.service.ts` | 1.21% | 1.42% | 183 lines, plan limit enforcement |
| `plan-feature.service.ts` | 1.53% | 2.08% | 178 lines, feature flag resolution |
| `org-role.service.ts` | 1.33% | 1.61% | 269 lines, org role management |
| `agent-trace.service.ts` | 1.66% | 1.98% | 211 lines, agent trace logging |
| `group.service.ts` | 23.25% | 27.14% | 261 lines, group CRUD + membership |
| `org.service.ts` | 3.84% | 5% | 73 lines, org lifecycle |
| `flashcard-stats.service.ts` | 1.66% | 1.98% | 152 lines, flashcard analytics |
| `question-report.service.ts` | 3.44% | 4.34% | 63 lines, question reporting |
| `search.service.ts` | 3.44% | 4% | 85 lines, full-text search |
| `topic.service.ts` | 49.63% | 59.63% | 264 lines, topic CRUD (partial coverage) |
| `flashcard.service.ts` | 49.46% | 56.16% | 385 lines, flashcard CRUD (partial) |
| `organization-member.service.ts` | 52.87% | 58.9% | 187 lines, member management (partial) |
| `organization.service.ts` | 53.57% | 63.23% | 242 lines, org CRUD (partial) |
| `flashcard-practice.service.ts` | 42.5% | 48.68% | 754 lines, practice session logic |
| `subscription-plan.service.ts` | 4.16% | 5.26% | 53 lines, subscription management |

## Priority Tier 2 — Controllers with no unit tests

These controllers have integration test coverage but no isolated unit tests. Add unit tests following the existing controller test pattern (mock service, assert controller response).

| File | Lines | Why it matters |
|------|-------|----------------|
| `group.controller.ts` | ~260 | Group CRUD endpoint |
| `organization.controller.ts` | ~240 | Organization management |
| `organization-member.controller.ts` | ~180 | Member management |
| `org.controller.ts` | ~73 | Org operations |
| `org-role.controller.ts` | ~269 | Role management |
| `permission.controller.ts` | ~27 | Permission checks |
| `permissions.controller.ts` | ~135 | Permissions listing |
| `plan-feature.controller.ts` | ~51 | Feature flag toggle |
| `plan-limit.controller.ts` | ~81 | Limit management |
| `question-bank.controller.ts` | ~302 | Question bank CRUD |
| `question-report.controller.ts` | ~81 | Question reports |
| `search.controller.ts` | ~85 | Search endpoint |
| `seat.controller.ts` | ~178 | Seat management |
| `stripe.controller.ts` | ~177 | Stripe billing |
| `subscription-plan.controller.ts` | ~135 | Subscription plans |
| `subscription-plan-admin.controller.ts` | ~49 | Admin plan management |
| `topic.controller.ts` | ~78 | Topic CRUD |
| `user-override.controller.ts` | ~269 | User feature overrides |
| `activity.controller.ts` | ~27 | Activity tracking |
| `ai-chat.controller.ts` | ~49 | AI chat endpoint |
| `classroom.controller.ts` | ~27 | Classroom management |
| `feature-flag.controller.ts` | ~49 | Feature flags |
| `flashcard-export.controller.ts` | ~41 | Flashcard export |
| `flashcard-import.controller.ts` | ~23 | Flashcard import |
| `flashcard-stats.controller.ts` | ~42 | Flashcard statistics |

## Priority Tier 3 — Services with low but non-zero coverage (partial tests exist)

These have some tests but significant branches/lines uncovered. Expand existing tests to cover error paths and edge cases.

| File | Stmts | Gap |
|------|-------|-----|
| `stats.service.ts` | 27.45% | Missing teacher/student stats aggregation branches |
| `question-bank.service.ts` | 13.81% | Bank CRUD + visibility logic |
| `group.service.ts` | 23.25% | Group membership + permission logic |
| `topic.service.ts` | 49.63% | Topic CRUD edge cases |
| `flashcard.service.ts` | 49.46% | Flashcard CRUD edge cases |
| `plan.resolver.ts` | 70.09% | Plan resolution edge cases |

## What NOT to touch

- **Models** — 100% coverage, no changes needed
- **Guards** — 100% coverage, no changes needed
- **`mock-stripe.service.ts`** — test utility, not production code
- **`ai-prompts.ts`** — pure data constants, 100% covered
- **`storage.service.ts`** — external storage abstraction, hard to unit test

## Test patterns to follow

### Controller tests
```ts
// __tests__/unit/controllers/foo.controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fooController } from '@/server/controllers/foo.controller';

// Mock the service
vi.mock('@/server/services/foo.service', () => ({
  fooService: { method: vi.fn() },
}));

describe('FooController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns data on success', async () => {
    // Setup mock return value, call controller method, assert response
  });

  it('returns error on failure', async () => {
    // Mock service to throw AppError, assert error response
  });
});
```

### Service tests
```ts
// __tests__/unit/services/foo.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fooService } from '@/server/services/foo.service';

// Mock Supabase client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('FooService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries correctly', async () => {
    // Setup mock Supabase chain, call service method, assert
  });
});
```

### Key conventions
- Import `{ z, registry }` from `@/lib/zod` (never from `'zod'` directly)
- Import test helpers from `#test/` (never relative paths)
- All imports use `@/` or `#test/` aliases (enforced by biome + import-path guard)
- Use `AppError(code)` for business errors, `mapSupabaseError(error)` for DB errors
- `ControllerResponse` type: `{ success: true, statusCode, data }` or `{ success: false, statusCode, error, details? }`

## Verification

After adding tests:
1. `bun run lint` must stay clean
2. `bun test:unit` must stay green (currently 580 tests)
3. `bun test:integration` must stay green (currently 558 effective tests with 3× duplication)
4. Target: bring `src/server/` statement coverage from 43% → 60%+
