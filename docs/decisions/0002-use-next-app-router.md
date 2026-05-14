# ADR-0002: Use Next.js App Router

## Status

Accepted

## Context

The application needed a React framework with server-side rendering, API routes, file-based routing, and middleware support for authentication.

## Decision

Next.js 16 with the App Router was selected over Pages Router and other React frameworks.

## Consequences

### Positive
- Server Components reduce client-side JavaScript
- Route groups `(frontend)` and `(backend)` organize concerns cleanly
- Middleware enables request-level auth/RBAC before route handlers execute
- API routes co-located with the application — no separate backend service needed
- Built-in TypeScript support
- Vercel deployment is zero-config

### Negative
- App Router has a learning curve for teams familiar with Pages Router
- Some patterns (data fetching, caching) differ significantly from traditional React
- Server/Client component boundaries require careful planning
