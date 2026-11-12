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
bun install                          # once per checkout
bun run env:ensure --profile web     # stack (if needed) + build + serve on :3000
```

`env:ensure` is the blessed, idempotent path: it reads root `.env.local`
(optional; see [`.env.schema`](.env.schema)), resolves this checkout's stack
contract and **exports** the values to the web process — no per-app env file is
generated. It starts Supabase only if needed, reuses a current build, and serves
the production server. It never installs or resets anything, and it seeds only
for the `qa`/`e2e` profiles (`--no-seed` skips); everything else is explicit.
Agents use `env:ensure`/`env:build` + `env:serve`; `env:dev` is human-only HMR.
`bun run dev:web` is a raw workspace `next dev`: it runs no varlock and exports no
stack values, so it is not a substitute for `env:dev` or `env:ensure`.

The cutover deleted `scripts/dev` and the `dev:*` wrappers that called it
(`dev:up`, `dev:serve`, `dev:status`, `dev:down`, `dev:reset-db`, `dev:build`,
`dev:logs`, `dev:doctor`, `dev:ports`, `dev:prepull`). `dev:web` and `dev:admin`
never called it and remain as human-only shortcuts.

```bash
bun run env:status --json   # health, ports, URLs (stable agent contract)
bun run env:down            # stop the web server (--all also stops Supabase, data kept)
bun run env:reset-db --yes  # destructive: reset and re-seed this branch's database
bun run env:build           # production build (stop the server first)
bun run env:logs            # follow the web log; show recent Supabase logs
```

Each git worktree and branch gets its own Supabase stack with CLI-assigned
ports. For `env:ensure`, only `APP_PORT` (default `3000`) can collide —
`bun run env:ports` suggests a free one, and `bun run env:doctor` explains
anything it doesn't like. One environment per checkout: a second stack or
server in the same checkout is refused — use another worktree. The optional
admin panel (`:4000`, loopback) uses a fixed host port; observability is one
machine-wide stack on `:7001`/`:7xxx`, owned by the primary checkout.

The admin panel and observability stack are opt-in and outside the `env` tool:

```bash
bun run dev:admin                    # apps/admin HMR on 127.0.0.1:4000 (human-only)
bun run build:admin && bun run start:admin  # production build + serve
docker compose up -d                 # Grafana on :7001 (primary checkout only)
```

`.env.vault` is **opt-in**: a fresh checkout runs from `.env.local` alone. Only
provider refs that cannot come from the local stack (LLM, Stripe) belong there;
a human creates it with `bun run env:setup --vault` and it is never auto-created.

Full setup (Docker, env vars, seeding, Playwright) is in the
[onboarding guide](docs/ONBOARDING.md); the trace → log → metric workflow is in
[observability & debugging](docs/observability-debugging.md).

## Documentation

| Document                                                     | Description                                      |
| ------------------------------------------------------------ | ------------------------------------------------ |
| [Onboarding](docs/ONBOARDING.md)                             | Local setup, Supabase, `gh` CLI, agent workflow  |
| [Architecture](docs/architecture.md)                         | High-level design, layers, data flow             |
| [Database](docs/database.md)                                 | Schema, migrations, seeds                        |
| [Plans, Features & Limits](docs/limits.md)                   | Plan templates, feature/limit resolution         |
| [Testing](docs/testing.md)                                   | Test strategy and how to run it                  |
| [CI](docs/ci.md)                                             | Workflows, required checks, repository variables |
| [Observability & Debugging](docs/observability-debugging.md) | Local telemetry stack and debugging workflow     |
| [Deployment](docs/deployment.md)                             | Hosting, environment, production                 |
| [Decisions](docs/decisions/)                                 | Architecture Decision Records                    |
| [Contributing](CONTRIBUTING.md)                              | Conventional commits, issue reporting            |

## Scripts

| Command                                          | Description                                                     |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `bun run env:ensure --profile web`               | Local stack + build + serve (idempotent; `--json` contract)     |
| `bun run env:serve`                              | Serve an existing production build on `APP_PORT`                |
| `bun run env:dev`                                | Human-only web HMR (`next dev`); agents build + serve           |
| `bun run dev:web`                                | Raw web dev server (human-only; same server as `env:dev`)       |
| `bun run dev:admin`                              | Admin HMR on `127.0.0.1:4000` (human-only; no `env` equivalent) |
| `bun lint`                                       | Lint + repo guards (no typecheck)                               |
| `bun lint:all`                                   | Typecheck + lint (admin typechecked via `typecheck:admin`)      |
| `bun format` / `bun format:check`                | Format the repo / check formatting                              |
| `bun run test`                                   | Product unit + integration tests (admin: `bun run test:admin`)  |
| `bun run test:unit` / `bun run test:integration` | Run one Vitest suite only (integration needs local Supabase)    |
| `bun run test:e2e`                               | Playwright E2E                                                  |
| `scripts/spin <branch>` / `scripts/pr`           | Create an isolated worktree / open a PR                         |

Every script is defined in [`package.json`](package.json); the full annotated
list is in [`AGENTS.md`](AGENTS.md).

## Environment Variables

There is **one values file: root `.env.local`**. It is Git-ignored, optional for
a single checkout (derived defaults apply), and never committed.
[`.env.schema`](.env.schema) is the value-free inventory of every key the repo
reads; it is documentation, not an access control list, and `varlock` uses it to
validate/inject env for the `bun run …` scripts (`bun run env:check`,
`bun run env:scan`).

The value-consuming `env:*` commands run under `varlock run --inject vars --`,
ask `supabase stack status --output-format json` for this checkout's stack
URLs/keys, and **export** the resolved values to the Supabase and web child
processes; `status`/`ports`/`doctor`/`setup`/`verify` are unwrapped by design.
No `apps/web/.env`, `apps/admin/.env` or `supabase/.env` is generated
or read. Change `.env.local` (or use `bun run env:supa …` for a direct CLI
command) — never a generated file.

`.env.local` is the only required hand-edited **values** file; a fresh checkout
runs without a vault. `.env.vault` is an **optional** provider-ref file that a
human creates with `bun run env:setup --vault` (mode 600, comments/empty refs)
only for things the local stack cannot provide: LLM inference
(`LLM_API_KEY`, optionally `LLM_BASE_URL`/`LLM_PROVIDER`) and Stripe
(`STRIPE_SECRET_KEY`, plus `STRIPE_WEBHOOK_SECRET` for webhook testing). It
lives in the primary checkout, is Git-ignored, and is resolved through
`STUDIQ_ENV_VAULT` (default `<primary>/.env.vault`); `varlock run --path` is used
only when the file exists. `env:verify --full` reports provider status without
printing a value.
The admin app is an internal tool with no app-level auth, and it is **not
deployed**; see [ADR-0009](docs/decisions/0009-admin-is-internal-not-deployed.md)
for the ordered deployment blockers.

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
# the OTel Collector started by `docker compose up -d` (Grafana at :7001).
# Telemetry is ON by default — leave OTEL_SDK_DISABLED unset. Set it to "true"
# only to turn traces/metrics/logs off entirely (e.g. tests, CI).
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:7318  # local machine-wide collector
# OTEL_SDK_DISABLED=true

# ── Admin app only (same root .env.local) ─────────────────────────────
# No app-level auth and not deployed: do not deploy until ADR-0009 blockers clear.

# ── Local Supabase Studio only (optional) ─────────────────────────────
# Referenced by supabase/config.toml [studio] — not read by the app itself
OPENAI_API_KEY=
```

`NEXT_LOCALE` is intentionally absent: it is a **cookie** set by the language
toggle (`pl` by default, `en`), not an environment variable.
