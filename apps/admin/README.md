# StudiQ Admin Panel

Internal Next.js 16 app for system administration. Runs on port 4000. It has no
app-level auth and is not deployed. Do not deploy it until the ADR-0009 blockers
clear (see Auth below).

## Quick Start

```bash
# From repo root (admin HMR is outside the env tool)
bun run --filter @studiq/admin dev

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

`apps/admin` is an **internal operations tool**, not a product surface, and it is
**not deployed**. It has **no app-level authentication**: its API routes skip
`withAuth`, and they are not protected by an app-level signature or token scheme.

Do **not** deploy it until the ordered blockers in
[`docs/decisions/0009-admin-is-internal-not-deployed.md`](../../docs/decisions/0009-admin-is-internal-not-deployed.md)
clear. If it is ever deployed, infrastructure-level access control — Vercel
Authentication (All Deployments) / Cloudflare Access / VPN — is mandatory but not
sufficient; the app-level gate must land first. See the staging plan (S2/S9).

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
