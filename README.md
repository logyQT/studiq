# Studiq

Private edtech platform with quizzes, flashcards, AI-powered learning flows, and university management.

## Features

- Authentication with role-based access control (student, educator, manager)
- Quiz engine with attempt tracking and review
- Flashcard practice with SM-2 spaced repetition algorithm
- AI-powered flashcard generation from PDFs (SSE streaming)
- Real-time statistics dashboards via Supabase Realtime
- Teacher dashboard with per-deck and per-topic breakdowns
- Student study dashboard with due-card tracking
- University and membership management
- Invitation system with token-based registration
- Developer study simulator for testing SM-2 at scale
- Multi-language support (en, pl) via next-intl
- Standalone system administration panel (`apps/admin`, port 4000, PEM-gated)

## Tech Stack

| Layer           | Technology                               |
| --------------- | ---------------------------------------- |
| Framework       | Next.js 16 (App Router)                  |
| Language        | TypeScript 6                             |
| Database / Auth | Supabase (PostgreSQL 17 + Auth)          |
| Styling         | TailwindCSS v4 + shadcn/ui (New York)    |
| State/Data      | TanStack React Query v5                  |
| Forms           | React Hook Form + Zod v4                 |
| i18n            | next-intl                                |
| Validation      | Zod (server + client)                    |
| Testing         | Vitest (unit + integration) + Playwright |
| UI Components   | Radix UI (via shadcn/ui), Sonner toast   |
| API Docs        | Swagger / OpenAPI (zod-to-openapi)       |
| Runtime         | Bun (package manager, scripts)           |

## Quick Start

```bash
bun install            # once per checkout (dev:up never installs)
cp .env.example .env   # root env — Git-ignored
bun dev:up             # Supabase (if needed) + web dev server on :3000
```

`bun dev:up` is idempotent and only starts what is missing: it reads the local
Supabase keys, regenerates the Git-ignored `apps/web/.env`, starts Supabase if
needed and runs the web dev server. It **never** installs dependencies, builds
or resets the database, and runs no migrations/seeds of its own (a fresh
`supabase start` still initialises the volume). Those are explicit commands:

```bash
bun dev:status          # health, PIDs, ports and URLs (--json for agents)
bun dev:down            # stop the web server (--all also stops Supabase)
bun dev:reset-db        # destructive: supabase db reset + re-render web env
bun dev:build           # explicit production build (stop the dev server first)
bun dev:logs            # follow the web log + recent Supabase container logs
```

The stack is **per git worktree + branch**: `dev:up` uses the experimental
`supabase stack` backend, which assigns ports (20000-32767) and keeps a separate
database per project root, branch and optional `SUPABASE_STACK` name. Only
`APP_PORT` (default `3000`) can collide between checkouts — pick a free one with
`bun dev:ports`. Supabase starts **lean** (`supabase start -x
realtime,functions,analytics,pooler` — the app uses none of them locally); set
`SUPABASE_START_EXCLUDE=` for the full stack. A branch switch creates/resumes its
own stack; `bun dev:down --all` stops it and keeps the data, while
`supabase stack destroy` (add `--stack <name>` for a named stack) deletes it.
`bun dev:doctor` explains state, and a stack
another checkout owns is never reused or stopped.
`dev:up` renders `apps/web/.env` **and** `supabase/.env`, so plain
`bunx supabase ...` commands use the same branch's **default** stack. With
`SUPABASE_STACK=<name>`, add `--stack <name>` to `status`/`start`/`stop`/`logs`;
database commands do not take `--stack` — read the URL first and pass it as a
remote target:

```bash
DB_URL=$(bunx supabase status --stack <name> --env | sed -n "s/^DB_URL='\\(.*\\)'$/\\1/p")
bunx supabase db reset --remote="$DB_URL" --yes
```

