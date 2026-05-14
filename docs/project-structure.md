# Project Structure

## Directory Layout

```
studiq/
├── src/
│   ├── app/
│   │   ├── (frontend)/          # UI routes — pages, layouts, dashboards
│   │   │   ├── (auth)/          # Login, register pages
│   │   │   ├── admin/           # System admin dashboard
│   │   │   ├── app/             # Student dashboard
│   │   │   ├── edu/             # Teacher dashboard
│   │   │   ├── manage/          # University admin dashboard
│   │   │   ├── pricing/         # Public pricing page
│   │   │   └── ...
│   │   ├── (backend)/           # API routes and docs
│   │   │   ├── api/v1/          # REST API endpoints
│   │   │   └── docs/            # Swagger UI
│   │   ├── layout.tsx           # Root layout
│   │   ├── page.tsx             # Landing page
│   │   ├── error.tsx            # Global error boundary
│   │   └── not-found.tsx        # 404 page
│   │
│   ├── components/
│   │   ├── layout/              # Navbar, sidebar, footer
│   │   ├── providers/           # AuthProvider, ThemeProvider
│   │   └── ui/                  # shadcn/ui components
│   │
│   ├── hooks/                   # Custom React hooks
│   ├── i18n/                    # next-intl configuration
│   │   └── messages/            # Translation files
│   │
│   ├── lib/                     # Shared utilities
│   │   ├── supabase/            # Supabase client setup (server, client, session)
│   │   ├── controller-response.ts
│   │   ├── errors.ts
│   │   ├── http-utils.ts
│   │   ├── validation-errors.ts
│   │   └── zod.ts
│   │
│   ├── server/                  # Backend business logic
│   │   ├── config/              # Route rules configuration
│   │   ├── controllers/         # Request handlers
│   │   ├── guards/              # Auth and role guards
│   │   ├── models/              # Zod validation schemas
│   │   └── services/            # Business logic + DB access
│   │
│   ├── types/                   # TypeScript type definitions
│   └── proxy.ts                 # Next.js middleware (auth, RBAC)
│
├── supabase/
│   ├── migrations/              # Database migration files
│   └── seeds/                   # Seed data files
│
├── __tests__/
│   ├── integration/             # Integration tests (real Supabase)
│   ├── setup.ts                 # Test setup (mock configuration)
│   └── helpers/                 # Test utilities
│
├── e2e/                         # Playwright end-to-end tests
├── docs/                        # Project documentation
├── public/                      # Static assets
├── .env.local                   # Local environment (gitignored)
├── .env.test                    # Test environment
├── package.json
├── vitest.config.ts
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
