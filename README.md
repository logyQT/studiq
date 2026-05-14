# Studiq

An educational platform with quizzes, flashcards, AI-powered learning flows, and university management.

## Features

- Authentication with role-based access control
- Quiz generation and attempt tracking
- Flashcard practice with spaced repetition
- Teacher and student statistics dashboards
- University and membership management
- Invitation system with token-based registration
- AI-powered exam flows
- Multi-language support (i18n)

## Tech Stack

| Layer           | Technology                 |
| --------------- | -------------------------- |
| Framework       | Next.js 16 (App Router)    |
| Language        | TypeScript                 |
| Database / Auth | Supabase (PostgreSQL)      |
| Styling         | TailwindCSS v4 + shadcn/ui |
| i18n            | next-intl                  |
| Validation      | Zod                        |
| Testing         | Vitest + Playwright        |
| API Docs        | Swagger / OpenAPI          |

## Quick Start

```bash
bun install
bunx supabase start
bun dev
```

See [Onboarding Guide](docs/ONBOARDING.md) for full setup instructions.

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
| `bun test`             | Reset DB + run all tests |
| `bun test:unit`        | Run unit tests           |
| `bun test:integration` | Run integration tests    |
| `bun test:watch`       | Watch mode               |
| `bun test:coverage`    | Run with coverage        |

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
```

## Folder Structure

```
src/
  app/
    (frontend)/        # UI routes (pages, layouts)
    (backend)/         # API routes + Swagger docs
  components/          # React components
  hooks/               # Custom React hooks
  i18n/                # Internationalization
  lib/                 # Shared utilities
  server/              # Business logic (controllers, services, guards)
  types/               # TypeScript type definitions
supabase/
  migrations/          # Database migrations
  seeds/               # Seed data
```

## License

Private — all rights reserved.