The shared QA stack (`:3010` / `:54421`) is refused unless `DEV_ALLOW_SHARED=1`;
`SUPABASE_SHARED=1` reuses a stack read-only and refuses destructive commands.
`apps/admin` is **not** part of `dev:up` — run it with `bun dev:admin` and its own
`apps/admin/.env`.

Optionally start the local observability stack (Grafana `:3001`):

```bash
docker compose up -d
```

See [Agent-Driven Live Debugging](docs/observability-debugging.md) for the workflow.

See [Onboarding Guide](docs/ONBOARDING.md) for full setup instructions (Docker, env vars, seeding, Playwright).

## Documentation

| Document                                                     | Description                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| [Onboarding](docs/ONBOARDING.md)                             | Local setup, Supabase, `gh` CLI, agents workflow              |
| [Architecture](docs/architecture.md)                         | High-level design, layers, data flow                          |
| [Authentication](docs/authentication.md)                     | Auth flow, RBAC, route rules                                  |
| [Database](docs/database.md)                                 | Schema, migrations, seeds                                     |
| [Plans, Features & Limits](docs/limits.md)                   | Plan templates, feature/limit resolution, seats               |
| [API](docs/api.md)                                           | API routes, controllers, services                             |
| [Project Structure](docs/project-structure.md)               | Folder layout, conventions                                    |
| [Testing](docs/testing.md)                                   | Test strategy, running tests                                  |
| [Observability & Debugging](docs/observability-debugging.md) | Local telemetry stack, Grafana MCP, trace→log→metric workflow |
| [Deployment](docs/deployment.md)                             | Hosting, environment, production                              |
| [Decisions](docs/decisions/)                                 | Architecture Decision Records                                 |

## Available Scripts

