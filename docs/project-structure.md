# Project Structure

## Directory Layout

The repository is a Bun workspace monorepo — two apps under `apps/*` sharing
four packages under `packages/*`. There is no root `src/`.

```
studiq/
├── apps/
│   ├── web/                          # Main app — @studiq/web (Next.js 16, port 3000)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (frontend)/       # UI routes — pages, layouts, dashboards
│   │   │   │   │   ├── (auth)/       # Login, register, password reset, join
│   │   │   │   │   ├── (setup)/      # First-run setup wizard
│   │   │   │   │   ├── app/          # Student dashboard (flashcards, study, questions, stats, ai)
│   │   │   │   │   ├── edu/          # Teacher dashboard (quizzes, groups, assignments, reports)
│   │   │   │   │   ├── manage/       # University admin dashboard (members, invites, roles, seats)
│   │   │   │   │   ├── billing/ checkout/  # Payment + upgrade pages
│   │   │   │   │   └── contact/ features/ pricing/ privacy/ terms/   # Public pages
│   │   │   │   ├── (backend)/        # API routes
│   │   │   │   │   ├── api/route.ts  # Catch-all API handler
│   │   │   │   │   └── api/v1/       # REST endpoints (ai, auth, flashcards, quiz, stats, dev...)
│   │   │   │   ├── layout.tsx        # Root layout
│   │   │   │   ├── page.tsx          # Landing page
│   │   │   │   ├── error.tsx         # Global error boundary
│   │   │   │   └── not-found.tsx     # 404 page
│   │   │   ├── components/           # Domain + layout components
│   │   │   │   ├── flashcards/ questions/ stats/ study/ ...   # Domain components
│   │   │   │   ├── layout/           # Navbar, DashboardLayout, Footer, ThemeToggle, LanguageToggle, user-menu
│   │   │   │   ├── providers/        # AuthProvider, ThemeProvider, QueryProvider
│   │   │   │   ├── shared/           # Shared generic components (entity-not-found, markdown-renderer...)
│   │   │   │   └── dev/              # Dev utilities (quick-login)
│   │   │   ├── hooks/                # Custom React hooks (use-api.ts, use-ai-chat.ts, use-permissions.ts, ...)
│   │   │   ├── i18n/                 # next-intl request config + messages/ (en.json, pl.json)
│   │   │   ├── lib/                  # Client utilities (api.ts, query-keys.ts, permissions.ts, utils.ts)
│   │   │   ├── styles/               # Global CSS (highlight.css)
│   │   │   ├── types/                # TypeScript type definitions
│   │   │   └── proxy.ts              # Next.js middleware (session, RBAC route rules)
│   │   ├── public/                   # Static assets (logos, icons, placeholders)
│   │   ├── next.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── .env                      # Local environment (gitignored)
│   │
│   └── admin/                        # Admin panel — @studiq/admin (port 4000)
│       ├── src/
│       │   ├── app/
│       │   │   ├── (frontend)/       # Admin pages (orgs, feature-flags, subscription-plans, user-overrides)
│       │   │   └── (backend)/api/v1/ # Admin-only endpoints
│       │   ├── server/               # Own controllers/ + services/ + models/
│       │   ├── lib/                  # Supabase service client, fetch wrapper, query keys
│       │   └── i18n/                 # Translations
│       ├── .env.example              # Committed env template
│       └── README.md                 # Admin panel pages and API routes
│
├── packages/
│   ├── server/                       # @studiq/server — shared backend (Route → Controller → Model → Service)
│   │   └── src/
│   │       ├── config/               # routes.config.ts — route rules (auth, roles, redirects)
│   │       ├── controllers/          # Request handlers (validate input, delegate to services)
│   │       ├── models/               # Zod validation schemas + inferred types
│   │       ├── services/             # Business logic + DB access
│   │       ├── guards/               # auth.guard.ts, role.guard.ts
│   │       ├── ai/                   # LLM client (model.ts) + AI types
│   │       ├── agents/               # Agent system + tools (generate-flashcards, extract-concepts...)
│   │       └── lib/                  # errors, request-context, with-auth, observability, supabase/...
│   ├── authz/                        # @studiq/authz — permissions, feature flags, request context
│   ├── ui/                           # @studiq/ui — shadcn/ui primitives (60+ components) shared by both apps
│   └── tsconfig/                     # Shared TS config base (base.json)
│
├── supabase/
│   ├── config.toml                   # Local Supabase configuration
│   ├── migrations/                   # Database migration files (timestamped)
│   ├── schemas/                      # Logical schema files by domain
│   ├── seeds/                        # Seed data files (domain-ordered)
│   ├── templates/                    # Email templates (confirmation, recovery)
│   └── flashcard-media/              # Static media placeholders
│
├── __tests__/                        # All tests live at the repo root, shared by both apps
│   ├── unit/                         # Unit tests (api, controllers, guards, lib, models, proxy, services)
│   ├── integration/                  # Integration tests (real Supabase)
│   ├── e2e/                          # Playwright end-to-end specs (login, register, flashcards, questions...)
│   ├── helpers/                      # Test utilities (test-user, supabase-mock)
│   ├── mocks/                        # Test mocks (supabase)
│   └── setup.ts                      # Test bootstrap
│
├── docs/                             # Project documentation (onboarding, architecture, api, ai...)
│   ├── decisions/                    # Architecture Decision Records (0001-0006)
│   └── plans/                        # Implementation plans (+ archive/)
│
├── scripts/                          # Repo tooling (spin, pr, switch-branch, lint guards)
├── package.json                      # Workspace root — workspaces: apps/*, packages/*
├── vitest.config.ts                  # Vitest config + path aliases
├── playwright.config.ts              # Playwright config
├── biome.json                        # Lint/format config (replaces ESLint + Prettier)
├── lefthook.yml                      # Git hooks
├── knip.json                         # Unused-code detection
├── tsconfig.json                     # Root TS config with workspace path aliases
├── components.json                   # shadcn/ui config
├── docker-compose.yml
├── .env.local                        # Optional root env, loaded by Vitest (gitignored)
└── README.md
```

