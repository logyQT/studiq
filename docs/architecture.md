# Architecture

## Overview

StudiQ is a full-stack educational platform built with Next.js App Router and Supabase. The application follows a layered architecture with clear separation between frontend UI, backend business logic, and data access.

## High-Level Architecture

```mermaid
graph TB
    Client[Browser Client]
    Proxy[Next.js Middleware proxy.ts]
    Frontend["(frontend) Routes"]
    Backend["(backend) API Routes"]
    Controllers[Controllers]
    Services[Services]
    Guards[Guards]
    Providers[LLM Providers]
    Supabase[Supabase PostgreSQL]

    Client --> Proxy
    Proxy --> Frontend
    Proxy --> Backend
    Backend --> Controllers
    Controllers --> Services
    Controllers --> Guards
    Services --> Supabase
    Services --> Providers
```

## Application Layers

### Frontend Layer

**Location:** `src/app/(frontend)/`, `src/components/`, `src/hooks/`

**Responsibilities:**
- Rendering UI components
- Client-side navigation
- User interactions
- Localization via `next-intl`
- Theme handling via `next-themes`

**Key components:**
- `src/components/providers/AuthProvider.tsx` — client-side auth state
- `src/components/providers/ThemeProvider.tsx` — dark/light mode
- `src/components/providers/QueryProvider.tsx` — TanStack React Query
- `src/components/ui/` — 60+ shadcn/ui components
- `src/components/layout/` — layout components (navbar, footer, sidebar)
- `src/components/flashcards/` — flashcard-specific UI components
- `src/hooks/` — custom React hooks (API calls, real-time subscriptions, flashcard generation)

### Backend Layer

**Location:** `src/app/(backend)/api/`, `src/server/`

**Responsibilities:**
- HTTP request handling
- Input validation (Zod schemas)
- Business logic execution
- Database communication
- Error handling

**Sub-layers:**

```mermaid
graph LR
    Route[API Route Handler] --> Controller[Controller]
    Controller --> Service[Service]
    Service --> DB[(Supabase)]
    Controller --> Guard[Guard]
    Service --> Provider[LLM Provider]
```

| Layer | Location | Purpose |
|-------|----------|---------|
| Routes | `src/app/(backend)/api/v1/*/route.ts` | Next.js route handlers, parse request, call controller |
| Controllers | `src/server/controllers/` | Validate input via Zod models, coordinate services, return `ControllerResponse` |
| Services | `src/server/services/` | Business logic, database queries via Supabase client |
| Guards | `src/server/guards/` | Authentication and role checks |
| Models | `src/server/models/` | Zod schemas for request validation |
| Providers | `src/server/providers/` | LLM abstraction layer (OpenAI, Ollama) |

### Middleware Layer

**Location:** `src/proxy.ts`

The middleware intercepts every request and applies route rules before the request reaches a handler:

```mermaid
sequenceDiagram
    participant C as Client
    participant M as Middleware
    participant R as Route Handler

    C->>M: HTTP Request
    M->>M: updateSession (refresh Supabase cookie)
    M->>M: Match route rule
    alt Auth required + no session
        M->>C: 401 JSON or 302 to /login
    else Role restricted + wrong role
        M->>C: 403 JSON or 302 to role dashboard
    else Redirect if authenticated
        M->>C: 302 to role-specific dashboard (by role)
    else All checks pass
        M->>R: Forward request
        R->>C: Response
    end
```

Route rules are defined in `src/server/config/routes.config.ts`:

```typescript
export const routeRules: RouteRule[] = [
  { matcher: /^\/api\/v1\/admin(\/.*)?$/, requireAuth: true, allowedRoles: [UserRole.SYS_ADMIN], isApi: true },
  { matcher: /^\/api\/v1\/teacher(\/.*)?$/, requireAuth: true, allowedRoles: [UserRole.TEACHER, UserRole.SYS_ADMIN], isApi: true },
  { matcher: /^\/admin(\/.*)?$/, requireAuth: true, allowedRoles: [UserRole.SYS_ADMIN] },
  { matcher: /^\/edu(\/.*)?$/, requireAuth: true, allowedRoles: [UserRole.TEACHER] },
  { matcher: /^\/app(\/.*)?$/, requireAuth: true, allowedRoles: [UserRole.STUDENT, UserRole.FREE, UserRole.PREMIUM] },
  // ...
];
```

### Data Layer

**Location:** `supabase/`

Supabase provides:
- PostgreSQL database
- Authentication (email/password, sessions)
- Real-time subscriptions (used for live flashcard updates)

Schema is managed through SQL migration files in `supabase/migrations/`, logical schema files in `supabase/schemas/`, and seed data in `supabase/seeds/`.

## Request Flow

```mermaid
sequenceDiagram
    participant U as User
    participant MW as Middleware
    participant RT as Route Handler
    participant Ctrl as Controller
    participant Svc as Service
    participant DB as Supabase

    U->>MW: POST /api/v1/questions
    MW->>MW: Validate session + role
    MW->>RT: Forward
    RT->>RT: Parse JSON body
    RT->>Ctrl: controller.create(body, userId)
    Ctrl->>Ctrl: Zod schema validation
    Ctrl->>Svc: questionService.create(data, userId)
    Svc->>DB: INSERT INTO questions
    DB-->>Svc: Created row
    Svc-->>Ctrl: Question object
    Ctrl-->>RT: ControllerResponse (201)
    RT-->>U: JSON response
```

## Error Handling

All errors flow through a unified response system:

- `AppError` — thrown by services with a code and status
- `ControllerResponse` — standardized response shape returned by controllers
- `toNextResponse()` — converts `ControllerResponse` to Next.js `NextResponse`

```typescript
interface ControllerResponse {
  success: boolean;
  statusCode: number;
  data?: unknown;
  error?: string;
  details?: unknown;
}
```

## Key Design Decisions

See [Architecture Decision Records](decisions/) for detailed rationale behind technology and architecture choices.
