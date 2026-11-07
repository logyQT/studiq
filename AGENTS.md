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
│   └── admin/                      # Internal admin panel, port 4000 — package `@studiq/admin` (no app-level auth; not deployed)
│       └── src/
│           ├── app/(backend)/api/v1/*            # Admin API routes (service role; no `withAuth`, not deployed)
│           ├── app/(frontend)/                   # Admin pages
│           ├── server/{controllers,models,services}   # Admin-only backend (imports via `@admin/*`)
│           └── lib/ i18n/
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

## Issue Ownership

**Assigned work belongs to whoever is assigned.** Before you touch an issue, look at it:

```bash
gh issue view <n> --json number,state,assignees
```

- **Any assignee other than your operator means stop.** Do not design it, code it, branch for it, or open a PR for it — even if it looks trivial, even if it is unblocked, even if you think you are helping. Say `skipped #<n>: owned by <login>` and move on.
- **Claim what you pick up.** The first time you start an issue, assign your operator _before_ the first commit:

  ```bash
  gh issue edit <n> --add-assignee <operator-login>
  ```

  The operator login is the human you work for — `QA_OPERATOR_GH` in automated crews, `logyQT` on this repo. It is **not** the bot/agent account that authors the PR.

- **Never unassign or reassign** someone else's issue. Only the operator can hand an issue over; if they do, reassign it first, then start.
- **Bots do not count as owners** (`dependabot`, `github-actions`). An issue assigned only to a bot is fair game.

This is enforced by the QA pipeline: `qa-fix.py` re-checks assignees at dispatch time and refuses foreign-owned issues, and holds a merge if ownership changes mid-flight. Crews that work outside the pipeline rely on this rule directly.

---

## Commands

`package.json` at the repo root is the **source of truth** — if anything below disagrees with it, trust `package.json`.

| Command                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                     | Web dev server (`next dev`) on `APP_PORT` (default 3000) — **agents use `dev:build` + `dev:serve` instead**                                                                                                                                                                                                                                                                                                                                                                                                             |
| `bun run dev:up`                  | **One-command local stack** — this branch's Supabase stack (if needed) + web dev, renders `apps/web/.env`; never installs/builds/resets. `--prod` = build (if missing) + `next start`                                                                                                                                                                                                                                                                                                                                   |
| `bun run dev:serve`               | `next start` for this checkout on `APP_PORT` (production server, no dev server)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `bun run dev:status`              | Web/Supabase health, PIDs, stack id/endpoints (`--json` = stable machine shape)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `bun run dev:down`                | Stop this checkout's web server; `bun dev:down --all` also stops **this branch's** Supabase stack (data kept)                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bun run dev:reset-db`            | Explicit, destructive `supabase db reset` for **this branch's** stack (never called by `dev:up`)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bun run dev:build`               | Explicit production build of `@studiq/web` (serialized by a registry-level build lock)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `bun run dev:doctor`              | Explain missing / owned / colliding state (exit 1 on a real conflict)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bun run dev:ports`               | Print a free `APP_PORT` (`--suggest` default, `--json`); Supabase ports are assigned per stack                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bun run dev:logs`                | Follow `.dev/web.log` + this stack's logs                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `bun run dev:prepull`             | Download stack images without starting the stack (VM templates)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `bun run dev:admin`               | Admin dev server (port 4000) — **not** part of `dev:up`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `bun run build` / `bun run start` | Production build / start for web (`build:admin`, `start:admin` for admin)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `bun run lint`                    | `bun scripts/check-bun-version.ts && bun lint --no-script apps/web/src packages __tests__ && bun scripts/check-import-paths.ts && bun scripts/check-migration-timestamps.ts && bun scripts/check-hardcoded-urls.ts && bun scripts/check-suppressions-empty.ts` — **whole-repo** Bun native linter (apps, packages, tests) + import-path guard + migration-timestamp guard + hardcoded-local-URL guard + suppression-ledger guard. **Contains no typecheck step.** Does not include `apps/admin/src` (use `lint:admin`). |
| `bun run lint:all`                | `bun run typecheck:all && bun run lint` — all typechecks + lint in one command                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bun run knip`                    | `knip --treat-config-hints-as-errors --no-progress` — dead-code / unused-dependency gate (documented policy suppressions in `knip.ts`, each with a reason). Also runs in both lefthook hooks and the `checks` CI job. **Not** part of `bun run lint`.                                                                                                                                                                                                                                                                   |
| `bun run knip:report`             | `knip --reporter compact` — human-readable report (one line per file); `knip:files` / `knip:deps` / `knip:exports` filter to one issue group                                                                                                                                                                                                                                                                                                                                                                            |
| `bun run typecheck`               | `bun check` for **`apps/web` only** (`typecheck:admin` → `apps/admin`, `typecheck:packages` → `packages/{server,authz,ui}`)                                                                                                                                                                                                                                                                                                                                                                                             |
| `bun run typecheck:all`           | `bun check` at the repo root (covers `scripts/`, which no workspace does) + `typecheck` + `typecheck:packages` — everything the hooks run. `apps/admin` is checked manually with `typecheck:admin`.                                                                                                                                                                                                                                                                                                                     |
| `bun run format`                  | `bun fmt .` (whole repo — writes formatting for JS/TS/JSON/CSS **and** Markdown/YAML/TOML/HTML)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `bun run format:check`            | `bun fmt --check .` (whole repo, check only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bun run clean`                   | Remove `.next`, `coverage`, cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `bun run test`                    | `vitest run __tests__/unit/ __tests__/integration` — all product tests (admin tests are separate; see `test:admin`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `bun run test:unit`               | `vitest run __tests__/unit/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bun run test:integration`        | `vitest run __tests__/integration` (needs a local Supabase instance)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `bun run test:admin`              | `vitest run __tests__/admin` — admin-only tests, never part of the product gate (integration needs Supabase)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bun run test:watch`              | `vitest` (watch mode)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bun run test:coverage`           | `vitest run --coverage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `bun run test:e2e`                | `playwright test` — runs `__tests__/e2e/` specs                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

> **Footgun — bare `bun test` is NOT Vitest.** `bun test` starts **Bun's built-in test runner**, which scans the whole repo (including integration tests that need live Supabase) and reports differently. Always use `bun run test` / `bun run test:unit`. Bare `bun <script>` shorthand does work for other scripts (e.g. `bun test:unit`).

Git hooks (lefthook) enforce this on every commit/push: **pre-commit** runs format-on-staged + `bun run lint` + `bun run knip` + `bun run typecheck:all`; **pre-push** runs `format:check`, `lint`, `knip`, `typecheck:all`, `test:unit`, plus a merge-conflict check against `origin/main`. The staged-file formatter and `bun run lint` check the **same** scope, so a commit can never pass the hook and fail the script (or vice versa). `knip` is a hard gate in both hooks (no advisory `|| true`): every suppression in `knip.ts` is policy with a reason, and `--treat-config-hints-as-errors` fails a stale entry — remove it in the same change that removes the finding it covers.

### Local dev (one command)

```bash
bun install            # once per checkout — dev:up never installs
cp .env.example .env   # once; root .env is Git-ignored and is the only hand-edited env file
bun dev:up             # this branch's Supabase stack (if needed) + web server on APP_PORT
bun dev:status         # health/stack id/endpoints; `--json` for scripts and agents
bun dev:down           # stop this checkout's web; `--all` also stops this branch's Supabase stack
```

> **Supabase is per git worktree + branch.** Local mode uses the experimental
> `supabase stack` backend (`[experimental] stack = true`): the CLI assigns ports
> (20000-32767) and keeps a separate database per project root, branch and
> optional `SUPABASE_STACK` name. Only `APP_PORT` can collide between checkouts —
> set it in `.env` (`bun dev:ports` prints a free one). A branch switch
> creates/resumes its own stack; moving/renaming the checkout creates a new one.
> `bun dev:down --all` stops the stack and keeps its data;
> `bunx supabase stack destroy` deletes it; add `--stack "$SUPABASE_STACK"` for a named stack.
> Never run `supabase stop --all` (it stops
> every stack on the machine), and never stop/reset a stack you did not start.
> Agents must use `bun dev:build` + `bun dev:serve` (or `bun dev:up --prod`),
> not `next dev`.

- **`scripts/dev` is the implementation** (Bash); the `dev:*` package scripts are thin aliases. Local defaults: web `APP_PORT=3000`; Supabase ports are assigned by the CLI and discovered from `supabase status --output-format json` (no port math). In **stack mode**, `scripts/dev` synthesizes `SUPABASE_PROJECT_ID=stack-<short id>` only as a display label for `dev:status`; it is not used for stack identity or port allocation, and no path-derived id is used there. In **shared/non-stack mode** (`SUPABASE_SHARED=1` or CI), `SUPABASE_PROJECT_ID` is still derived from the checkout path when unset (or accepted from root `.env` / the CI environment) and exported for `supabase/config.toml`'s `project_id`.
- **Stack identity is the CLI's**: project root + current git branch + `SUPABASE_STACK` name (blank = the branch's default stack). `scratch`/test stacks can run side by side with `SUPABASE_STACK=test bun dev:up`.
- **`bun run dev:status --json`** reports `stackId`, `branch`, endpoints and the app/web health. Bare `bunx supabase ...` targets the branch's **default** stack. For a named stack, set `SUPABASE_STACK` (e.g. `export SUPABASE_STACK=test`) and pass `--stack "$SUPABASE_STACK"` to `status`/`start`/`stop`/`logs`. Database commands do not accept `--stack`; read the URL first: `DB_URL=$(bunx supabase status --stack "$SUPABASE_STACK" --env | sed -n "s/^DB_URL='\(.*\)'$/\1/p")`, then use `--remote="$DB_URL" --yes`.
- **CI is deliberately non-stack**: `verify.yml` sets `SUPABASE_EXPERIMENTAL_STACK=0` and supplies the fixed `SUPABASE_*_PORT` variables. Runners are already isolated, so the experimental surface stays out of the gate. The shared QA stack likewise keeps its fixed ports until the dashboard can discover stack ports.
- **⚠️ TEMPORARY — auth e-mail template workaround (do not build on this)**: stack projects in CLI 3.x cannot serve `content_path` templates. `supabase/config.toml` therefore keeps `content_path = ""` (stack boots and uses Supabase defaults), and the non-stack CI QA job injects the branded files through `SUPABASE_AUTH_EMAIL_TEMPLATE_RECOVERY_CONTENT_PATH` / `...CONFIRMATION_CONTENT_PATH`. This keeps **one config gated by env**; it is a workaround, not a design. Remove it when stack can serve templates. If the stack backend is deprecated first, restore the literal `content_path` values and go back to manual local provisioning. `AUT-01/02/06/12` depend on the branded `/auth/callback?token_hash=…` links; locally run those against the non-stack/shared stack, not a stack-mode project.
- **Ownership/build lock**: the runtime registry outside the repo (`${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/studiq-dev-$(id -u)`, override `STUDIQ_DEV_REGISTRY`) now holds the cross-checkout build lock (and shared-mode ownership only). The directory must be private and owned by you: `scripts/dev` refuses a symlink or an existing directory it does not own, forces mode `700`, and ignores untrusted entries on read. `supabase stop --all`, `pkill` and unscoped `docker rm` are never used.
- **`SUPABASE_SHARED=1`** runs the app/tests against a stack another checkout owns (shared QA). `dev:up` never starts Supabase, and `dev:down --all` / `dev:reset-db` / `supabase stop` are refused. Root `.env` must provide `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- **Root `.env` is the only hand-edited env file.** `dev:up` reads it, resolves `APP_PORT`/`APP_URL` and renders two generated, Git-ignored, mode-`600` files: **`apps/web/.env`** (app runtime, from `supabase status`) and **`supabase/.env`** (only `APP_URL`, so plain `bunx supabase ...` can parse the config). A user-provided key in root `.env` is never overwritten.
- **`dev:up` is fast and idempotent**: no `bun install`, no `next build`, no `supabase db reset`, no seeds or manual migrations. Cold time is dominated by the first `supabase start` (image pull). Supabase starts **lean** with `supabase start --eager -x realtime,functions,analytics,pooler` (capability names, not the old container names); set `SUPABASE_START_EXCLUDE=` in `.env` for the full stack. `dev:up --prod` builds once (held by the registry build lock, `DEV_BUILD_MEMORY_MB=4096`) and then serves.
- **Destructive/explicit steps are separate**: `bun dev:reset-db` (drops and re-seeds **this branch's** DB) and `bun dev:build` (production build; stop the web server first). `bun dev:prepull` runs `supabase stack install` for VM templates.
- **The shared QA stack is protected**: `dev:up` refuses `APP_URL`/`SUPABASE_URL` on `:3010` / `:54421` unless `DEV_ALLOW_SHARED=1` (or the checkout is in `SUPABASE_SHARED=1` mode).
- **`apps/admin` is out of scope** for `dev:up`: it keeps its own `apps/admin/.env` and `bun dev:admin`.

| Variable                        | Source                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `APP_PORT`                      | root `.env` (default `3000`)                                                             |
| `APP_URL`                       | root `.env` (defaults to `http://localhost:$APP_PORT`)                                   |
| `APP_ENV`                       | root `.env` (default `development` in `scripts/dev`; the app defaults to `production`)   |
| `NEXT_PUBLIC_SITE_URL`          | root `.env` (defaults to `APP_URL`)                                                      |
| `SUPABASE_STACK`                | root `.env`; named stack in this checkout (blank = branch default)                       |
| `SUPABASE_START_EXCLUDE`        | root `.env`; `supabase stack start -x` capabilities (default skips unused; empty = full) |
| `NEXT_PUBLIC_SUPABASE_URL`      | discovered from `supabase status` (explicit only for shared/remote)                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | root `.env` (shared mode) or `supabase status` (local stack)                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | root `.env` (shared mode) or `supabase status` (local stack)                             |
| `SUPABASE_SHARED`               | root `.env` (`0`/`1`; shared mode refuses destructive commands)                          |
| `STUDIQ_DEV_REGISTRY`           | root `.env`; blank = `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/studiq-dev-$(id -u)`           |
| `DEV_BUILD_MEMORY_MB`           | root `.env` (default `4096`) — `dev:build` heap cap                                      |
| `OTEL_*`                        | root `.env` (copied verbatim into `apps/web/.env`)                                       |

### Formatting scope & blame

`bun fmt` covers JS/TS/JSON/CSS **and** Markdown, YAML, TOML and HTML. Three patterns stay out of scope via `[fmt] ignorePatterns` in `bunfig.toml`: `**/*.jsonc` (bun fmt adds trailing commas, which some JSONC readers reject), `.agents/skills/**` (vendored skill content, checksummed in `skills-lock.json`) and `eslint-suppressions.json` (the ledger `bun lint` generates).

Repo-wide formatting passes are listed in **`.git-blame-ignore-revs`** so `git blame` blames the last real change instead of the reformat. Enable it once per clone (git does not read the file automatically — GitHub does):

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Add the commit hash to that file in the same PR when you land a formatting-only change, and land it with a merge commit (squash/rebase rewrites the hash).

### Custom agent commands

| If you say       | What I do                                                 |
| ---------------- | --------------------------------------------------------- |
| `commit propose` | `git diff --staged` → propose conventional commit message |

### Developer workflow scripts

These scripts help devs (and agents) work with feature branches and isolated worktrees:

| Script                            | What it does                                                        |
| --------------------------------- | ------------------------------------------------------------------- |
| `scripts/switch-branch [branch]`  | Stash WIP → switch branch → pull → pop stash. Only stashes if dirty |
| `scripts/switch-branch -c <name>` | Create a new branch from main, then switch to it                    |
| `scripts/spin <branch>`           | Create a feature branch + git worktree beside the checkout          |
| `scripts/spin --list`             | List all active worktrees                                           |
| `scripts/spin <branch> --clean`   | Remove worktree and delete branch                                   |
| `scripts/pr [title]`              | Create a PR from current branch via `gh` CLI                        |
| `scripts/pr --draft`              | Create a draft PR                                                   |
| `scripts/pr --list`               | List open PRs for this repo                                         |

#### Multi-worktree workflow

Use worktrees to run parallel tasks (e.g. multiple agents, or dev server + tests) without conflicts:

```bash
# Spin up an isolated workspace
scripts/spin feat/quiz-ui

# Move your session into it
cd ../studiq-feat-quiz-ui

# Do work, commit, push
git add -A && git commit -m "feat: add quiz UI"
git push -u origin feat/quiz-ui

# Create PR from inside the worktree
scripts/pr

# Clean up when merged
scripts/spin feat/quiz-ui --clean
```

Each worktree gets its own branch, working directory, and can run `bun run dev` independently. The main checkout stays untouched. Worktrees are created beside the repo as `../<repo>-<branch>` (slashes become dashes: `feat/quiz-ui` → `../studiq-feat-quiz-ui`); `.worktrees/` inside the repo is reserved for the QA environments (`qa-env-N`).

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

- `@/` → `src/` **of the app the file lives in**: `apps/web/src`, `apps/admin/src`. In root-level files (`scripts/`, root configs) and in Vitest, `@/` resolves to `apps/web/src`. It is **not** mapped inside `packages/*` — a package-local `@/` would resolve to the _consuming app's_ `src/` (wrong module, sometimes silently), so package code never uses `@/` (see Import Paths below).
- `@studiq/server/*`, `@studiq/authz`, `@studiq/ui` → `packages/*/src/*` — wired in every app `tsconfig.json` and `vitest.config.ts`.
- `@admin/*` → `apps/admin/src/*` (admin app code; also usable from root-level tests).
- `#test` → `__tests__/` — works in both Vitest **and** Playwright (declared in vite config + tsconfig `paths`). Use it for imports _between_ test files.

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
  | {
      success: false;
      statusCode: number;
      error: AppErrorCode;
      details?: ZodIssue[];
      errorId?: string;
    };
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

- `apps/admin` is an **internal tool, not a product surface**, and has **no app-level auth**. It is **not deployed** (repo-only/local-only): admin API routes skip `withAuth` and use the service-role client. Do not deploy it until the ordered blockers in `docs/decisions/0009-admin-is-internal-not-deployed.md` clear; if it is ever deployed, the edge gate is mandatory. See that ADR.
- Admin controllers/services live in `apps/admin/src/server/*`, imported as `@admin/server/controllers/*.controller`
- Admin services use the service-role client: `@admin/lib/supabase/admin-client` (no user JWT, no RLS context)

---

## Error Handling

- `AppError(code: AppErrorCode)` — thrown by services (e.g. `check()` on a permission mismatch). `withAuth`'s catch block maps it to its HTTP status (`SyntaxError` → 400, `AppError` → its status, anything else → 500) and records the exception on the root span; **every 4xx/5xx response is logged** (WARN/ERROR) via `@studiq/server/lib/log` (which falls back to `console` when the OTel pipeline is off). Routes can also catch explicitly with `handleApiError(error, fallback, ctx)` from `@studiq/server/lib/http-utils`. `withSupervision`/`wrapService` record failures as OTEL span errors
- Error codes → HTTP status via `APP_ERRORS` in `@studiq/server/lib/errors`:
  `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FEATURE_REQUIRES_UPGRADE` (402), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `GONE` (410), `UNPROCESSABLE_ENTITY` (422), `RATE_LIMITED` (429), `USAGE_LIMIT_EXCEEDED` (429), `INTERNAL_SERVER` (500), `SERVICE_UNAVAILABLE` (503)
- `mapSupabaseError` / `toDbFailure` map PG codes via `PG_ERROR_MAP`: PGRST116→NOT_FOUND, 23505→CONFLICT, 23503/23502/23514→BAD_REQUEST; anything else becomes a `DatabaseError` / `INTERNAL_SERVER`
- Business failures travel as `ServiceResult` (`success`/`failure`), not exceptions — see the Service layer

---

## Observability (OTel traces + metrics + logs)

Telemetry is OpenTelemetry-only. Traces/metrics/logs all ship via OTLP to the
OTel Collector (`docker compose up`), which fans out to Tempo (traces),
Prometheus (metrics) and Loki (logs); Grafana runs at `:3001`.

- SDK is bootstrapped in `apps/web/src/instrumentation.ts` (NodeSDK: OTLP trace
  exporter + `PeriodicExportingMetricReader` + `BatchLogRecordProcessor` over a
  `LoggerProvider`); everything is disabled when `OTEL_SDK_DISABLED=true` (unit
  tests set this)
- `withAuth` starts a span per API request, sets `ctx.traceId` to the real span
  trace id, and returns it in the **`x-trace-id`** response header (success and
  error paths); the app error code is echoed as `x-error-code`. The root
  `METHOD /api/**` span is marked `ERROR` for any `http.status_code >= 400`, and
  **every 4xx/5xx response is logged** (WARN for 4xx, ERROR for 5xx) with
  `http.method`, `http.url`, `http.status_code` and `error.code`, so failures are
  searchable in Loki and correlated to Tempo by `trace_id`. `withSupervision` /
  `wrapService` (`@studiq/server/lib/observability`) wrap every controller/service
  method — span name `service.method`, attributes include `duration.ms` and `error.code`
- Metrics live in `@studiq/server/lib/observability.ts` (`metrics.getMeter('studiq')`):
  `http.server.duration`, `http.server.request.total`, `http.server.active_requests`
  (recorded in `withAuth`) and `controller.method.duration` (recorded in
  `withSupervision`). The Collector adds the `studiq` namespace. **Bounded labels
  only** (`http.method`, `http.status_code`, `service.name`, `code.function`,
  `account_type`) — never `user_id`/`trace_id`
- `supabase-errors.ts` annotates the active span with `db.error.code/_message/_details/_hint`
  before collapsing a Postgres error into a generic `AppErrorCode`, so failures
  aren't bare `BAD_REQUEST`
- **`packages/server/src/lib/log.ts` is the one deliberate logger module**
  (`log()` / `warn()` / `error()` over `logs.getLogger('studiq')`). It exists so
  records carry the active `trace_id` for Loki ↔ Tempo correlation, and **falls
  back to `console` whenever the logs pipeline is inactive** (`OTEL_SDK_DISABLED=true`
  or before `instrumentation.ts` registers the provider) so errors are never lost.
  Do not invent `@/lib/logger` or add a second logging abstraction
- Agent step/tool traces are persisted via `enqueueTrace` (`@studiq/server/lib/trace-queue`) → `agent-trace.service`
- Config: `otel-collector-config.yml`, `tempo.yml`, `loki-config.yml`,
  `prometheus.yml`, `grafana/`. Debugging loop: `docs/observability-debugging.md`

---

## Supabase Clients

Use the right client for the context — there is **no browser-side Supabase client**; the frontend talks to the REST API via `apps/web/src/lib/api.ts`:

| File                                                                                  | When                                 | How                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `packages/server/src/lib/supabase/server.ts` (`@studiq/server/lib/supabase/server`)   | Server: API routes, services         | `createServerClient` with cookie handling                            |
| `packages/server/src/lib/supabase/service.ts` (`@studiq/server/lib/supabase/service`) | Service role (migrations, admin ops) | Service role key, `autoRefreshToken: false`, `persistSession: false` |
| `packages/server/src/lib/supabase/session.ts` (`@studiq/server/lib/supabase/session`) | Web proxy session refresh            | `updateSession(request)`                                             |
| `apps/admin/src/lib/supabase/{service,admin-client}.ts` (`@admin/lib/supabase/...`)   | Admin app                            | Service-role client (no user JWT)                                    |

---

## Route Protection (proxy)

Next.js 16 uses `proxy.ts` — **do NOT rename it to `middleware.ts`**:

- `apps/web/src/proxy.ts` — main app: for non-API paths it refreshes the Supabase session, then applies `routeRules`. Every `/api/*` request returns early — before the session refresh and before any rule is evaluated — so `withAuth()` in the route file is the authoritative (and only) API authentication gate.
- `apps/admin` has **no `proxy.ts`** and no app-level auth, and it is **not deployed**. Its API routes are not `withAuth`-protected. Do not expose it; deployment is blocked until the ADR-0009 blockers clear. See `docs/decisions/0009-admin-is-internal-not-deployed.md`.

Rules live in `packages/server/src/config/routes.config.ts` (`routeRules`) — evaluated in order. The `/api/*` entries are documentation only: the proxy returns for `/api/*` before `routeRules` is consulted, so they never run.

1. If the user is logged in and `redirectIfAuthenticatedByAccountType` / `redirectIfAuthenticated` matches → redirect by account type
2. If `requireAuth` + no session → 401 (API) or redirect to `/login?next=…` (UI)
3. If `allowedAccountTypes` + account type mismatch → 403 (API) or redirect to the account-type dashboard (UI)

API catch-all rule (documents the intended public prefixes — it does **not** enforce API authentication, because `apps/web/src/proxy.ts` skips `/api/*` before evaluating `routeRules`): `/api/v1/` is intended to be `withAuth()`-protected except for `auth`, `health`, `avatar`, `subscription-plans`, `stripe/webhook`. `subscription-plans` is the public pricing catalogue (`listPublic`/`getByKey`, no session). `stripe/webhook` is excluded from the proxy rule only so a real Stripe webhook can stay unauthenticated; the mock webhook authenticates the caller itself (`withAuth`) and only acts on that caller's own account. A new route outside this set is public unless it calls `withAuth()`.

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

| Type           | Pattern           | Example                                                |
| -------------- | ----------------- | ------------------------------------------------------ |
| Services       | `*.service.ts`    | `question.service.ts`                                  |
| Controllers    | `*.controller.ts` | `question.controller.ts`                               |
| Models         | `*.model.ts`      | `question.model.ts`                                    |
| Routes         | `route.ts`        | `apps/web/src/app/(backend)/api/v1/questions/route.ts` |
| Tests          | `*.test.ts`       | `question.service.test.ts`                             |
| Frontend hooks | `use-*.ts`        | `use-api.ts`                                           |

---

## Testing

| Type        | Framework  | Location                 | Notes                                    |
| ----------- | ---------- | ------------------------ | ---------------------------------------- |
| Unit        | Vitest     | `__tests__/unit/`        | Mocked Supabase via `__tests__/setup.ts` |
| Integration | Vitest     | `__tests__/integration/` | Real local Supabase instance             |
| E2E         | Playwright | `__tests__/e2e/`         | Chromium, Firefox, WebKit                |

- **Mock**: `vi.mock('@studiq/server/lib/supabase/server')` is registered in `__tests__/setup.ts` — unit tests override via the `mockSupabaseClient()` helper
- **Mock helper**: `__tests__/helpers/supabase-mock.ts`
- Tests run sequentially within files (`sequence.concurrent: false`); file-level parallelism is on (`fileParallelism: true`)
- Coverage targets `packages/server/src/**/*.ts` (excludes `routes.config.ts`)
- **Load testing**: `scripts/load-test/` — `seed.ts` provisions accounts via the Supabase Admin API; `bots.ts` drives concurrent role-based journeys (`--shards` spreads them over CPU cores). See `scripts/load-test/README.md`

---

## Import Paths

**Rule:** Never use relative import paths (`./...`, `../...`, `../../...`). **Always use full aliases:**

| Where                                                          | Alias                                                     | Example                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| App code (web)                                                 | `@/` → `apps/web/src/`                                    | `import { cn } from '@/lib/utils'`                                                          |
| App code (admin)                                               | `@/` / `@admin/` → `apps/admin/src/`                      | `import { featureFlagController } from '@admin/server/controllers/feature-flag.controller'` |
| Shared backend                                                 | `@studiq/server/*` → `packages/server/src/*`              | `import { withAuth } from '@studiq/server/lib/with-auth'`                                   |
| Inside a package (`packages/*`)                                | relative (`./`, `../`) — **within the same package only** | `import { PermissionScope } from './permissions'`                                           |
| Test-internal (files importing other files under `__tests__/`) | `#test/` → `__tests__/`                                   | `import { before } from '#test/helpers/test-user'`                                          |

- Mixed test files (importing both app + test code): `@/` (or `@studiq/*`) for app modules, `#test/` for test modules — never `./` or `../`.
- Applies to static imports, side-effect imports (`import './x'`), dynamic imports (`import('./x')`) and `require()`.
- Enforced by two guards, both wired into `bun run lint`:
  - **Bun lint** `no-restricted-imports` (patterns `./**`, `../**`) — enabled for `apps/web/src`, `apps/admin/src` and `__tests__`; **disabled for `packages/**`** (a package must use relative imports internally — see the table above).
  - **`bun scripts/check-import-paths.ts`** — bans _all_ relative imports in `apps/web/src`, `apps/admin/src` and `__tests__`, and bans _cross-package_ relative imports in `packages/*` (intra-package relatives are allowed).
- `bun run lint` runs `bun lint` over the same scopes, so packages and tests are linted by the same command the hooks run.
- **`bun run lint` is expected to be green on `main`** — treat any failure as a real regression, not known debt.
- Asset imports (`.css`, `.svg`, images) follow the same rule: `@/app/globals.css` etc.

---

## Key Gotchas

- **Bare `bun test` ≠ Vitest** — it starts Bun's built-in test runner. Use `bun run test` / `bun run test:unit` (`vitest run __tests__/unit/`).
- **`next start` keep-alive**: `apps/web`'s `start` script passes `--keepAliveTimeout 55000` (and every runner that calls `next start` directly must too). Node's 5 s default closes an idle keep-alive socket while Playwright's `APIRequestContext` — a raw `http.Agent({ keepAlive: true })` with no `ECONNRESET` retry — is still pooling it, so the next `page.request.*` after a UI phase dies with `read ECONNRESET`. Keep the value below Node's 60 s `headersTimeout`; Next exposes no flag to raise that one.
- **`lint` has no typecheck step** — run `bun run lint:all` (or `bun run typecheck`) when you need a typecheck.
- **`proxy.ts`**: Next.js 16 uses `proxy.ts` (not `middleware.ts`) — `apps/web/src/proxy.ts` (route rules). `apps/admin` has no proxy and no app-level auth, and it is not deployed; if it is ever deployed, protect it at the edge. Do not rename.
- **`@studiq/server/lib/zod`**: Always import `{ z, registry }` from here, not from `'zod'` — shares one Zod instance and the schema registry
- **No backward compatibility layers**: Pre-market app. Delete old code paths and deprecated keys cleanly, never keep them "just in case"
- **Avatar routes**: `/api/v1/avatar/user/[seed]` and `/api/v1/avatar/org/[seed]` are public (DiceBear). `@dicebear/core` is server-only.
- **New API endpoints**: wrap every handler in `withAuth()` — the proxy skips `/api/*`, so a route without `withAuth` is public. Public-by-design prefixes must be added to the catch-all exclusion in `packages/server/src/config/routes.config.ts`.
- **New UI routes**: add a `RouteRule` to `packages/server/src/config/routes.config.ts` if the route needs auth, account-type restrictions, or a logged-in redirect.
- **New DB tables**: add a migration in `supabase/migrations/` (unique timestamp prefix — `bun run lint` enforces it) and schema in `supabase/schemas/`
- **Payment posture uses `APP_ENV`, never `NODE_ENV`** — production is the default; `PAYMENT_DRIVER=mock` is a boot error there (no override), production rejects test keys and needs an `https://` non-localhost site URL. Dev/test/QA must set `APP_ENV` explicitly. See `packages/server/src/lib/app-env.ts` and `docs/deployment.md`.
- **Supabase `eq(col, null)` is not `IS NULL`** — `.eq('organization_id', ctx.activeOrgId)` with `activeOrgId === null` serialises to `organization_id=eq.null`, which Postgres rejects on a `uuid` column (`22P02`, surfacing as a 500 — #148). For NOT NULL org columns guard first (`if (!ctx.activeOrgId) return failure('FORBIDDEN')`); for nullable-org personal content apply the org filter only when set (`if (ctx.activeOrgId) query = query.eq(...)`), matching `accessibleFilter`'s `own` scope.
- **No barrel files**: Every import uses direct file paths (e.g. `@studiq/server/services/flashcard.service` not `@studiq/server/services`). Bun lint's `oxc/no-barrel-file` rule enforces this. Sole exception: a package entrypoint (`packages/<name>/src/index.ts`) must re-export its public surface — `oxc/no-barrel-file` is disabled for those two files.
- **Root `tsconfig.json`** excludes `apps/admin` (it has its own config and `typecheck:admin` script) — a hand-run root `bun check` must stay at zero errors; use the per-workspace scripts for app code.

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
2. **Verify against the actual file on the PR's head branch** — `git show <head-sha>:<path>` or just `cat` the file. Diffs show _changes relative to the PR's base_, not relative to `main`. A line can appear as "added" in the diff while already existing on `main`.
3. **Check what the PR claims to change** against what the diff actually changes. If a PR says "adds X" but the diff only shows X being modified (not added), the feature likely already existed.
4. **Run the test suite** if touching business logic — `bun run test:unit`
5. **Run the linter** — `bun run lint`

### Common false-positive patterns in stacked PR diffs

| Diff shows                                               | Looks like           | Actually is                                             |
| -------------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| `+` line that also appears in an earlier PR in the stack | "PR adds this"       | Earlier PR added it; this PR just touched the same area |
| No diff for a file the PR description mentions           | "PR forgot the file" | Change is in a different file (e.g. model vs service)   |
| `+/-` on the same line                                   | "PR broke something" | Formatting-only change (formatter)                      |

### Rule of thumb

> **Diffs tell you what changed. Files tell you what exists. Always check both.**
