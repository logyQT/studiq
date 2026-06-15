# StudiQ Agent Guidelines

## Project Identity

- **Runtime**: Bun (package manager, script runner)
- **Framework**: Next.js 16 (App Router), TypeScript 6
- **Database**: Supabase (PostgreSQL 17)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York style)
- **i18n**: next-intl (`en`, `pl`), locale from `NEXT_LOCALE` cookie, defaults to `'pl'`
- **Testing**: Vitest (unit + integration) + Playwright (E2E)

---

## Commands

| Command | What it does |
|---------|-------------|
| `bun run dev` | Start dev server |
| `bun run build` | Production build |
| `bun run lint` | **Runs `tsc && eslint .`** — both typecheck AND lint in one command |
| `bun run format` | Prettier write |
| `bun test` | **Runs `supabase db reset` first** — requires local Supabase running |
| `bun test:unit` | **BROKEN** — script is `vitest run src/server` but no tests exist there |
| `bun test:integration` | `vitest run __tests__/integration` |
| `bun test:watch` | `vitest` (watch mode) |
| `bun test:coverage` | `vitest run --coverage` |
| `bun run test:e2e` | Playwright (starts its own server via `bunx supabase db reset && bun run build && bun run start`) |

### Running a single test

```bash
bunx vitest run __tests__/unit/services/question.service.test.ts
bunx vitest run -t "test name pattern"
```

### Vitest config gotcha

`vitest.config.ts` includes `__test__/unit/**/*.test.ts` (typo — missing 's'). The actual directory is `__tests__/unit/`. Unit tests only run via direct path or by fixing the config. Integration tests work because their glob (`__tests__/integration/`) is correct.

---

## Architecture: Route → Controller → Model → Service

All backend logic follows this strict 4-layer flow:

```
src/app/(backend)/api/v1/*/route.ts   ← Next.js App Router handler
  → src/server/controllers/*.ts       ← Singleton, validates input, calls service
    → src/server/models/*.ts          ← Zod schemas (validation + types)
      → src/server/services/*.ts      ← Singleton, business logic + DB queries
```

### Route layer (`route.ts`)

- Named exports: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- `withAuth(req, handler)` builds `RequestContext` from session, then calls `handler(ctx)`
- Handler receives **only `ctx`** — access `req` via closure
- Call `controller.method(data, ctx)`, return `toNextResponse(response)`
- Optional third arg: `withAuth(req, handler, { allowedRoles: [UserRole.TEACHER] })`

```typescript
export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await questionController.create(body, ctx));
  });
}
```

### Controller layer (`*.controller.ts`)

- Singleton export: `export const questionController = new QuestionController()`
- Barrel re-export in `src/server/controllers/index.ts`
- Validate input with Zod: `schema.safeParse(body)` → return error response on failure
- Wrap logic in `withErrorHandling(async () => { ... }, ctx)`
- Never throw — always return `ControllerResponse`
- Construct responses as object literals (not via `controllerResponse` helpers):

```typescript
return withErrorHandling(async () => {
  const parsed = CreateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, statusCode: 422, error: 'UNPROCESSABLE_ENTITY', details: parsed.error.issues };
  }
  const question = await questionService.create(parsed.data, ctx);
  return { success: true, statusCode: 201, data: question };
}, ctx);
```

### Model layer (`*.model.ts`)

- **Import Zod from `@/lib/zod`**, NOT from `'zod'` directly — it wraps Zod with OpenAPI extensions
- Import `{ z, registry }` from `@/lib/zod`
- Register schemas: `registry.register('Name', schema)` for OpenAPI doc generation
- Export inferred types: `export type CreateInput = z.infer<typeof CreateSchema>`
- Validation error messages use `ValidationErrorCode` enum from `@/lib/validation-errors`
- Zod v4 API: `{ error: ValidationErrorCode.XXX }` instead of string messages

```typescript
import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateQuestionSchema = registry.register('CreateQuestionRequest', z.object({
  type: z.enum(['mcq', 'true_false', 'open']),
  content: z.string().nonempty({ error: ValidationErrorCode.INVALID_INPUT }).min(1).max(255),
}));
```

### Service layer (`*.service.ts`)

