# StudiQ Agent Guidelines

## Project Identity

- **Name**: StudiQ — private edtech platform
- **Runtime**: Bun (package manager, script runner)
- **Framework**: Next.js 16 (App Router), TypeScript 6
- **Database**: Supabase (PostgreSQL 17)
- **Package manager**: Bun (`bun install`, `bun dev`, `bun test`, etc.)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York style)
- **i18n**: next-intl (`en`, `pl`), locale from `NEXT_LOCALE` cookie
- **Testing**: Vitest (unit + integration) + Playwright (E2E)

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
- Wrap handler in `withAuth(req, handler)` for authenticated routes
- Parse `req.json()` for bodies, `searchParams` for query params
- Call `controller.method(data, ctx)`, return `toNextResponse(response)`
- Each route file is a thin delegate — zero business logic

```typescript
// src/app/(backend)/api/v1/questions/route.ts
export const POST = withAuth(async (req: NextRequest, ctx: RequestContext) => {
  const body = await req.json();
  const response = await questionController.create(body, ctx);
  return toNextResponse(response);
});
```

### Controller layer (`*.controller.ts`)

- Singleton export: `export const questionController = new QuestionController()`
- Barrel re-export in `src/server/controllers/index.ts`
- Each method accepts `(body, ctx: RequestContext)` or `(id, body, ctx)`
- Validate input with Zod: `schema.safeParse(body)` → return `ControllerResponse`
- Wrap logic in `withErrorHandling(async () => { ... }, ctx)`
- Never throw — always return `ControllerResponse`

```typescript
class QuestionController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateQuestionSchema.safeParse(body);
      if (!parsed.success) return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
      const question = await questionService.create(parsed.data, ctx);
      return controllerResponse.created(question);
    }, ctx);
  }
}
```

### Model layer (`*.model.ts`)

- Zod schemas for request validation
- Use `registry.register('Name', schema)` for OpenAPI doc generation
- Export inferred types: `export type CreateInput = z.infer<typeof CreateSchema>`
- Error messages use `{ error: ValidationErrorCode.XXX }`
- At `src/server/models/`, barrel re-exported via `index.ts`

```typescript
export const CreateQuestionSchema = z.object({
  subjectId: z.string().uuid().optional(),
  type: z.enum(['mcq', 'true_false', 'open']),
  content: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  answers: z.array(z.object({
    content: z.string().min(1),
    isCorrect: z.boolean(),
    orderIndex: z.number().int().default(0),
  })).min(1),
});
```

### Service layer (`*.service.ts`)

- Singleton export: `export const questionService = new QuestionService()`
- Barrel re-export in `src/server/services/index.ts`
- Create Supabase client inside each method: `const supabase = await createClient()`
- Map DB errors: `mapSupabaseError(error)`
- Throw `AppError` for business logic failures: `throw new AppError('NOT_FOUND')`
- Ownership checks: filter by `created_by` or `university_id`

```typescript
class QuestionService {
  async create(data: CreateQuestionInput, ctx: RequestContext) {
    const supabase = await createClient();
    const { data: question, error } = await supabase
      .from('questions')
      .insert({ ...data, created_by: ctx.userId })
      .select()
      .single();
    if (error) throw mapSupabaseError(error);
    return question;
  }
}
```

---

## ControllerResponse

Discriminated union — all API responses follow this shape:

```typescript
type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | { success: false; statusCode: number; error: AppErrorCode; details?: ZodIssue[]; errorId?: string };
```

Utility helpers (from `src/lib/controller-response.ts`):
- `controllerResponse.success(data, statusCode?)` — 200 by default
- `controllerResponse.created(data)` — 201
- `controllerResponse.error(code, details?)` — maps code to status via `APP_ERRORS`

---

## Error Handling

- `AppError(code: AppErrorCode)` — thrown by services, caught by `withErrorHandling`
- Error codes map to HTTP status: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNPROCESSABLE_ENTITY` (422), `INTERNAL_SERVER` (500)
- `withErrorHandling(fn, ctx?)` wraps controller methods — catches `AppError` and unexpected errors, logs `INTERNAL_SERVER` to `error_logs` table, always returns `ControllerResponse`

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
| `src/lib/supabase/server.ts` | Server (API routes, server components) | `createServerClient(url, anonKey, { cookies })` |
| `src/lib/supabase/service.ts` | Admin/svc role (migrations, webhooks) | `createClient(url, serviceRoleKey)` with `{ autoRefreshToken: false, persistSession: false }` |

---

## Frontend Conventions

### Composable hooks pattern

All data fetching uses composable hooks wrapping TanStack React Query:

- **`useApiQuery<T>(opts: { queryKey, url, enabled?, staleTime?, gcTime? })`** — wrapper around `useQuery`. Calls `apiGet<T>(url)`. Default `staleTime: Infinity`, `gcTime: 30 min`. Accepts a single options object.

- **`useApiMutation<TData, TVars, TContext>(opts: { mutationFn, invalidateKeys?, onMutate?, onError?, onSettled? })`** — wrapper around `useMutation`. Automatically invalidates `invalidateKeys` array on success via `queryClient.invalidateQueries()`. Accepts a single options object.

- **`apiGet`, `apiPost`, `apiPut`, `apiDelete`** — raw fetch wrappers in `src/lib/api.ts`. Extract `.data` from JSON response.

```typescript
// Example pattern:
const { data, isLoading } = useApiQuery({
  queryKey: flashcardKeys.decks.all,
  url: '/api/v1/flashcards/decks',
});

