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

| Route                 | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `/`                   | Dashboard with nav to all sections                                       |
| `/feature-flags`      | CRUD for feature flags (10 flags in local DB)                            |
| `/subscription-plans` | Plans with expandable features + limits                                  |
| `/user-overrides`     | Per-user feature flag overrides                                          |
| `/orgs`               | List of organizations with member/group/role counts                      |
| `/orgs/[id]`          | Org detail with members, groups, roles tabs                              |
| `/users`              | User management: search, create, change role, soft-delete/restore, purge |

## API Routes

All under `/api/v1/`. Controllers live in `src/server/controllers/`, services in `src/server/services/`.

| Route                     | Methods                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `feature-flags`           | GET, POST                                                        |
| `feature-flags/[id]`      | GET, PUT, DELETE                                                 |
| `plan-features`           | GET, POST                                                        |
| `plan-features/[id]`      | GET, DELETE                                                      |
| `plan-limits`             | GET (`?planKey=` filter), POST                                   |
| `plan-limits/[id]`        | GET, PUT, DELETE                                                 |
| `user-overrides`          | GET, POST                                                        |
| `user-overrides/[id]`     | GET, PUT, DELETE                                                 |
| `subscription-plans`      | GET, POST                                                        |
| `subscription-plans/[id]` | GET, PUT, DELETE                                                 |
| `organizations`           | GET                                                              |
| `organizations/[id]`      | GET (with details)                                               |
| `users`                   | GET (list, `?status=&page=&perPage=&search=`), POST              |
| `users/[id]`              | GET (with memberships), PUT (account type), DELETE (soft delete) |
| `users/[id]/restore`      | POST                                                             |
| `users/[id]/purge`        | POST                                                             |
| `users/purge-expired`     | POST                                                             |

## Auth

API routes use Ed25519 PEM signatures via `proxy.ts`. `ADMIN_PEM_KEYS` is a JSON
keyring (`[{ id, key, scopes, expiresAt? }]`) — see `.env.example` for the format
and the full scope vocabulary. In local dev (empty `ADMIN_PEM_KEYS`) all requests
pass through; an empty ring in production denies everything, and a non-empty ring
with zero valid entries denies everything everywhere.

Requests are signed over `METHOD\npathname\ncanonical-query\ntimestamp\nsha256(body)`,
so query strings and bodies cannot be swapped. Sign one with:

```bash
bun scripts/admin-sign.ts gen --id ops-local --scopes feature-flags:read
bun scripts/admin-sign.ts sign GET http://localhost:4000/api/v1/feature-flags
```

The gate forwards the verified key id as `x-admin-key-id` and writes one audit
record per authenticated request. The browser panel itself cannot sign requests in
PEM mode — that is option B in
[`docs/decisions/0007-admin-api-auth.md`](../../docs/decisions/0007-admin-api-auth.md).

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
