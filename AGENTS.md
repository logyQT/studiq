# StudiQ Agent Guidelines

## Project Identity

- **Runtime**: Bun (package manager, script runner)
- **Framework**: Next.js 16 (App Router), TypeScript 7
- **Repo shape**: Bun-workspaces **monorepo** — there is **no root `src/`** (see [Repository Layout](#repository-layout))
- **Database**: Supabase (PostgreSQL 17) + Supabase Auth
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York style)
- **i18n**: next-intl (`en`, `pl`), locale from `NEXT_LOCALE` cookie, defaults to `'pl'`
- **State/Data**: TanStack React Query v5
- **Forms**: React Hook Form + Zod v4
- **Testing**: Vitest (unit + integration) + Playwright (E2E)

---

## Repository Layout

```
studiq/
├── apps/
│   ├── web/                        # Main app, port 3000 — package `@studiq/web`
│   │   └── src/
│   │       ├── app/(backend)/api/v1/*/route.ts   # Thin API routes
│   │       ├── app/(frontend)/                   # UI pages (landing, /app, /edu, /manage, ...)
│   │       ├── components/ hooks/ lib/ i18n/ types/ styles/
│   │       └── proxy.ts                          # Next.js 16 proxy (session + route rules)
│   └── admin/                      # Standalone admin panel, port 4000 — package `@studiq/admin`
│       └── src/
│           ├── app/(backend)/api/v1/*            # Admin API routes (PEM-signed requests)
│           ├── app/(frontend)/                   # Admin pages
│           ├── server/{controllers,models,services}   # Admin-only backend (imports via `@admin/*`)
│           ├── lib/ i18n/
│           └── proxy.ts                          # Ed25519 signature gate for `/api/*`
├── packages/
│   ├── server/    # `@studiq/server` — shared backend: controllers, models, services, guards, config, lib
│   ├── authz/     # `@studiq/authz` — RBAC primitives: AccountType, Permission, scopes, feature keys
│   ├── ui/        # `@studiq/ui` — shared shadcn/ui components
│   └── tsconfig/  # Shared tsconfig base (`base.json`)
├── __tests__/     # Root-level tests: unit/, integration/, e2e/, helpers/, mocks/, setup.ts
├── supabase/      # migrations/, schemas/, seeds/, templates/, config.toml
├── scripts/       # Dev workflow scripts (spin, pr, import + migration guards)
└── docs/          # Project documentation
```

- Main app code: `apps/web/src/…` — shared backend code: `packages/server/src/…`
- Each workspace has its **own** `tsconfig.json` and `package.json` scripts; typecheck each workspace with its own script (see Commands).
- Cross-package imports always go through workspace names (`@studiq/server`, `@studiq/authz`, `@studiq/ui`) or the `@admin/*` alias — never deep relative paths.

---

## Branching Workflow

**`main` is the only long-lived branch.** No `dev`, no `staging`.

> **Agent rule: always work in a worktree.** Never make changes directly on `main`. Before doing any work, run `scripts/spin <branch-name>` to create an isolated worktree, then move your session into it. The only exception is read-only tasks (code review, exploration, grep) where no files are modified.

- **Feature branches**: `feat/<short-name>` off `main`. One feature per branch, multiple commits allowed.
- **PR to main**: Open a PR from `feat/<short-name>` → `main`. Merge via GitHub (squash or merge commit — your call per PR).
- **Delete after merge**: Always delete the feature branch after the PR is merged.
- **Naming**: `feat/`, `fix/`, `refactor/`, `docs/`, `test/` prefixes.
- **Keep PRs scoped**: Aim for PRs that are reviewable. If a feature is huge, break it into stacked PRs off the same branch.

```
main ← feat/quiz-bank-ui (PR, merge, delete)
     ← fix/flashcard-count-badge (PR, merge, delete)
     ← refactor/import-paths (PR, merge, delete)
```

---

## Commands

`package.json` at the repo root is the **source of truth** — if anything below disagrees with it, trust `package.json`.

| Command | What it does |
|---------|-------------|
| `bun run dev` | Web dev server (port 3000) |
| `bun run dev:admin` | Admin dev server (port 4000) |
| `bun run build` / `bun run start` | Production build / start for web (`build:admin`, `start:admin` for admin) |
| `bun run lint` | `biome ci apps/web/src/ && bun scripts/check-import-paths.ts && bun scripts/check-migration-timestamps.ts` — Biome + import-path guard + migration-timestamp guard. **Contains no `tsc` step.** |
| `bun run lint:all` | `bun run typecheck && bun run lint` — typecheck + lint in one command |
| `bun run typecheck` | `tsc --incremental --skipLibCheck --noEmit` for **`apps/web` only** (`bun run typecheck:admin` covers `apps/admin`) |
| `bun run format` | `biome check --write apps/web/src/` |
| `bun run format:check` | `biome ci apps/web/src/` (check only) |
| `bun run clean` | Remove `.next`, `coverage`, cache |
| `bun run test` | `vitest run` — runs all tests (unit + integration) |
| `bun run test:unit` | `vitest run __tests__/unit/` |
| `bun run test:integration` | `vitest run __tests__/integration` (needs a local Supabase instance) |
| `bun run test:watch` | `vitest` (watch mode) |
| `bun run test:coverage` | `vitest run --coverage` |
| `bun run test:e2e` | `playwright test` — runs `__tests__/e2e/` specs |

> **Footgun — bare `bun test` is NOT Vitest.** `bun test` starts **Bun's built-in test runner**, which scans the whole repo (including integration tests that need live Supabase) and reports differently. Always use `bun run test` / `bun run test:unit`. Bare `bun <script>` shorthand does work for other scripts (e.g. `bun test:unit`).

Git hooks (lefthook) enforce this on every commit/push: **pre-commit** runs format-on-staged + `bun run lint` + `bun run typecheck`; **pre-push** runs `format:check`, `lint`, `typecheck`, `test:unit`, plus a merge-conflict check against `origin/main`.

### Custom agent commands

| If you say | What I do |
|-----------|-----------|
| `commit propose` | `git diff --staged` → propose conventional commit message |

### Developer workflow scripts

These scripts help devs (and agents) work with feature branches and isolated worktrees:

| Script | What it does |
|--------|-------------|
| `scripts/switch-branch [branch]` | Stash WIP → switch branch → pull → pop stash. Only stashes if dirty |
| `scripts/switch-branch -c <name>` | Create a new branch from main, then switch to it |
| `scripts/spin <branch>` | Create a feature branch + git worktree under `.worktrees/` |
| `scripts/spin --list` | List all active worktrees |
| `scripts/spin <branch> --clean` | Remove worktree and delete branch |
| `scripts/pr [title]` | Create a PR from current branch via `gh` CLI |
| `scripts/pr --draft` | Create a draft PR |
| `scripts/pr --list` | List open PRs for this repo |

#### Multi-worktree workflow

Use worktrees to run parallel tasks (e.g. multiple agents, or dev server + tests) without conflicts:

```bash
# Spin up an isolated workspace
scripts/spin feat/quiz-ui

# Move your session into it
cd .worktrees/feat/quiz-ui

# Do work, commit, push
git add -A && git commit -m "feat: add quiz UI"
git push -u origin feat/quiz-ui

# Create PR from inside the worktree
scripts/pr

# Clean up when merged
scripts/spin feat/quiz-ui --clean
```

Each worktree gets its own branch, working directory, and can run `bun run dev` independently. The main checkout stays untouched.

### Running a single test

```bash
bunx vitest run __tests__/unit/services/question.service.test.ts
bunx vitest run -t "test name pattern"
```

### Import aliases

```ts
import { flashcardController } from '@studiq/server/controllers/flashcard.controller'; // app code → packages/server
import { before } from '#test/helpers/test-user'; // __tests__/helpers/test-user (test-internal imports)
```

- `@/` → `src/` **of the workspace the file lives in**: `apps/web/src`, `apps/admin/src` (and `packages/authz/src`, `packages/ui/src` inside those packages). It is **not** mapped in `packages/server` — server code imports itself as `@studiq/server/...`. In root-level files (`scripts/`, root configs) and in Vitest, `@/` resolves to `apps/web/src`.
- `@studiq/server/*`, `@studiq/authz`, `@studiq/ui` → `packages/*/src/*` — wired in every app `tsconfig.json` and `vitest.config.ts`.
- `@admin/*` → `apps/admin/src/*` (admin app code; also usable from root-level tests).
- `#test` → `__tests__/` — works in both Vitest **and** Playwright (declared in vite config + tsconfig `paths`). Use it for imports *between* test files.

---

## Architecture: Route → Controller → Model → Service

All main-app backend logic follows this strict 4-layer flow:

```
apps/web/src/app/(backend)/api/v1/*/route.ts
  → packages/server/src/controllers/*.controller.ts  (validate input, call service)
    → packages/server/src/models/*.model.ts          (Zod schemas + inferred types)
      → packages/server/src/services/*.service.ts    (business logic + DB queries)
```

The admin app mirrors the same pattern inside its own workspace: `apps/admin/src/app/(backend)/api/v1/*/route.ts` → `apps/admin/src/server/{controllers,models,services}` (imported as `@admin/server/...`, see [Admin app notes](#admin-app-notes)).

### Route layer

- Named exports: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- `withAuth(req, handler, { allowedAccountTypes? })` from `@studiq/server/lib/with-auth` builds the `RequestContext` (`traceId`, `userId`, `accountType`, `orgRoleId`, `activeOrgId`, `groupIds`, `permissionScopes`) and wraps the handler
- Handler receives **only `ctx`** — access `req` via closure
- Return `toNextResponse(await controller.method(data, ctx))` (`toNextResponse` from `@studiq/server/lib/http-utils`)

```typescript
// apps/web/src/app/(backend)/api/v1/flashcards/route.ts
import { flashcardController } from '@studiq/server/controllers/flashcard.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await flashcardController.list(ctx)));
}
```

> **API routes are only protected by `withAuth()` in the route file** — the proxy skips `/api/*` (see Route Protection). A new API route that doesn't call `withAuth` is public.

### Controller layer

- Singleton: `export const flashcardController = wrapService(new FlashcardController(flashcardService), 'flashcard.controller')` (`wrapService` from `@studiq/server/lib/observability`)
- Import directly: `import { flashcardController } from '@studiq/server/controllers/flashcard.controller'`
- Auth check: `if (!(await can(ctx, Permission.FLASHCARD_CREATE))) return controllerResponse.error('FORBIDDEN')` — `can`/`Permission` from `@studiq/server/lib/authz`
- Validate with Zod: `CreateFooSchema.safeParse(body)` → `controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues)`
- Services return a `ServiceResult`; map it with `isFailure(result)` → `controllerResponse.error(result.error)`, else `controllerResponse.success(result.data)` / `.created(...)`
- Never throw — always return a `ControllerResponse` object literal (`controllerResponse` helpers live in `@studiq/server/lib/controller-response`)
- Response shape:

```typescript
type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | { success: false; statusCode: number; error: AppErrorCode; details?: ZodIssue[]; errorId?: string };
```

### Model layer

```typescript
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const CreateFooSchema = registry.register(
  'CreateFooRequest',
  z.object({
    name: z.string().nonempty({ error: ValidationErrorCode.REQUIRED }),
  }),
);
export type CreateFooInput = z.infer<typeof CreateFooSchema>;
```

- Zod v4 API: `{ error: ValidationErrorCode.XXX }` instead of string messages
- Always import `{ z, registry }` from `@studiq/server/lib/zod` (never from `'zod'` directly) so schemas share one Zod instance
- Register every request schema with `registry.register()` — it keeps a central catalog of all request schemas (`registry.definitions`)

### Service layer

- Class + singleton re-exported at the bottom of each file:
  `export const flashcardService = wrapService(new FlashcardService(createClient), 'flashcard.service')`
- Create the Supabase client inside each method: `const supabase = await createClient()` from `@studiq/server/lib/supabase/server`
- Return a `ServiceResult` — `success(data)` / `failure(code)` from `@studiq/server/lib/service-result` — or `throw new AppError(code)` for hard failures (code only, no message)
- Map DB errors: `toDbFailure(error)` (→ `ServiceResult`) or `mapSupabaseError(error)` (→ throws `AppError`) from `@studiq/server/lib/supabase-errors`
- Permission checks (all from `@studiq/server/lib/authz`):
  - `await check(ctx, Permission.XXX, resource)` — throws `AppError('FORBIDDEN')` on mismatch
  - `await accessibleFilter(ctx, Permission.XXX, resourceType)` / `buildQueryFilter(ctx, Permission.XXX)` — RLS-safe filters for list queries
  - `hasPermission(ctx, Permission.XXX)` / `checkPermission(ctx, Permission.XXX, resource)` — synchronous ctx-only variants

### Admin app notes

- Admin API routes skip `withAuth` — they're gated by Ed25519 PEM signature verification in `apps/admin/src/proxy.ts` (see Route Protection)
- Admin controllers/services live in `apps/admin/src/server/*`, imported as `@admin/server/controllers/*.controller`
- Admin services use the service-role client: `@admin/lib/supabase/admin-client` (no user JWT, no RLS context)

---

## Error Handling

- `AppError(code: AppErrorCode)` — thrown by services (e.g. `check()` on a permission mismatch). `withAuth`'s catch block maps it to its HTTP status (`SyntaxError` → 400, anything else → 500 + `console.error`); routes can also catch explicitly with `handleApiError(error, fallback, ctx)` from `@studiq/server/lib/http-utils`. `withSupervision`/`wrapService` record failures as OTEL span errors
- Error codes → HTTP status via `APP_ERRORS` in `@studiq/server/lib/errors`:
  `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FEATURE_REQUIRES_UPGRADE` (402), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `GONE` (410), `UNPROCESSABLE_ENTITY` (422), `RATE_LIMITED` (429), `USAGE_LIMIT_EXCEEDED` (429), `INTERNAL_SERVER` (500), `SERVICE_UNAVAILABLE` (503)
- `mapSupabaseError` / `toDbFailure` map PG codes via `PG_ERROR_MAP`: PGRST116→NOT_FOUND, 23505→CONFLICT, 23503/23502/23514→BAD_REQUEST; anything else becomes a `DatabaseError` / `INTERNAL_SERVER`
- Business failures travel as `ServiceResult` (`success`/`failure`), not exceptions — see the Service layer

---

## Observability (OTel tracing)

There is **no logger module** — observability is OpenTelemetry spans (do not invent `@/lib/logger` imports).

- SDK is bootstrapped in `apps/web/src/instrumentation.ts` (NodeSDK + OTLP exporter); disabled when `OTEL_SDK_DISABLED=true` (unit tests set this)
- `withAuth` starts a span per API request; `withSupervision` / `wrapService` (`@studiq/server/lib/observability`) wrap every controller/service method — span name `service.method`, attributes include `duration.ms` and `error.code`
- Every authenticated request gets a `traceId` (UUID) on the `RequestContext`
- Agent step/tool traces are persisted via `enqueueTrace` (`@studiq/server/lib/trace-queue`) → `agent-trace.service`

---

## Supabase Clients

Use the right client for the context — there is **no browser-side Supabase client**; the frontend talks to the REST API via `apps/web/src/lib/api.ts`:

| File | When | How |
|------|------|-----|
| `packages/server/src/lib/supabase/server.ts` (`@studiq/server/lib/supabase/server`) | Server: API routes, services | `createServerClient` with cookie handling |
| `packages/server/src/lib/supabase/service.ts` (`@studiq/server/lib/supabase/service`) | Service role (migrations, admin ops) | Service role key, `autoRefreshToken: false`, `persistSession: false` |
| `packages/server/src/lib/supabase/session.ts` (`@studiq/server/lib/supabase/session`) | Web proxy session refresh | `updateSession(request)` |
| `apps/admin/src/lib/supabase/{service,admin-client}.ts` (`@admin/lib/supabase/...`) | Admin app | Service-role client (no user JWT) |

---

## Route Protection (proxy)

Next.js 16 uses `proxy.ts` — **do NOT rename it to `middleware.ts`**:

- `apps/web/src/proxy.ts` — main app: refreshes the Supabase session, then applies `routeRules`. It **skips `/api/*` entirely** — API auth is enforced per route by `withAuth()`.
- `apps/admin/src/proxy.ts` — admin app: Ed25519 PEM signature gate (`x-admin-signature` / `x-admin-timestamp` headers) for `/api/*`; UI pages pass through. Empty `ADMIN_PEM_KEYS` = allow-all in dev, deny-all in production.

Rules live in `packages/server/src/config/routes.config.ts` (`routeRules`) — evaluated in order:
1. If the user is logged in and `redirectIfAuthenticatedByAccountType` / `redirectIfAuthenticated` matches → redirect by account type
2. If `requireAuth` + no session → 401 (API) or redirect to `/login?next=…` (UI)
3. If `allowedAccountTypes` + account type mismatch → 403 (API) or redirect to the account-type dashboard (UI)

API catch-all rule (documents which API routes are public by design): `/api/v1/` requires auth except `auth`, `health`, `avatar`, `stripe/webhook`.

UI dashboards: `/manage` (MANAGER), `/edu` (EDUCATOR), `/app` (STUDENT). Login/register redirect logged-in users by account type. The system admin panel is the **separate `apps/admin` app** (port 4000), not a route in `apps/web`.

---

## RBAC

**Account types** (`AccountType` enum in `@studiq/authz` — `packages/authz/src/types.ts`):
`STUDENT | EDUCATOR | MANAGER`

- `RequestContext.accountType` carries the caller's type (from `app_metadata.account_type` in the JWT)
- **Permissions**: `Permission` map + `PermissionScope` (`own | group | organization | any`) in `@studiq/authz` (`packages/authz/src/lib/permissions.ts`)
- Scopes are resolved per request by `withAuth` from `org_role_permissions` for the active org (`active_org_id` cookie); students/educators default to `own` for CRUD actions outside an org role
- Server helpers (`@studiq/server/lib/authz`):
  - `can(ctx, permission, resource?)` / `check(ctx, permission, resource)` — async resource-aware checks (`check` throws `FORBIDDEN`) — **this is what controllers and services use**
  - `accessibleFilter(ctx, permission, resourceType)` / `buildQueryFilter(ctx, permission)` — RLS-safe query filters
  - `hasPermission(ctx, permission)` / `checkPermission(ctx, permission, resource)` — synchronous ctx-only variants
- Frontend: **`usePermission()` (`apps/web/src/hooks/use-permission.ts`) is the single source of truth for permission gating** — it returns a checker for one permission (`permission('deck.update', { createdBy })`) backed by `/api/v1/permissions/me`. Feature flags: `useFeature()` (`apps/web/src/hooks/use-feature.ts`) backed by `/api/v1/features/me` (`feature('ai.chat')`)

---

## i18n

- `next-intl` with `getRequestConfig` pulling locale from the `NEXT_LOCALE` cookie (defaults `'pl'`) — config in `apps/web/src/i18n/request.ts` and `apps/admin/src/i18n/request.ts`
- Messages in `apps/web/src/i18n/messages/{locale}.json` (admin: `apps/admin/src/i18n/messages/{locale}.json`) — nested per component/page
- ICU message format for plurals
- Server error codes are returned as `APP_ERRORS` codes (e.g. `ERROR_FORBIDDEN`); message files carry `ERROR_*` keys for most of them
- `Common` namespace auto-merged into all other namespaces (`mergeCommon` in `request.ts`)

---

## Frontend Conventions

### Data fetching

- `useApiQuery<T>({ queryKey, url, enabled?, staleTime?, gcTime? })` — wraps `useQuery`, default `staleTime: Infinity`, `gcTime: 30 min` (`apps/web/src/hooks/use-api.ts`)
- `useApiMutation<TData, TVars>({ mutationFn, invalidateKeys?, optimisticUpdate?, onMutate?, onError?, onSettled? })` — wraps `useMutation`, auto-invalidates keys on success and supports optimistic snapshots
- `apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiUploadFile` — raw fetch wrappers in `apps/web/src/lib/api.ts`
- Query keys in `apps/web/src/lib/query-keys.ts` — hierarchical `as const` assertions

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Services | `*.service.ts` | `question.service.ts` |
| Controllers | `*.controller.ts` | `question.controller.ts` |
| Models | `*.model.ts` | `question.model.ts` |
| Routes | `route.ts` | `apps/web/src/app/(backend)/api/v1/questions/route.ts` |
| Tests | `*.test.ts` | `question.service.test.ts` |
| Frontend hooks | `use-*.ts` | `use-api.ts` |

---

## Testing

| Type | Framework | Location | Notes |
|------|-----------|----------|-------|
| Unit | Vitest | `__tests__/unit/` | Mocked Supabase via `__tests__/setup.ts` |
| Integration | Vitest | `__tests__/integration/` | Real local Supabase instance |
| E2E | Playwright | `__tests__/e2e/` | Chromium, Firefox, WebKit |

- **Mock**: `vi.mock('@studiq/server/lib/supabase/server')` is registered in `__tests__/setup.ts` — unit tests override via the `mockSupabaseClient()` helper
- **Mock helper**: `__tests__/helpers/supabase-mock.ts`
- Tests run sequentially within files (`sequence.concurrent: false`); file-level parallelism is on (`fileParallelism: true`)
- Coverage targets `packages/server/src/**/*.ts` (excludes `routes.config.ts`)

---

## Import Paths

**Rule:** Never use relative import paths (`./...`, `../...`, `../../...`). **Always use full aliases:**

| Where | Alias | Example |
|-------|-------|---------|
| App code (web) | `@/` → `apps/web/src/` | `import { cn } from '@/lib/utils'` |
| App code (admin) | `@/` / `@admin/` → `apps/admin/src/` | `import { featureFlagController } from '@admin/server/controllers/feature-flag.controller'` |
| Shared backend | `@studiq/server/*` → `packages/server/src/*` | `import { withAuth } from '@studiq/server/lib/with-auth'` |
| Test-internal (files importing other files under `__tests__/`) | `#test/` → `__tests__/` | `import { before } from '#test/helpers/test-user'` |

- Mixed test files (importing both app + test code): `@/` (or `@studiq/*`) for app modules, `#test/` for test modules — never `./` or `../`.
- Applies to static imports, side-effect imports (`import './x'`), dynamic imports (`import('./x')`) and `require()`.
- Enforced by two guards, both wired into `bun run lint`:
  - **Biome** `lint/style/noRestrictedImports` (patterns `./**`, `../**`) — the root lint run covers `apps/web/src/` (packages have their own `biome ci src/` scripts).
  - **`bun scripts/check-import-paths.ts`** — covers `apps/web/src/`, `apps/admin/src/` and `__tests__/`.
- **`bun run lint` is expected to be green on `main`** — treat any failure as a real regression, not known debt.
- Asset imports (`.css`, `.svg`, images) follow the same rule: `@/app/globals.css` etc.

---

## Key Gotchas

- **Bare `bun test` ≠ Vitest** — it starts Bun's built-in test runner. Use `bun run test` / `bun run test:unit` (`vitest run __tests__/unit/`).
- **`lint` has no typecheck step** — run `bun run lint:all` (or `bun run typecheck`) when you need `tsc`.
- **`proxy.ts`**: Next.js 16 uses `proxy.ts` (not `middleware.ts`) — `apps/web/src/proxy.ts` (route rules) and `apps/admin/src/proxy.ts` (PEM signature gate). Do not rename.
- **`@studiq/server/lib/zod`**: Always import `{ z, registry }` from here, not from `'zod'` — shares one Zod instance and the schema registry
- **No backward compatibility layers**: Pre-market app. Delete old code paths and deprecated keys cleanly, never keep them "just in case"
- **Avatar routes**: `/api/v1/avatar/user/[seed]` and `/api/v1/avatar/org/[seed]` are public (DiceBear). `@dicebear/core` is server-only.
- **New API endpoints**: wrap every handler in `withAuth()` — the proxy skips `/api/*`, so a route without `withAuth` is public. Public-by-design prefixes must be added to the catch-all exclusion in `packages/server/src/config/routes.config.ts`.
- **New UI routes**: add a `RouteRule` to `packages/server/src/config/routes.config.ts` if the route needs auth, account-type restrictions, or a logged-in redirect.
- **New DB tables**: add a migration in `supabase/migrations/` (unique timestamp prefix — `bun run lint` enforces it) and schema in `supabase/schemas/`
- **No barrel files**: Every import uses direct file paths (e.g. `@studiq/server/services/flashcard.service` not `@studiq/server/services`). Biome's `noBarrelFile` and `noReExportAll` rules enforce this.
- **Root `tsconfig.json`** excludes `apps/admin` (it has its own config and `typecheck:admin` script) — hand-run root `bunx tsc --noEmit` must stay at zero errors; use the per-workspace scripts for app code.

---

## Code Review Checklist

When reviewing PRs (especially stacked PRs), follow this process to avoid false positives:

### Setup

1. **Check out the top PR's branch** (not `main`) to see the full cumulative state:
   ```bash
   gh pr checkout <top-pr-number> --repo logyQT/studiq
   ```
2. **For stacked PRs**, identify the stack order from the `stack` field in the GitHub API response, or from each PR's base branch.

### For each PR in the stack

1. **Fetch the diff** — `gh pr diff <number> --repo logyQT/studiq`
2. **Verify against the actual file on the PR's head branch** — `git show <head-sha>:<path>` or just `cat` the file. Diffs show *changes relative to the PR's base*, not relative to `main`. A line can appear as "added" in the diff while already existing on `main`.
3. **Check what the PR claims to change** against what the diff actually changes. If a PR says "adds X" but the diff only shows X being modified (not added), the feature likely already existed.
4. **Run the test suite** if touching business logic — `bun run test:unit`
5. **Run the linter** — `bun run lint`

### Common false-positive patterns in stacked PR diffs

| Diff shows | Looks like | Actually is |
|------------|-----------|-------------|
| `+` line that also appears in an earlier PR in the stack | "PR adds this" | Earlier PR added it; this PR just touched the same area |
| No diff for a file the PR description mentions | "PR forgot the file" | Change is in a different file (e.g. model vs service) |
| `+/-` on the same line | "PR broke something" | Formatting-only change (Biome/Prettier) |

### Rule of thumb

> **Diffs tell you what changed. Files tell you what exists. Always check both.**
