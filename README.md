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
bun install
bunx supabase start
bun dev
```

See [Onboarding Guide](docs/ONBOARDING.md) for full setup instructions (Docker, env vars, seeding, Playwright).

## Documentation

| Document                                       | Description                          |
| ---------------------------------------------- | ------------------------------------ |
| [Onboarding](docs/ONBOARDING.md)               | Local setup, Supabase, `gh` CLI, agents workflow |
| [Architecture](docs/architecture.md)           | High-level design, layers, data flow |
| [Authentication](docs/authentication.md)       | Auth flow, RBAC, route rules         |
| [Database](docs/database.md)                   | Schema, migrations, seeds            |
| [API](docs/api.md)                             | API routes, controllers, services    |
| [Project Structure](docs/project-structure.md) | Folder layout, conventions           |
| [Testing](docs/testing.md)                     | Test strategy, running tests         |
| [Deployment](docs/deployment.md)               | Hosting, environment, production     |
| [Decisions](docs/decisions/)                   | Architecture Decision Records        |

## Available Scripts

| Command                              | Description                                                             |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `bun dev`                            | Start the web app dev server (`@studiq/web`, port 3000) — same as `bun dev:web` |
| `bun dev:admin`                      | Start the admin app dev server (`@studiq/admin`, port 4000)             |
| `bun build`                          | Build the web app for production — same as `bun build:web`              |
| `bun build:admin`                    | Build the admin app for production                                      |
| `bun start`                          | Start the web app production server — same as `bun start:web`           |
| `bun start:admin`                    | Start the admin app production server                                   |
| `bun lint`                           | Lint only: Biome + import-path guard + migration-timestamp guard (**no typecheck**) |
| `bun typecheck`                      | TypeScript typecheck for the web app (`typecheck:all` = every workspace)|
| `bun lint:all`                       | `typecheck:all` + `lint` in one run                                      |
| `bun lint:web` / `bun typecheck:web` | Lint / typecheck the web app only                                       |
| `bun lint:admin` / `bun typecheck:admin` | Lint / typecheck the admin app only                                 |
| `bun format`                         | Format with **Biome** (writes, whole repo: `biome check --write .`)      |
| `bun format:check`                   | Check formatting with Biome (no writes, whole repo: `biome ci .`)        |
| `bun test`                           | Run all Vitest tests (unit + integration)                               |
| `bun test:unit`                      | Run unit tests                                                          |
| `bun test:integration`               | Run integration tests (requires local Supabase)                         |
| `bun test:watch`                     | Vitest watch mode                                                       |
| `bun test:coverage`                  | Run tests with coverage                                                 |
| `bun test:e2e`                       | Run Playwright E2E tests (`__tests__/e2e/`)                             |
| `bun clean`                          | Remove root `.next`, `node_modules/.cache`, and `coverage`              |
| `scripts/spin <branch>`              | Create worktree + branch for isolated work                              |
| `scripts/pr`                         | Create a PR from current branch via `gh`                                |
| `scripts/switch-branch`              | Stash, switch branch, pull, pop stash                                   |

## Environment Variables

There is no root `.env.example` — this table is the source of truth. The web
app reads its variables from `apps/web/.env`, the admin app from
`apps/admin/.env` (committed template: [`apps/admin/.env.example`](apps/admin/.env.example)),
and Vitest loads a root `.env` / `.env.local` when running tests. Everything
here except that template is gitignored.

```env
# ── Supabase (required) ───────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # service-role key — server only, never ship to the client
NEXT_PUBLIC_SITE_URL=http://localhost:3000       # canonical URL (invite links, sitemap)

# ── LLM provider (optional — powers AI flashcard generation) ──────────
# Read by packages/server/src/ai/model.ts
LLM_PROVIDER=                                    # default: opencode
LLM_API_KEY=                                     # API key for the provider above
LLM_BASE_URL=https://opencode.ai/zen/go/v1       # OpenAI-compatible endpoint (default shown)
LLM_MODEL_NAME=                                  # default: mimo-v2.5
LLM_REASONING_EFFORT=                            # low | medium | high (unset = provider default)

# ── OpenTelemetry (optional) ──────────────────────────────────────────
# Read by apps/web/src/instrumentation.ts
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # OTLP collector (SDK default shown)
OTEL_SDK_DISABLED=true                            # set to disable tracing entirely

# ── Admin app only (apps/admin/.env) ──────────────────────────────────
ADMIN_PEM_KEYS=                                  # comma-separated base64 Ed25519 SPKI public keys

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
    .env                      # Local env (gitignored — see Environment Variables)
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
  decisions/                  # Architecture Decision Records (0001-0006)
  plans/                      # Implementation plans (+ archive/)
scripts/                      # Repo tooling: spin, pr, switch-branch, lint guards
```
