# StudiQ Admin Panel

Standalone Next.js 16 app for system administration. Runs on port 4000.

## Quick Start

```bash
# From repo root
bun run dev:admin

# Or directly
cd apps/admin && bun run dev
```

Open http://localhost:4000

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard with nav to all sections |
| `/feature-flags` | CRUD for feature flags (10 flags in local DB) |
| `/subscription-plans` | Plans with expandable features + limits |
| `/user-overrides` | Per-user feature flag overrides |
| `/orgs` | List of organizations with member/group/role counts |
| `/orgs/[id]` | Org detail with members, groups, roles tabs |

## API Routes

All under `/api/v1/`. Controllers live in `src/server/controllers/`, services in `src/server/services/`.

| Route | Methods |
|-------|---------|
| `feature-flags` | GET, POST |
| `feature-flags/[key]` | GET, PUT, DELETE |
| `plan-features` | GET, POST |
| `plan-features/[id]` | GET, DELETE |
| `plan-limits` | GET (`?planKey=` filter), POST |
| `plan-limits/[id]` | GET, PUT, DELETE |
| `user-overrides` | GET, POST |
| `user-overrides/[id]` | GET, PUT, DELETE |
| `subscription-plans` | GET, POST |
| `subscription-plans/[key]` | GET, PUT, DELETE |
| `organizations` | GET |
| `organizations/[id]` | GET (with details) |

## Auth

API routes use PEM signature verification (Ed25519) via `proxy.ts`. In local dev (`ADMIN_PEM_KEYS` empty), all requests pass through. See [issue #106](https://github.com/logyQT/studiq/issues/106) for planned scoped key support.

## Database

Uses service-role Supabase client (no user JWT). Local dev Supabase at `127.0.0.1:54321`. Pre-seeded with 4 orgs, 11 profiles, 10 feature flags, 79 plan features, 13 subscription plans.

## Architecture

Same 4-layer pattern as the main app: Route → Controller → Model → Service. Admin services use `@admin/lib/supabase/admin-client` (service-role) instead of the shared cookie-based client.

## Tech Stack

- Next.js 16 (Turbopack)
- @tanstack/react-query for data fetching
- @studiq/ui (shadcn components)
- next-intl (EN + PL)
- lucide-react icons