| Command                                  | Description                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bun dev:up`                             | One-command local stack: Supabase (if needed) + web server; renders `apps/web/.env` + `supabase/.env`      |
| `bun dev:up --prod`                      | Same, but production build (if missing) + `next start` (agents)                                            |
| `bun dev:serve`                          | `next start` for this checkout on `APP_PORT` (no dev server)                                               |
| `bun dev:status`                         | Web/Supabase health, stack id, endpoints (`--json` for a stable machine shape)                             |
| `bun dev:down` / `bun dev:down --all`    | Stop this checkout's web server / also stop **this branch's** Supabase stack (data kept)                   |
| `bun dev:reset-db`                       | Destructive `supabase db reset` for this branch's stack, then re-render `apps/web/.env`                    |
| `bun dev:build`                          | Explicit production build of `@studiq/web` (registry-level build lock; stop the dev server first)          |
| `bun dev:doctor`                         | Explain missing / owned / colliding state                                                                  |
| `bun dev:ports`                          | Print a free `APP_PORT` (Supabase ports are assigned per stack)                                            |
| `bun dev:logs`                           | Follow `.dev/web.log` + this stack's logs                                                                  |
| `bun dev:prepull`                        | Download stack images without starting the stack (VM templates)                                            |
| `bun dev`                                | Start the web app dev server (`next dev`) — agents should use `dev:build` + `dev:serve`                    |
| `bun dev:admin`                          | Start the admin app dev server (`@studiq/admin`, port 4000)                                                |
| `bun build`                              | Build the web app for production — same as `bun build:web`                                                 |
| `bun build:admin`                        | Build the admin app for production                                                                         |
| `bun start`                              | Start the web app production server — same as `bun start:web`                                              |
| `bun start:admin`                        | Start the admin app production server                                                                      |
| `bun lint`                               | Lint only: Bun native linter + import-path + migration-timestamp + hardcoded-URL guards (**no typecheck**) |
| `bun typecheck`                          | Typecheck the web app with `bun check` (`typecheck:all` = every workspace)                                 |
| `bun lint:all`                           | `typecheck:all` + `lint` in one run                                                                        |
| `bun lint:web` / `bun typecheck:web`     | Lint / typecheck the web app only                                                                          |
| `bun lint:admin` / `bun typecheck:admin` | Lint / typecheck the admin app only                                                                        |
| `bun format`                             | Format with **`bun fmt`** (writes, whole repo)                                                             |
| `bun format:check`                       | Check formatting with `bun fmt --check` (no writes, whole repo)                                            |
| `bun test`                               | Run all Vitest tests (unit + integration)                                                                  |
| `bun test:unit`                          | Run unit tests                                                                                             |
| `bun test:integration`                   | Run integration tests (requires local Supabase)                                                            |
| `bun test:watch`                         | Vitest watch mode                                                                                          |
| `bun test:coverage`                      | Run tests with coverage                                                                                    |
| `bun test:e2e`                           | Run Playwright E2E tests (`__tests__/e2e/`)                                                                |
| `bun loadtest:seed`                      | Seed load-test accounts via the Supabase Admin API (`--count`, …)                                          |
| `bun loadtest:bots`                      | Drive concurrent bot traffic (`--users`, `--shards`, `--duration`)                                         |
| `bun loadtest:reset`                     | Delete the seeded load-test accounts                                                                       |
| `bun clean`                              | Remove root `.next`, `node_modules/.cache`, and `coverage`                                                 |
| `scripts/spin <branch>`                  | Create worktree + branch for isolated work                                                                 |
| `scripts/pr`                             | Create a PR from current branch via `gh`                                                                   |
| `scripts/switch-branch`                  | Stash, switch branch, pull, pop stash                                                                      |

## Environment Variables

The committed template is [`.env.example`](.env.example) at the repo root —
`cp .env.example .env` once. `bun dev:up` reads that root `.env`, asks
`supabase status --output-format json` for the local stack's URLs/keys (anon +
service role) and generates **`apps/web/.env`** (mode `600`, Git-ignored). Never
edit or commit the generated file: change root `.env` and re-run `bun dev:up`.
The admin app keeps its own `apps/admin/.env` (committed template:
[`apps/admin/.env.example`](apps/admin/.env.example)) and is outside the
`dev:up` contract. Vitest still loads a root `.env` / `.env.local` when running
tests.

```env
# ── Supabase (shared/remote mode only — local stack discovers these) ──
SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # service-role key — server only, never ship to the client
NEXT_PUBLIC_SITE_URL=http://localhost:3000       # canonical URL (invite links, sitemap)

# ── Invitation e-mail (optional) ──────────────────────────────────────
# Read by packages/server/src/lib/mailer. Unset / none = no mail is sent and the
# copyable invite link stays the only delivery path. A bad value stops the server at boot.
MAIL_DRIVER=                                     # none (default) | log (NODE_ENV=development only) | smtp
MAIL_FROM=                                       # smtp: sender, e.g. StudiQ <no-reply@your-domain.com>
MAIL_SMTP_HOST=                                  # smtp: 127.0.0.1 locally (Mailpit), the relay in production
MAIL_SMTP_PORT=                                  # smtp: read from `supabase status` locally, 587 / 465 in production
MAIL_SMTP_SECURE=                                # smtp: true for implicit TLS (port 465)
MAIL_SMTP_USER=                                  # smtp: set together with MAIL_SMTP_PASS
MAIL_SMTP_PASS=

# ── LLM provider (optional — powers AI flashcard generation) ──────────
# Read by packages/server/src/ai/model.ts
LLM_PROVIDER=                                    # default: opencode-go (OpenCode Go)
LLM_API_KEY=                                     # API key for the provider above
LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1  # OpenAI-compatible endpoint (default shown)
LLM_MODEL_NAME=                                  # default: mimo-v2.6-flash
LLM_REASONING_EFFORT=                            # low | medium | high (unset = provider default)

