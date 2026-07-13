# StudiQ Agent Guidelines

## Project Identity

- **Runtime**: Bun (package manager, script runner)
- **Framework**: Next.js 16 (App Router), TypeScript 6
- **Database**: Supabase (PostgreSQL 17) + Supabase Auth
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York style)
- **i18n**: next-intl (`en`, `pl`), locale from `NEXT_LOCALE` cookie, defaults to `'pl'`
- **State/Data**: TanStack React Query v5
- **Forms**: React Hook Form + Zod v4
- **Testing**: Vitest (unit + integration) + Playwright (E2E)

---

## Commands

| Command | What it does |
|---------|-------------|
| `bun run dev` | Start dev server |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | **Runs `tsc --incremental --skipLibCheck --noEmit && biome ci src/`** — both typecheck AND lint in one command |
| `bun run format` | `biome check --write src/` |
| `bun run format:check` | `biome ci src/` (check only) |
| `bun run clean` | Remove `.next`, `coverage`, cache |
| `bun test` | `vitest run` — runs all tests (unit + integration) |
| `bun test:unit` | `vitest run __tests__/unit/` |
| `bun test:integration` | `vitest run __tests__/integration` |
| `bun test:watch` | `vitest` (watch mode) |
| `bun test:coverage` | `vitest run --coverage` |
| `bun test:e2e` | `playwright test` — runs `__tests__/e2e/` specs |

### Custom agent commands

| If you say | What I do |
|-----------|-----------|
| `commit propose` | `git diff --staged` → propose conventional commit message |

### Running a single test

```bash
bunx vitest run __tests__/unit/services/question.service.test.ts
bunx vitest run -t "test name pattern"
```

### Vitest import alias

`#test` → `__tests__/` works in vitest only (not in tsconfig). Use `@/` for app imports everywhere.

---

## Architecture: Route → Controller → Model → Service

All backend logic follows this strict 4-layer flow:

```
src/app/(backend)/api/v1/*/route.ts
  → src/server/controllers/*.ts     (validate input, call service)
    → src/server/models/*.ts         (Zod schemas + inferred types)
      → src/server/services/*.ts     (business logic + DB queries)
```

### Route layer

- Named exports: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- `withAuth(req, handler, { allowedRoles? })` builds `RequestContext`, wraps handler
- Handler receives **only `ctx`** — access `req` via closure
- Return `toNextResponse(await controller.method(data, ctx))`

### Controller layer

- Singleton: `export const fooController = new FooController()`
- Re-exported via `src/server/controllers/index.ts`
- Validate with Zod: `schema.safeParse(body)` → return error response (`{ success: false, statusCode: 422, error: 'UNPROCESSABLE_ENTITY', details }`)
- Wrap logic in `withSupervision(async () => { ... }, { service, method })` or `wrapService(service, name)` from `@/lib/observability`
- Use `hasPermission(ctx, Permission.XXX)` for auth checks
- Never throw — always return `ControllerResponse` object literal
- Response shape:

```typescript
type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | { success: false; statusCode: number; error: AppErrorCode; details?: ZodIssue[]; errorId?: string };
```

### Model layer

```typescript
import { z, registry } from '@/lib/zod';   // NOT from 'zod' directly
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateFooSchema = registry.register('CreateFooRequest', z.object({
  name: z.string().nonempty({ error: ValidationErrorCode.INVALID_INPUT }),
}));
export type CreateFooInput = z.infer<typeof CreateFooSchema>;
```

- Zod v4 API: `{ error: ValidationErrorCode.XXX }` instead of string messages
- Register every schema with `registry.register()` for OpenAPI doc generation

### Service layer

- Singleton, re-exported via `src/server/services/index.ts`
- Create Supabase client inside each method: `const supabase = await createClient()`
- Map DB errors: `throw mapSupabaseError(error)` (from `@/lib/supabase-errors`)
- Throw `AppError(code)` for business logic — **code only, no message**
- Use `checkPermission(ctx, Permission.XXX, resource)` for resource-scoped auth
- Use `buildQueryFilter(ctx, Permission.XXX)` for RLS-safe DB filters

---

## Error Handling

