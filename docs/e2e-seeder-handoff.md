# e2e seeder — handoff

**Branch:** `feat/e2e-seeder` (pushed; no PR — the operator reviews locally first)
**Base:** `main` merged in (`58db8687`), branch is current as of this handoff.
**Goal:** #464 prerequisite — one isolated tenant per test, seeded before the suite runs, so the
e2e suite can be order-independent and parallel-safe. CI-only (the operator runs a custom
runner), so correctness beats raw speed.

---

## 1. What already works

| Commit | Contents |
|---|---|
| `13420cf9` | `scripts/e2e-seed.ts`, `__tests__/e2e/fixtures/{ids,tenant}.ts`, `__tests__/e2e/global-setup.ts`, generated `packages/server/src/types/database.ts`, `playwright.config.ts` globalSetup, first migrated spec |
| `58db8687` | merge of `main` |
| `29ae998d` | `E2E_SKIP_ADMIN_WS=1` to skip the admin `webServer` locally |
| `3dcd2d23` | `bare` profile by default + `PROFILE_BY_FILE` opt-in to `content` |
| `875cf894` | `signIn(page, role)` helper + pinned `NEXT_LOCALE=en` |
| `0841a37a` | formatting |

Measured locally (Supabase on 54321/54322, app on :3000):

- **363 tenants in 3.3–6.9 s** (`bun scripts/e2e-seed.ts`), `--reset` included.
- 50 auth users inserted by SQL: **248 ms**; 50 logins @8 concurrency: **399 ms** (~8 ms each).
- `question-bank-crud.spec.ts` migrated: **2/2 green, 8–13 s, 2 workers**.

---

## 2. The finding that changes the plan

**The existing specs are already red on `main`.** Proof: I extracted the untouched
`__tests__/e2e/student-flashcard.spec.ts` from `origin/main` (dev login, no fixture) and ran it:

```
4 failed
```

So "make the existing tests pass" is **drift fixing**, not migration. Examples found:

- `getByRole('link', { name: /Questions|Pytania/i })` now matches **2** elements — the sidebar
  link and a dashboard quick-action card → strict-mode violation.
- `getByRole('button', { name: /Manage Decks/ })` no longer exists on `/app/flashcards` for a
  student.
- Some specs hardcode English copy; the app defaults to Polish (`NEXT_LOCALE` cookie).

Three specs were migrated and then **reverted** (`student-flashcard`, `student-question`,
`teacher-question`) because they failed for pre-existing reasons — do not commit red migrations.

---

## 3. First task for the new agent

Produce the **baseline table**: which of the 35 specs are red *before* touching them.

```bash
cd .worktrees/feat/e2e-seeder
E2E_SKIP_ADMIN_WS=1 E2E_SKIP_SEED=1 \
  bunx playwright test --project=chromium --reporter=json --workers=2 \
  > /tmp/baseline.json 2>/tmp/baseline.err
```

Then summarise per spec file (passed / failed / skipped) and share it before fixing anything.
Workers: 2–3 max. **A 6-worker run plus the dev server OOM-killed this machine** — prefer a
production build (`bun run build && bun start`) over `bun dev` for long runs.

---

## 4. How it works

### Seeder (`scripts/e2e-seed.ts`)

1. `bunx playwright test --list --reporter=json` → every test × project.
2. Key = `<file basename>::<full title>::<project>`. Deduped, then seeded with concurrency 8.
3. **Auth**: one `INSERT INTO auth.users` per tenant via `Bun.SQL` (bcrypt, exactly like
   `supabase/seeds/01_seed.sql`). No `auth.identities` needed. Users are
   `e2e+<hash>+{teacher,student}@test.local`, password `pass`.
4. **Domain**: `supabase-js` service role, typed against `Database`. Batches respect FKs:
   org → (org_members, groups) → group_members → [content] decks/banks/quizzes →
   cards/questions/assignment → options/quiz_questions/targets.
5. **Org roles are created by a DB trigger** when the org is inserted — read them back
   (`select id,name from org_roles where organization_id = …`), never insert your own ids.
6. Output: `__tests__/e2e/.seed/index.json` (gitignored), keyed by the tenant key.

Flags: `--reset` (drops orgs named `e2e %` and users `e2e+%@test.local`), `--only <key>`.

### Fixture (`__tests__/e2e/fixtures/tenant.ts`)

```ts
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

test.beforeEach(async ({ page }) => { await signIn(page, 'teacher'); });
// or, inside a test:
test('…', async ({ page, tenant, loginAs }) => { … });
```

- `tenant` — `{ org, users, ids }` for this test (read from the seed index).
- `signIn(page, role)` / `loginAs(role)` — real `POST /api/v1/auth/login` through
  `page.request` (shares the context cookie jar), then `page.goto('/login')` and wait for the
  `/(edu|app|manage)/` redirect. Also pins `NEXT_LOCALE=en`.
