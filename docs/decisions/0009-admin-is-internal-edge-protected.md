# ADR-0009: `apps/admin` is internal and edge-protected

## Status

Accepted (2026-11-06). Supersedes
[ADR-0007](0007-admin-api-auth.md) (admin API PEM auth).

## Context

`apps/admin` is an internal operations tool, not a product surface. It was
carrying app-level Ed25519 PEM auth (`apps/admin/src/proxy.ts`), an admin
Playwright project/job, admin unit/integration tests in the product gates and 20+
QA cases. All of that was overhead for a tool used by a handful of operators,
and the PEM gate could not protect UI pages anyway while making the browser
panel unusable in PEM mode.

The protection model already lives in
[`docs/plans/staging-environment.md`](../plans/staging-environment.md) (S2 for
admin protection, S9 for agent access): Vercel Authentication / Cloudflare
Access / VPN in front of the admin deployment, and QA never exercises admin.

## Decision

1. **Keep `apps/admin`.** The app, its pages, controllers, services and the
   manual scripts (`dev:admin`, `build:admin`, `start:admin`, `lint:admin`,
   `typecheck:admin`) stay. The PEM gate, the signer, the admin e2e project and
   the admin cases in the product gates are removed.
2. **No app-level auth.** Admin API routes still skip `withAuth`; there is no
   signature, token, Basic auth or shared secret in the app. The deployment
   **must** sit behind infrastructure-level access control — Vercel
   Authentication (All Deployments) or Cloudflare Access, plus generated-URL
   protection, or a true VPN when self-hosted. It covers UI pages and `/api/*`
   on every URL (custom domain, generated deployment URLs, aliases).
3. **QA does not exercise admin** (staging plan S9). No QA case, prerequisite or
   agent prompt may require the admin panel.
4. **Product CI does not gate on admin.** `apps/admin` is excluded from
   `typecheck:all`, `lint` and the default unit/integration runs. An admin-only
   change runs `checks` only (format is repo-wide) and starts no QA shard.
5. **Manual admin checks** replace the CI gate: `bun run lint:admin`,
   `bun run typecheck:admin`, `bun run build:admin`, and `bun run test:admin`
   (unit + the admin-platform-stats integration test when Supabase is up).

## Consequences

### Positive

- One protection model instead of two: access is enforced before the request
  reaches Next.js, so UI pages and API routes are equally covered.
- The panel is usable in a browser behind the edge gate.
- Product CI and QA stop paying for an internal tool.

### Negative / residual risk

- **Admin has no app-level auth.** Anyone who can reach the deployment URL can
  use the panel with the service-role client. It must never be deployed
  publicly, and every generated/aliased URL must be behind the same gate.
- Admin is no longer covered by product CI; `lint:admin` / `typecheck:admin` /
  `build:admin` / `test:admin` are manual.

## If multi-user admin is needed later

Use SSO identity plus roles and DB-backed tokens (the destination recorded in
ADR-0007), not a restored PEM keyring.