- Singleton export: `export const questionService = new QuestionService()`
- Barrel re-export in `src/server/services/index.ts`
- Create Supabase client inside each method: `const supabase = await createClient()`
- Map DB errors: `throw mapSupabaseError(error)` (from `@/lib/supabase-errors`)
- Throw `AppError` for business logic failures — **code only, no message**: `throw new AppError('NOT_FOUND')`
- `AppError` derives its message and status from `APP_ERRORS` map automatically

---

## ControllerResponse

Discriminated union — all API responses follow this shape:

```typescript
type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | { success: false; statusCode: number; error: AppErrorCode; details?: ZodIssue[]; errorId?: string };
```

Helper exists at `src/lib/controller-response.ts` (`controllerResponse.success/created/error`) but most controllers construct objects directly.

---

## Error Handling

- `AppError(code: AppErrorCode)` — thrown by services, caught by `withErrorHandling` and `withAuth`
- Error codes map to HTTP status via `APP_ERRORS` in `src/lib/errors.ts`:
  `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `GONE` (410), `UNPROCESSABLE_ENTITY` (422), `INTERNAL_SERVER` (500)
- `withErrorHandling(fn, ctx?)` wraps controller methods — catches `AppError` and unexpected errors, logs `INTERNAL_SERVER` to `error_logs` table
- `mapSupabaseError(error)` from `@/lib/supabase-errors` — maps PG error codes to `AppError` (PGRST116→NOT_FOUND, 23505→CONFLICT, etc.)

---

## Guards

- `authGuard(user: User | null): boolean` — returns `true` if user exists
- `roleGuard(user: User | null, allowedRoles: UserRole[]): boolean` — returns `true` if user's role is in allowedRoles
- Used in `src/proxy.ts` middleware. Controllers rely on `withAuth` at the route layer instead.
- `checkPermission(ctx, permission, resource?)` — RBAC check from database-loaded role_permissions
- `buildQueryFilter(ctx, permission)` — returns Supabase filter object based on permission scope

---

## Supabase Clients

Three client contexts, never use the wrong one:

| File | When | How |
|------|------|-----|
| `src/lib/supabase/client.ts` | Browser (React components, hooks) | `createBrowserClient(url, anonKey)` |
| `src/lib/supabase/server.ts` | Server (API routes, server components, services) | `createServerClient(url, anonKey, { cookies })` |
| `src/lib/supabase/service.ts` | Admin/svc role (migrations, webhooks) | `createClient(url, serviceRoleKey)` with `{ autoRefreshToken: false, persistSession: false }` |

---

## Frontend Conventions

### Composable hooks pattern

All data fetching uses composable hooks wrapping TanStack React Query:

- **`useApiQuery<T>({ queryKey, url, enabled?, staleTime?, gcTime? })`** — wrapper around `useQuery`. Calls `apiGet<T>(url)`. Default `staleTime: Infinity`, `gcTime: 30 min`.
- **`useApiMutation<TData, TVars, TContext>({ mutationFn, invalidateKeys?, onMutate?, onError?, onSettled? })`** — wrapper around `useMutation`. Invalidates `invalidateKeys` on success.
- **`apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiUploadFile`** — raw fetch wrappers in `src/lib/api.ts`. Extract `.data` from JSON response.

### Query keys (`src/lib/query-keys.ts`)

Hierarchical, const assertions:
```typescript
export const flashcardKeys = {
  all: ['flashcards'] as const,
  decks: { all: ['flashcards', 'decks'] as const, detail: (id: string) => ['flashcards', 'decks', id] as const },
  topics: { all: ['flashcards', 'topics'] as const },
  practice: { dueBreakdown: ['flashcards', 'practice', 'dueBreakdown'] as const },
  stats: { teacher: ['flashcards', 'stats', 'teacher'] as const },
};
```

### Realtime pattern (`useRealtimeChannel`)

Builder pattern for Supabase realtime subscriptions:

```typescript
const builder = channel('deck-channel')
  .listen('flashcard_deck_assignments', (payload) => {
    queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
  });