- If a test's key is missing, it throws `no seeded tenant for "<key>"` → re-run the seeder
  (renaming a test invalidates its key).

### Profiles (`__tests__/e2e/fixtures/profiles.ts`)

- `bare` (default): org + teacher + student + group `G1` + memberships. Nothing else.
- `content`: + 2 decks (20 cards), 2 banks (10 questions with options), quiz, published
  assignment targeting the group.
- A spec opts in via `PROFILE_BY_FILE['<file>.spec.ts'] = 'content'`.
- Rule of thumb: specs that create their own data (and any empty-state assertion) stay `bare`;
  specs that read pre-existing content use `content`.

### Generated types

`packages/server/src/types/database.ts` came from:

```bash
supabase gen types typescript --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  > packages/server/src/types/database.ts
```

Two functions (`get_teacher_activity_feed`, `get_teacher_group_performance`) were stripped by
hand because they only exist on the unmerged #670 branch. **Regenerate after #670 merges.**

---

## 5. Running locally

Prereqs: local Supabase up (`supabase start`), app running on :3000, `apps/web/.env` present
(the seeder reads `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; DB defaults to
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, override with `SUPABASE_DB_URL`).

```bash
bun scripts/e2e-seed.ts --reset          # seed everything (~5 s)
E2E_SKIP_SEED=1 bunx playwright test …   # reuse the existing seed
E2E_SKIP_ADMIN_WS=1 …                    # do not boot the admin server on :4000
```

`playwright.config.ts` runs the seeder in `globalSetup`; `E2E_SKIP_SEED=1` disables that.

---

## 6. Pitfalls (learned the hard way)

1. **`node_modules` gets corrupted by a pnpm layout.** Symptom: `Cannot find module
   …/.pnpm/next@…/dist/bin/next`, or duplicate `react-hook-form` type errors in typecheck.
   Fix: `rm -rf node_modules apps/*/node_modules packages/*/node_modules pnpm-lock.yaml
   pnpm-workspace.yaml && bun install`, then check
   `apps/web/node_modules/.bin/next` is a symlink (`../next/dist/bin/next`), not a 5 KB shim.
2. **Admin `webServer`** has `reuseExistingServer: false` on purpose (module-cached keyring).
   Locally it will wait 180 s and fail if :4000 is busy → use `E2E_SKIP_ADMIN_WS=1`.
3. **Locale**: the app defaults to `pl`; several specs assert English strings. `signIn` sets
   `NEXT_LOCALE=en`. If a spec asserts Polish copy, it must set the cookie itself.
4. **Seed keys are derived from the test title.** Renaming or adding a test requires a re-seed;
   `E2E_SKIP_SEED=1` with a stale index produces `no seeded tenant`.
5. **FK order matters** — questions before options/quiz_questions, quizzes before assignments,
   assignments before targets, org before everything.
6. **OOM**: 6 Playwright workers + `bun dev` + Supabase killed the machine. Use a production
   build and ≤3 workers for full runs.
7. `#test/...` imports work in `scripts/` because Bun resolves the tsconfig paths.

---

## 7. Remaining work

1. **Baseline table** (section 3).
2. **Triage + migrate in batches of ~5 by area**, one commit per batch:
   - fix drift (exact selectors, current copy, `first()` where the dashboard duplicates a link);
   - replace the inline login with `signIn(page, role)`;
   - pick `bare` vs `content`;
   - run that batch on chromium before committing.
3. **Verify**: green at 1 worker, then at N, then `--shuffle` — that is the "not flaky, not
   order-dependent" proof.
4. **CI**: the operator's home-lab runner needs Supabase + browsers
   (`bunx playwright install --with-deps`), the three env vars, and a production build.
   Workers can rise once the suite is green and isolated.
5. **PR** — only after the operator approves locally.

## 8. Open decisions for the operator

- Do red specs get fixed in this branch, or does each one open an issue (campaign rule says
  "red specs open issues")?
- Keep the 3 browser projects for the full suite, or chromium-only on the runner?
- Should `content` become per-test opt-in in the spec (`test.use({ seed })`) instead of the
  file map? (The seeder needs the profile at seed time, so the file map is the current answer.)

## 9. File map

```
scripts/e2e-seed.ts                     # CLI: enumerate → auth users (SQL) → domain (typed) → index
__tests__/e2e/global-setup.ts           # runs the seeder once per suite (E2E_SKIP_SEED to skip)
__tests__/e2e/fixtures/ids.ts           # uuidv5 + tenantKey
__tests__/e2e/fixtures/profiles.ts      # bare/content + PROFILE_BY_FILE
__tests__/e2e/fixtures/tenant.ts        # tenant fixture, loginAs, signIn
__tests__/e2e/.seed/index.json          # generated, gitignored
packages/server/src/types/database.ts   # generated Database type
playwright.config.ts                    # globalSetup + E2E_SKIP_ADMIN_WS
```
