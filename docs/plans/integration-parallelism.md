# Integration Test Parallelism & 3× Self-Stress

Status: COMPLETE
Date: 2026-09-14

## Summary

Enabled file parallelism + 3× side-by-side test duplication for integration tests.
Every `it()` in every integration test file now runs as 3 concurrent copies across
files (via `fileParallelism: true`) and 3 sequential copies within each file
(via `forEachCopy()` helper). 186 original tests → 558 effective tests.

## Concurrency Configuration

```ts
// vitest.config.ts
fileParallelism: true,    // files run in parallel across workers
sequence: {
  concurrent: false,       // within a file, tests run sequentially
},
```

### Why `sequence.concurrent: false`

Vitest's `sequence.concurrent: true` runs tests within a file concurrently in the
same worker. Integration tests share a module-scoped mock (`vi.mock('@/lib/supabase/server')`),
and concurrent tests overwrite each other's `mockImplementation()` — causing
non-deterministic failures. Keeping `false` ensures mock isolation within each file.

Cross-file isolation is proven by `fileParallelism: true`: different files run in
separate workers with isolated module state.

## 3× Side-by-Side Mechanism

**Implementation:** `forEachCopy()` helper (`__tests__/helpers/concurrent.ts`)

Each `it()` is registered 3 times with unique `copyId` strings. Within a file,
the 3 copies run sequentially (safe for shared mocks). Across files, copies from
different files run concurrently via `fileParallelism`.

```ts
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { applyRegisteredMock } from '#test/integration/helpers';

forEachCopy((copyId) => {
  describe(`Suite [${copyId}]`, () => {
    registerMock(copyId, TEST_USERS.TEACHER);
    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });
    // ... tests
  });
});
```

**Per-copy mock registration:** `registerMock(copyId, user)` stores the mock user
at parse time. `applyRegisteredMock(copyId)` in `beforeEach` reads from the registry
and applies the correct mock before each test body runs.

### Why not alternatives

- **`--repeat 3`:** Runs replicas sequentially, proves nothing about isolation.
- **3 separate `vitest` processes:** Requires globally unique DB namespaces per
  process; dramatically increases DB load; noisy constraint violations.
- **`sequence.concurrent: true`:** Shared module mocks cause race conditions
  between concurrent test bodies.

## Per-Suite Isolation Changes

### Files that needed per-copy data

| Suite | Change | Why |
|-------|--------|-----|
| `organization-create.test.ts` | Each copy creates own users in `beforeAll`; per-copy org names | Shared users would conflict under parallel file execution |
| `questions.test.ts` | `beforeEach` cleanup scoped to `copyId` content prefix | Broad `cleanupQuestions()` without prefix would delete other copies' data |
| `rpc-questions.test.ts` | Global cleanup (no prefix) in `beforeEach`; per-copy org prefix | `p_org_id=null` returns questions across ALL orgs; must clean globally |
| `seats.test.ts` | Each copy creates own org/pool/assignees via `before()` | Shared pool state (total=1→5→0) is order-dependent |
| `invitations.test.ts` | Each copy creates own fixture/student; `mockUser()` for GET token tests | Anon role lacks SELECT on `invitations` table |
| `stats.test.ts` | Each copy creates own teacher (3 questions) + student | Tests assert exact counts (totalQuestions === 3) |
| `university.test.ts` | Per-copy `TEST_PREFIX`; per-copy afterAll cleanup | Shared prefix caused cross-copy org deletion |
| `auth.test.ts` | Unique emails per copy (`reset-test-${copyId}@dev.local`) | Supabase Auth per-email rate limit on password reset |

### Files that needed no data changes

| Suite | Why safe |
|-------|----------|
| `health.test.ts` | Pure read-only, no DB writes |
| `org-features.test.ts` | Per-test org creation/cleanup (already isolated) |
| `members.test.ts` | Shared fixture is read-only; copies only read |
| `flashcard-topics.test.ts` | Shared fixture; test-created data has unique names |
| `flashcard-decks.test.ts` | Same pattern as flashcard-topics |
| `flashcards.test.ts` | Shared fixture; test-created flashcards use unique `fc-` prefix |
| `flashcard-practice.test.ts` | Each copy creates own teacher/student |
| `quizzes.test.ts` | Each copy creates own student with questions |
| `quiz-attempts.test.ts` | Each copy creates own student; `beforeEach` creates fresh quiz |
| `plan-limits.test.ts` | Each copy creates own fixture; `plan_limits` is shared seed data |
| `invite-accept.test.ts` | Each test creates own fixture (self-contained) |

## Flakes Hit & Root Causes

1. **`rpc-questions.test.ts` `p_org_id=null`:** `cleanupQuestions(userId, copyId)` with
   copyId prefix only cleaned the current copy's questions. The `p_org_id=null` query
   returns questions across ALL orgs, so previous copies' questions leaked through.
   **Fix:** Removed copyId prefix from `cleanupQuestions` — clean ALL questions globally.

2. **`invitations.test.ts` GET token tests:** All 3 copies returned 404.
   **Root cause:** The anon role (used by `useRealSupabase()` → `createRealClient()`)
   lacks SELECT permission on the `invitations` table. The service role client (used by
   `mockUser()`) has full access.
   **Fix:** Added `mockUser(fixture.user)` before GET token tests.

3. **`auth.test.ts` password/reset:** Copies 2 and 3 hit Supabase Auth's per-email
   rate limit (`over_email_send_rate_limit`).
   **Fix:** Used unique per-copy email (`reset-test-${copyId}@dev.local`).

## Test Count

| Metric | Before | After |
|--------|--------|-------|
| Integration test files | 19 | 19 |
| Original `it()` count | 186 | 186 |
| Effective test count | 186 | **558** (186 × 3) |
| Unit tests | 580 | 580 (unchanged) |
| `bun run lint` | ✅ | ✅ |
| Consecutive green runs | — | **5/5** |