const { mutate } = useApiMutation({
  mutationFn: (body) => apiPost('/api/v1/flashcards/decks', body),
  invalidateKeys: [flashcardKeys.decks.all],
});
```

### Query keys (`src/lib/query-keys.ts`)

Hierarchical, const assertions:
```typescript
export const flashcardKeys = {
  all: ['flashcards'] as const,
  decks: {
    all: ['flashcards', 'decks'] as const,
    detail: (id: string) => ['flashcards', 'decks', id] as const,
  },
  list: (filters?: Record<string, string[]>) => ['flashcards', 'list', filters] as const,
  topics: { all: ['flashcards', 'topics'] as const },
};
```

### Realtime pattern (`useRealtimeChannel`)

Use the builder pattern for Supabase realtime subscriptions:

```typescript
const builder = channel('deck-channel')
  .listen('flashcard_deck_assignments', (payload) => {
    queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
  });

useRealtimeChannel(builder);
```

- `channel(name: string): RealtimeBuilder` — factory function
- `.listen(table: string, handler, opts?)` — registers a postgres_changes listener
- `useRealtimeChannel(builder)` — hook that subscribes in `useEffect`, cleans up on unmount
- High-level hooks (`useDeckFlashcardRealtime`, `useDeckListRealtime`, `useTopicRealtime`) compose `useRealtimeChannel` with specific keys

### SSE streaming pattern

For AI/flashcard generation streams, use raw `fetch` + `AbortController` + `ReadableStream`:

```typescript
const controller = new AbortController();
const response = await fetch(url, { signal: controller.signal });
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // parse SSE events from buffer
}
```

Events: `flashcards`, `progress`, `complete`, `error`

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
- `can(role, 'flashcard.read', createdBy, userId)` — scope-aware check

---

## Route Protection (Middleware)

Defined in `src/proxy.ts` + `src/server/config/routes.config.ts`.

> **Next.js 16 note**: `proxy.ts` is the correct filename convention (not `middleware.ts`). The file exports `proxy` as the handler function. Do NOT rename it to `middleware.ts`.

Rules evaluated in order:
1. If `redirectIfAuthenticatedByRole` matches → redirect by role
2. If `requireAuth` + no session → 401 (API) or redirect to `/login` (UI)
3. If `allowedRoles` + role mismatch → 403 (API) or redirect to role dashboard (UI)

```typescript
// pattern
{ matcher: /^\/api\/v1\/admin(\/.*)?$/, requireAuth: true, allowedRoles: [UserRole.SYS_ADMIN], isApi: true },
```

Route rules for UI: `/admin`, `/manage`, `/edu`, `/app` — each restricted to specific roles.
Auth routes (`/login`, `/register`) redirect authenticated users by role.

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
| Test files | `*.test.ts` | `question.controller.test.ts` |
| Barrel files | `index.ts` | `src/server/services/index.ts` |
| Frontend hooks | `use-*.ts` | `use-flashcard-generation.ts` |

---

## Import Aliases

| Alias | Resolves to |
|-------|-------------|
| `@/` | `src/` |
| `#test` | `__tests__/` |

---

## Testing

| Type | Framework | Location | Notes |
|------|-----------|----------|-------|
| Unit | Vitest | `__tests__/unit/` | Mocked Supabase, test controllers/guards/models/services |
| Integration | Vitest | `__tests__/integration/` | Real local Supabase instance |
| E2E | Playwright | `e2e/` | Real browser, full app |

- **Mock file**: `__tests__/mocks/supabase.ts`
- **Mock helper**: `__tests__/helpers/supabase-mock.ts`
- **Setup**: `__tests__/setup.ts`
- **Run**: `bun test`, `bun test:unit`, `bun test:integration`, `bun test:coverage`, `bun test:watch`

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