## Architecture Philosophy

### Separation of Concerns

- **UI** lives in `apps/web/src/app/(frontend)/` and `apps/web/src/components/` — no business logic
- **Business logic** lives in `packages/server/src/` — shared by both apps, no UI rendering
- **API routes** are thin — they parse requests and delegate to controllers

### Imports

There are **no barrel files** — every module is imported from its own file path.
`packages/server` exposes subpath exports (`@studiq/server/services/*`,
`@studiq/server/controllers/*`, `@studiq/server/lib/*`, ...), and Biome's
`noBarrelFile` / `noReExportAll` rules keep it that way:

```typescript
import { flashcardService } from '@studiq/server/services/flashcard.service';
import { toNextResponse } from '@studiq/server/lib/http-utils';
```

Relative imports (`./...`, `../...`) are banned everywhere — see **Import
Aliases** below. `bun run lint` enforces this with Biome's `noRestrictedImports`
plus `scripts/check-import-paths.ts`.

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
| `@/` | The current app's `src/` — `apps/web/src/` in the web app, `apps/admin/src/` in the admin app (the root `tsconfig.json` maps it to `apps/web/src/`) |
| `@admin/*` | `apps/admin/src/*` — usable from anywhere (root `tsconfig.json`, Vitest) |
| `@studiq/server/*` | `packages/server/src/*` |
| `@studiq/authz/*` | `packages/authz/src/*` (bare `@studiq/authz` → `packages/authz/src/index.ts`) |
| `@studiq/ui`, `@studiq/ui/*` | `packages/ui/src/index.ts`, `packages/ui/src/*` |
| `#test/*` | `__tests__/*` — works in both Vitest and Playwright |