useRealtimeChannel(builder);
```

### SSE streaming pattern

For AI/flashcard generation streams, use raw `fetch` + `AbortController` + `ReadableStream`. Events: `flashcards`, `progress`, `complete`, `error`.

---

## RBAC

### Roles (`UserRole` enum)

`FREE | PREMIUM | STUDENT | TEACHER | UNIVERSITY_ADMIN | SYS_ADMIN`

### Backend

- Permissions loaded from DB (`role_permissions` + `permissions` tables) with in-memory cache
- `checkPermission(ctx, 'flashcard.read', resource)` — enforces scope
- `buildQueryFilter(ctx, 'flashcard.read')` — returns DB filter for RLS

### Frontend

- Static map in `src/lib/frontend-rbac.ts`
- `can(role, 'flashcard.read', createdBy, userId)` — scope-aware check (`own`, `university`, `any`)

---

## Route Protection (Middleware)

Defined in `src/proxy.ts` + `src/server/config/routes.config.ts`.

> **Next.js 16 note**: `proxy.ts` is the correct filename convention (not `middleware.ts`). Do NOT rename it.

Rules evaluated in order:
1. If `redirectIfAuthenticatedByRole` matches → redirect by role
2. If `requireAuth` + no session → 401 (API) or redirect to `/login` (UI)
3. If `allowedRoles` + role mismatch → 403 (API) or redirect to role dashboard (UI)

API catch-all: `/api/v1/` (except `auth`, `health`, `dev`) requires auth.
UI dashboards: `/admin` (SYS_ADMIN), `/manage` (UNIVERSITY_ADMIN), `/edu` (TEACHER), `/app` (STUDENT/FREE/PREMIUM).

---

## i18n

- `next-intl` with `getRequestConfig` pulling locale from `NEXT_LOCALE` cookie (defaults to `'pl'`)
- Messages in `src/i18n/messages/{locale}.json` — nested objects per component/page
- ICU message format for plurals: `{count, plural, one {...} few {...} other {...}}`
- Error message keys match `APP_ERRORS` constants

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Service files | `*.service.ts` | `question.service.ts` |
| Controller files | `*.controller.ts` | `question.controller.ts` |
| Model files | `*.model.ts` | `question.model.ts` |
| Route handlers | `route.ts` | `api/v1/questions/route.ts` |
| Test files | `*.test.ts` | `question.service.test.ts` |
| Barrel files | `index.ts` | `src/server/services/index.ts` |
| Frontend hooks | `use-*.ts` | `use-flashcard-generation.ts` |

---

## Import Aliases

| Alias | Resolves to | Where configured |
|-------|-------------|-----------------|
| `@/` | `src/` | tsconfig.json + vitest.config.ts |
| `#test` | `__tests__/` | **vitest.config.ts only** — not in tsconfig, only works in test files |

---

## Testing

| Type | Framework | Location | Notes |
|------|-----------|----------|-------|
| Unit | Vitest | `__tests__/unit/` | Mocked Supabase via `__tests__/setup.ts` |
| Integration | Vitest | `__tests__/integration/` | Real local Supabase instance |
| E2E | Playwright | `e2e/` | Chromium, Firefox, WebKit |

- **Mock file**: `__tests__/mocks/supabase.ts`
- **Mock helper**: `__tests__/helpers/supabase-mock.ts`
- **Setup**: `__tests__/setup.ts` — mocks `@/lib/supabase/server` via `vi.mock`
- Tests run sequentially (`sequence.concurrent: false`)
- Coverage targets `src/server/**/*.ts`

---

## Development Philosophy

- **No backward compatibility layers**. The app is pre-market and iterates rapidly. Never keep old code paths, deprecated APIs, or legacy translation keys "just in case". When renaming or restructuring, do it cleanly — delete the old, add the new.

---

## One-Time / Global Rules

- When creating a new API endpoint, always add the `RouteRule` to `src/server/config/routes.config.ts` if it needs protection
- When creating a new DB table, add a migration in `supabase/migrations/` and a schema file in `supabase/schemas/`
- When adding a feature that needs realtime, compose `useRealtimeChannel` with existing query keys
- When adding a new model file, register schemas with `registry.register()` for OpenAPI docs
- Barrel files (`index.ts`) exist in: `src/server/controllers/`, `src/server/services/`, `src/server/models/`, `src/server/guards/`, `src/components/layout/`, `src/components/providers/`, `src/hooks/`, `src/types/`
