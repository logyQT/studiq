# Project Structure

## Directory Layout

```
studiq/
├── src/
│   ├── app/
│   │   ├── (frontend)/          # UI routes — pages, layouts, dashboards
│   │   │   ├── (auth)/          # Login, register, password reset pages
│   │   │   ├── admin/           # System admin dashboard
│   │   │   ├── app/             # Student dashboard
│   │   │   ├── edu/             # Teacher dashboard
│   │   │   ├── manage/          # University admin dashboard
│   │   │   ├── contact/         # Public contact page
│   │   │   ├── features/        # Public features page
│   │   │   ├── pricing/         # Public pricing page
│   │   │   ├── privacy/         # Privacy policy
│   │   │   └── terms/           # Terms of service
│   │   ├── (backend)/           # API routes and docs
│   │   │   ├── api/v1/          # REST API endpoints
│   │   │   └── docs/api/        # Swagger UI
│   │   ├── layout.tsx           # Root layout
│   │   ├── page.tsx             # Landing page
│   │   ├── error.tsx            # Global error boundary
│   │   └── not-found.tsx        # 404 page
│   │
│   ├── components/
│   │   ├── flashcards/          # Flashcard-specific components
│   │   ├── layout/              # Navbar, sidebar, footer
│   │   ├── providers/           # AuthProvider, ThemeProvider, QueryProvider
│   │   └── ui/                  # 60+ shadcn/ui components
│   │
│   ├── hooks/                   # Custom React hooks
│   │   ├── use-api.ts
│   │   ├── use-flashcard-generation.ts
│   │   ├── use-flashcard-realtime.ts
│   │   ├── use-realtime-channel.ts
│   │   └── ...
│   │
│   ├── i18n/                    # next-intl configuration
│   │   └── messages/            # Translation files (en.json, pl.json)
│   │
│   ├── lib/                     # Shared utilities
│   │   ├── supabase/            # Supabase client (client, server, service, session)
│   │   ├── api.ts
│   │   ├── controller-response.ts
│   │   ├── errors.ts
│   │   ├── frontend-rbac.ts
│   │   ├── http-utils.ts
│   │   ├── query-keys.ts
│   │   ├── rbac.ts
│   │   ├── request-context.ts
│   │   ├── swagger.ts
│   │   ├── utils.ts
│   │   ├── validation-errors.ts
│   │   ├── with-auth.ts
│   │   ├── with-error-handling.ts
│   │   └── zod.ts
│   │
│   ├── server/                  # Backend business logic
│   │   ├── config/              # Route rules + models configuration
│   │   │   ├── models.config.ts
│   │   │   └── routes.config.ts
│   │   ├── controllers/         # Request handlers (17 controllers)
│   │   ├── guards/              # Auth guard + role guard
│   │   ├── models/              # Zod validation schemas (17 model files)
│   │   ├── providers/           # LLM providers
│   │   │   ├── LLMProvider.ts
│   │   │   ├── ollamaProvider.ts
│   │   │   ├── openaiProvider.ts
│   │   │   └── providerRegistry.ts
│   │   └── services/            # Business logic + DB access (20 services)
│   │
│   ├── types/                   # TypeScript type definitions
│   └── proxy.ts                 # Next.js middleware (auth, RBAC)
│
├── supabase/
│   ├── config.toml              # Local Supabase configuration
│   ├── migrations/              # Database migration files (timestamped)
│   ├── schemas/                 # Logical schema files by domain
│   ├── seeds/                   # Seed data files (domain-ordered)
│   └── templates/               # Email templates (confirmation, recovery)
│
├── __tests__/
│   ├── unit/                    # Unit tests
│   │   ├── controllers/         # Controller unit tests
│   │   ├── guards/              # Guard unit tests
│   │   ├── models/              # Model validation tests
│   │   └── services/            # Service unit tests
│   ├── integration/             # Integration tests (real Supabase)
│   ├── helpers/                 # Test utilities (supabase-mock)
│   ├── mocks/                   # Test mocks (supabase)
│   └── setup.ts                 # Test bootstrap
│
├── e2e/                         # Playwright end-to-end tests
│   ├── login.spec.ts
│   ├── register.spec.ts
│   ├── student-flashcard.spec.ts
│   ├── teacher-question.spec.ts
│   └── utils.ts
│
├── docs/                        # Project documentation
├── public/                      # Static assets (logos, icons, placeholders)
├── .env.local                   # Local environment (gitignored)
├── package.json
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── next.config.mjs
├── tsconfig.json
└── README.md
```

## Architecture Philosophy

### Separation of Concerns

- **UI** lives in `(frontend)/` and `components/` — no business logic
- **Business logic** lives in `server/` — no UI rendering
- **API routes** are thin — they parse requests and delegate to controllers

### Barrel Files

Each directory in `server/` has an `index.ts` that re-exports all modules:

```typescript
// src/server/services/index.ts
export { authService } from './auth.service';
export { questionService } from './question.service';
// ...
```

This allows clean imports:

```typescript
import { authService, questionService } from '@/server/services';
```

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Service files | `*.service.ts` | `question.service.ts` |
| Controller files | `*.controller.ts` | `question.controller.ts` |
| Model files | `*.model.ts` | `question.model.ts` |
| Test files | `*.test.ts` | `question.controller.test.ts` |
| Route handlers | `route.ts` | `api/v1/questions/route.ts` |

### Import Aliases

| Alias | Resolves to |
|-------|-------------|
| `@/` | `src/` |
| `#test` | `__tests__/` |
