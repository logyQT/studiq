# Studiq

Private edtech platform with quizzes, flashcards, AI-powered learning flows, and university management.

## Features

- Authentication with role-based access control (student, teacher, university admin, sys admin)
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
- System administration panel (logs, permissions)

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
| [Onboarding](docs/ONBOARDING.md)               | Local setup, Supabase, team workflow |
| [Architecture](docs/architecture.md)           | High-level design, layers, data flow |
| [Authentication](docs/authentication.md)       | Auth flow, RBAC, route rules         |
| [Database](docs/database.md)                   | Schema, migrations, seeds            |
| [API](docs/api.md)                             | API routes, controllers, services    |
| [Project Structure](docs/project-structure.md) | Folder layout, conventions           |
| [Testing](docs/testing.md)                     | Test strategy, running tests         |
| [Deployment](docs/deployment.md)               | Hosting, environment, production     |
| [Decisions](docs/decisions/)                   | Architecture Decision Records        |

## Available Scripts

| Command                | Description              |
| ---------------------- | ------------------------ |
| `bun dev`              | Start development server |
| `bun build`            | Build for production     |
| `bun start`            | Start production server  |
| `bun lint`             | Type check + lint        |
| `bun format`           | Format with Prettier     |
| `bun format:check`     | Check formatting         |
| `bun test`             | Reset DB + run all tests |
| `bun test:unit`        | Run unit tests           |
| `bun test:integration` | Run integration tests    |
| `bun test:watch`       | Watch mode               |
| `bun test:coverage`    | Run with coverage        |
| `bun test:e2e`         | Run Playwright E2E tests |
| `bun clean`            | Clean build artifacts    |

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # admin operations
NEXT_PUBLIC_SITE_URL=
OPENAI_API_KEY=              # AI flashcard generation
OLLAMA_BASE_URL=             # local LLM fallback
NEXT_LOCALE=                 # en | pl (default)
TRACE_ENABLED=               # enable per-layer trace logging (dev only, default off)
```

## Folder Structure

```
src/
  app/
    (frontend)/         # Pages (auth, app, edu, manage, admin, public)
    (backend)/api/v1/   # API routes (flashcards, quiz, auth, admin, dev...)
  components/
    ui/                 # shadcn/ui primitives (~60 components)
    flashcards/         # Domain components (deck-detail, topic-manager...)
    shared/             # Shared generic components
    layout/             # Dashboard, Navbar, Footer, ThemeToggle
    providers/          # Auth, Theme, Query, AppRealtime providers
    dev/                # Dev utilities (quick-login)
  hooks/                # Custom React hooks (api, realtime, auth...)
  i18n/messages/        # Translation JSON (en, pl)
  lib/                  # Utilities (api, rbac, supabase clients, errors...)
    supabase/           # Three client contexts (client, server, service)
  server/
    controllers/        # Input validation, delegates to services
    services/           # Business logic + DB queries
    models/             # Zod schemas + inferred types
    guards/             # Auth + role guards
    providers/          # LLM providers (OpenAI, Ollama)
    config/             # Route rules, model configs
  types/                # TS type definitions
supabase/
  migrations/           # DB migrations (timestamped)
  schemas/              # Table schemas per domain (00-99 prefix)
  seeds/                # Seed data (users, permissions, e2e data)
__tests__/              # Vitest unit + integration tests
  unit/
  integration/
  helpers/
  mocks/
e2e/                    # Playwright E2E tests
docs/                   # Documentation (onboarding, architecture, API, ADRs...)
  decisions/            # Architecture Decision Records (0001-0006)
```
