# StudiQ

Quiz, flashcard and course-management platform for students, teachers and universities — Next.js 16 + Supabase.

## Features

- Role-based auth for students, educators and managers
- Quizzes with attempt tracking and review
- SM-2 spaced-repetition flashcards, with AI generation from PDFs
- Student and teacher dashboards: due cards, per-deck and per-topic stats
- University, membership and invitation management
- Polish and English UI via next-intl
- Internal admin panel (`apps/admin`, port 4000) — not deployed ([ADR-0009](docs/decisions/0009-admin-is-internal-not-deployed.md))

## Tech Stack

| Layer         | Technology                             |
| ------------- | -------------------------------------- |
| App           | Next.js 16 (App Router), TypeScript    |
| Data / Auth   | Supabase (PostgreSQL 17 + Auth)        |
| Data fetching | TanStack React Query v5, Zod v4        |
| UI            | Tailwind CSS v4 + shadcn/ui, next-intl |
| Tooling       | Bun, Vitest, Playwright                |

## Quick Start

```bash
bun install            # once per checkout
cp .env.example .env   # root env — Git-ignored
bun dev:up             # Supabase (if needed) + web app on :3000
```

`bun dev:up` is idempotent: it re-renders `apps/web/.env`, starts Supabase only
if it isn't running, and starts the web server. It never installs, builds or
resets anything — those are explicit. Agents should use `bun dev:up --prod`
(`next start`) rather than the dev server.

```bash
bun dev:status     # health, ports, URLs (--json for agents)
bun dev:down       # stop the web server (--all also stops Supabase, data kept)
bun dev:reset-db   # destructive: reset and re-seed this branch's database
bun dev:build      # production build (stop the server first)
bun dev:logs       # follow the web log; show recent Supabase logs
```

Each git worktree and branch gets its own Supabase stack with CLI-assigned
ports, so only `APP_PORT` (default `3000`) can collide — `bun dev:ports` suggests
a free one, and `bun dev:doctor` explains anything it doesn't like.

The admin panel and observability stack are opt-in:

```bash
bun dev:admin          # apps/admin on :4000 (own apps/admin/.env)
docker compose up -d   # Grafana on :3001
```

Full setup (Docker, env vars, seeding, Playwright) is in the
[onboarding guide](docs/ONBOARDING.md); the trace → log → metric workflow is in
[observability & debugging](docs/observability-debugging.md).

## Documentation

| Document                                                     | Description                                     |
| ------------------------------------------------------------ | ----------------------------------------------- |
| [Onboarding](docs/ONBOARDING.md)                             | Local setup, Supabase, `gh` CLI, agent workflow |
| [Architecture](docs/architecture.md)                         | High-level design, layers, data flow            |
| [Authentication](docs/authentication.md)                     | Auth flow, RBAC, route rules                    |
| [Database](docs/database.md)                                 | Schema, migrations, seeds                       |
| [Plans, Features & Limits](docs/limits.md)                   | Plan templates, feature/limit resolution        |
| [API](docs/api.md)                                           | Routes, controllers, services                   |
| [Project Structure](docs/project-structure.md)               | Folder layout and conventions                   |
| [Testing](docs/testing.md)                                   | Test strategy and how to run it                 |
| [Observability & Debugging](docs/observability-debugging.md) | Local telemetry stack and debugging workflow    |
| [Deployment](docs/deployment.md)                             | Hosting, environment, production                |
| [Decisions](docs/decisions/)                                 | Architecture Decision Records                   |

## Scripts

| Command                                          | Description                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `bun dev:up` / `bun dev:up --prod`               | Local stack (Supabase + web); `--prod` builds (if missing) and serves |
| `bun dev:serve`                                  | `next start` for this checkout on `APP_PORT`                          |
| `bun dev:admin`                                  | Admin dev server on :4000                                             |
| `bun lint`                                       | Lint + repo guards (no typecheck)                                     |
| `bun lint:all`                                   | Typecheck + lint (admin typechecked via `typecheck:admin`)            |
| `bun format` / `bun format:check`                | Format the repo / check formatting                                    |
| `bun run test`                                   | Product unit + integration tests (admin: `bun run test:admin`)        |
| `bun run test:unit` / `bun run test:integration` | Run one Vitest suite only (integration needs local Supabase)          |
| `bun run test:e2e`                               | Playwright E2E                                                        |
| `scripts/spin <branch>` / `scripts/pr`           | Create an isolated worktree / open a PR                               |

Every script is defined in [`package.json`](package.json); the full annotated
list is in [`AGENTS.md`](AGENTS.md).

## Environment Variables

The committed template is [`.env.example`](.env.example) at the repo root —
`cp .env.example .env` once. `bun dev:up` reads that root `.env`, asks
`supabase status --output-format json` for the local stack's URLs/keys (anon +
service role) and generates **`apps/web/.env`** (mode `600`, Git-ignored). Never
edit or commit the generated file: change root `.env` and re-run `bun dev:up`.
The admin app keeps its own `apps/admin/.env` (committed template:
[`apps/admin/.env.example`](apps/admin/.env.example)) and is outside the
`dev:up` contract. It is an internal tool with no app-level auth, and it is
**not deployed**; see
[ADR-0009](docs/decisions/0009-admin-is-internal-not-deployed.md) for the ordered
deployment blockers. Vitest still loads a root `.env` / `.env.local` when
running tests.

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
# No app-level auth and not deployed: do not deploy until ADR-0009 blockers clear.

# ── Local Supabase Studio only (optional) ─────────────────────────────
# Referenced by supabase/config.toml [studio] — not read by the app itself
OPENAI_API_KEY=
```

`NEXT_LOCALE` is intentionally absent: it is a **cookie** set by the language
toggle (`pl` by default, `en`), not an environment variable.