- `AppError(code: AppErrorCode)` — thrown by services, caught by `withAuth` (routes) and `withSupervision`/`wrapService` (services)
- Error codes → HTTP status via `APP_ERRORS` in `src/lib/errors.ts`:
  `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `GONE` (410), `UNPROCESSABLE_ENTITY` (422), `RATE_LIMITED` (429), `INTERNAL_SERVER` (500), `SERVICE_UNAVAILABLE` (503)
- `mapSupabaseError(error)` maps PG codes: PGRST116→NOT_FOUND, 23505→CONFLICT, etc.
- Unhandled `INTERNAL_SERVER` and `SyntaxError` recorded as OTEL spans via `withSupervision`/`wrapService` in `@/lib/observability`

---

## Logging & Tracing

### Logger (`src/lib/logger.ts`)

All logging via `log` singleton (consola-based). Named loggers:

| Name | Purpose | Enabled in production |
|------|---------|----------------------|
| `api` | Route-level request/response | Always |
| `auth` | Authentication events | Always |
| `ai` / `providers` | AI/LLM | Always |
| `pdf` / `cache` | PDF processing | Always |
| `system` | System events | Always |
| `trace` | Per-layer traces (Route → Controller → Service) | Dev only (noop in prod) |

```typescript
import { log } from '@/lib/logger';
log.api.info('request started', { metadata: { traceId } });
log.trace.info('slow query', { metadata: { table: 'flashcards' }, durationMs: 1500 });
```

- `log.trace.*` is a **noop logger** in production — V8 inlines empty functions
- Gate: `NODE_ENV !== 'production' || TRACE_ENABLED === 'true'`
- `.enabled` is `false` only for `trace` in production. Guard expensive metadata prep behind `if (log.trace.enabled)`
- `durationMs` field is displayed as `(150ms)` in console
- Every authenticated request gets a `traceId` (UUID) in `RequestContext`

---

## Supabase Clients

Three contexts, use the right one:

| File | When | How |
|------|------|-----|
| `src/lib/supabase/client.ts` | Browser (React components, hooks) | `createBrowserClient` |
| `src/lib/supabase/server.ts` | Server (API routes, services) | `createServerClient` with cookie handling |
| `src/lib/supabase/service.ts` | Admin/service role (migrations, webhooks) | Service role key, `autoRefreshToken: false`, `persistSession: false` |

---

## Route Protection (Middleware)

Next.js 16 requires `src/proxy.ts` — **do NOT rename to `middleware.ts`**.

Rules in `src/server/config/routes.config.ts` — evaluated in order:
1. If `redirectIfAuthenticatedByRole` matches → redirect by role
2. If `requireAuth` + no session → 401 (API) or redirect to `/login` (UI)
3. If `allowedRoles` + role mismatch → 403 (API) or redirect by role dashboard

API catch-all: `/api/v1/` (except `auth`, `health`, `avatar`, `stripe/webhook`) requires auth.
UI dashboards: `/admin` (SYS_ADMIN), `/manage` (UNIVERSITY_ADMIN), `/edu` (TEACHER), `/app` (STUDENT/FREE/PREMIUM).

---

## RBAC

**Roles** (`UserRole` enum in `src/types/`): `FREE | PREMIUM | STUDENT | TEACHER | UNIVERSITY_ADMIN | SYS_ADMIN`

- Backend: Permissions loaded from DB (`role_permissions` + `permissions` tables) with in-memory cache
- `hasPermission(ctx, 'flashcard.read')` — boolean check (controllers)
- `checkPermission(ctx, 'flashcard.read', resource)` — throws FORBIDDEN on mismatch (services)
- `buildQueryFilter(ctx, 'flashcard.read')` — returns Supabase filter based on scope (services)
- Frontend: **`useCan()` hook is the single source of truth** for both RBAC permissions and feature flags — use `can({ permissions: [...] })` for scoped resource checks and `can({ features: [...] })` for boolean feature gating

---

## i18n

- `next-intl` with `getRequestConfig` pulling locale from `NEXT_LOCALE` cookie (defaults `'pl'`)
- Messages in `src/i18n/messages/{locale}.json` — nested per component/page
- ICU message format for plurals
- Error message keys match `APP_ERRORS` constants
- `Common` namespace auto-merged into all other namespaces

---

## Frontend Conventions

### Data fetching

- `useApiQuery<T>({ queryKey, url, enabled?, staleTime?, gcTime? })` — wraps `useQuery`, default `staleTime: Infinity`, `gcTime: 30 min`
- `useApiMutation<TData, TVars>({ mutationFn, invalidateKeys? })` — wraps `useMutation`, auto-invalidates keys on success
- `apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiUploadFile` — raw fetch wrappers in `src/lib/api.ts`
- Query keys in `src/lib/query-keys.ts` — hierarchical `as const` assertions
- Realtime: builder pattern via `useRealtimeChannel`: `channel('name').listen(table, handler)`

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Services | `*.service.ts` | `question.service.ts` |
| Controllers | `*.controller.ts` | `question.controller.ts` |
| Models | `*.model.ts` | `question.model.ts` |
| Routes | `route.ts` | `api/v1/questions/route.ts` |
| Tests | `*.test.ts` | `question.service.test.ts` |
| Barrel files | `index.ts` | `src/server/services/index.ts` |
| Frontend hooks | `use-*.ts` | `use-api.ts` |

---

## Testing

| Type | Framework | Location | Notes |
|------|-----------|----------|-------|
| Unit | Vitest | `__tests__/unit/` | Mocked Supabase via `__tests__/setup.ts` |
| Integration | Vitest | `__tests__/integration/` | Real local Supabase instance |
| E2E | Playwright | `__tests__/e2e/` | Chromium, Firefox, WebKit |

- **Mock**: `__tests__/mocks/supabase.ts` — `vi.mock('@/lib/supabase/server')` in `__tests__/setup.ts`
- **Mock helper**: `__tests__/helpers/supabase-mock.ts`
- Tests run sequentially (`sequence.concurrent: false`)
- Coverage targets `src/server/**/*.ts` (excludes `index.ts`, `routes.config.ts`)

---

## Key Gotchas

- **`bun test:unit`** runs `vitest run __tests__/unit/`
- **`proxy.ts`**: Next.js 16 uses `src/proxy.ts` (not `middleware.ts`). Do not rename.
- **`@/lib/zod`**: Always import `{ z, registry }` from here, not from `'zod'` — enables OpenAPI schema registration
- **No backward compatibility layers**: Pre-market app. Delete old code paths and deprecated keys cleanly, never keep them "just in case"
- **Avatar route**: `/api/v1/avatar/[seed]` is public (DiceBear). `@dicebear/core` is server-only.
- **New API endpoints**: Add a `RouteRule` to `src/server/config/routes.config.ts` if it needs protection
- **New DB tables**: Add migration in `supabase/migrations/` and schema in `supabase/schemas/`
- **Barrel files exist at**: `src/server/controllers/`, `src/server/services/`, `src/server/models/`, `src/server/guards/`, `src/components/layout/`, `src/components/providers/`, `src/hooks/`, `src/types/`