# ── OpenTelemetry (optional) ──────────────────────────────────────────
# Read by apps/web/src/instrumentation.ts. Traces + metrics + logs all go to
# the OTel Collector started by `docker compose up -d` (Grafana at :3001).
# Telemetry is ON by default — leave OTEL_SDK_DISABLED unset. Set it to "true"
# only to turn traces/metrics/logs off entirely (e.g. tests, CI).
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # OTLP collector (SDK default shown)
# OTEL_SDK_DISABLED=true

# ── Admin app only (apps/admin/.env) ──────────────────────────────────
ADMIN_PEM_KEYS=                                  # JSON keyring: [{ id, key, scopes, expiresAt? }] — see apps/admin/.env.example

# ── Local Supabase Studio only (optional) ─────────────────────────────
# Referenced by supabase/config.toml [studio] — not read by the app itself
OPENAI_API_KEY=
```

`NEXT_LOCALE` is intentionally absent: it is a **cookie** set by the language
toggle (`pl` by default, `en`), not an environment variable.

## Folder Structure

Bun workspace monorepo — two apps (`apps/*`) sharing four packages (`packages/*`):

```
apps/
  web/                        # Main app — @studiq/web (Next.js 16, port 3000)
    src/
      app/
        (frontend)/           # Pages: (auth), (setup), app, edu, manage, pricing...
        (backend)/            # api/route.ts + api/v1/* (ai, flashcards, quiz, auth, stats...)
      components/             # Domain + layout components, providers (flashcards, questions, stats...)
      hooks/                  # Custom React hooks (use-api, use-ai-chat, use-permissions...)
      i18n/                   # next-intl request config + messages/ (en, pl)
      lib/                    # Client utilities (api, query-keys, permissions, utils)
      styles/                 # Global CSS (highlight.css)
      types/                  # TS type definitions
      proxy.ts                # Next.js middleware: session + RBAC route rules
    public/                   # Static assets
    .env                      # Generated by `bun dev:up` (gitignored — see Environment Variables)
  admin/                      # Admin panel — @studiq/admin (port 4000, see apps/admin/README.md)
    src/
      app/(frontend)/         # Admin pages (orgs, feature-flags, subscription-plans, user-overrides)
      app/(backend)/api/v1/   # Admin-only API endpoints
      server/                 # Own controllers / services / models
      lib/                    # Supabase service client, fetch wrapper
      i18n/                   # Translations
    .env.example              # Admin env template (committed)
packages/
  server/                     # @studiq/server — shared backend (route → controller → service)
    src/
      config/                 # routes.config.ts (route rules)
      controllers/            # Input validation, delegates to services
      services/               # Business logic + DB queries
      models/                 # Zod schemas + inferred types
      guards/                 # Auth + role guards
      ai/                     # LLM client (model.ts) + AI types
      agents/                 # Agent system + tools (generate-flashcards, extract-concepts...)
      lib/                    # errors, request-context, with-auth, observability, supabase clients
  authz/                      # @studiq/authz — permissions, feature flags, request context
  ui/                         # @studiq/ui — shadcn/ui primitives (60+ components) shared by both apps
  tsconfig/                   # Shared TS config base
supabase/
  config.toml                 # Local Supabase stack configuration
  migrations/                 # DB migrations (timestamped)
  schemas/                    # Table schemas per domain (00-99 prefix)
  seeds/                      # Seed data (users, permissions, e2e data)
  templates/                  # Email templates (confirmation, recovery)
__tests__/                    # All tests (root-level, shared by both apps)
  unit/                       # Vitest unit tests (api, controllers, guards, models, services...)
  integration/                # Vitest integration tests (real local Supabase)
  e2e/                        # Playwright E2E specs
  helpers/  mocks/  setup.ts  # Test utilities
docs/                         # Documentation (onboarding, architecture, API, AI...)
  decisions/                  # Architecture Decision Records (0001-0007)
  plans/                      # Implementation plans (+ archive/)
scripts/                      # Repo tooling: spin, pr, switch-branch, lint guards
```
