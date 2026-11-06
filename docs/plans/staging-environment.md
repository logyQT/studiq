# Staging environment

**Status:** proposed, not started  
**Target:** a persistent staging environment for release candidates, agent regression runs, final QA and manual testing.

## 1. Goals

- One stable URL for the web app: `https://staging.<domain>`.
- A separate admin deployment: `https://admin.staging.<domain>`, not public.
- One dedicated Supabase staging project, never production.
- Stripe **test mode** only, with a staging webhook endpoint.
- Registration disabled; staging is invite/seed only.
- Manual deploys gated by a GitHub Environment reviewer.
- Nightly deploys of `main` when it has moved, tagged for traceability.
- Agents can test merged `main` against staging without provisioning an env.
- No production data, no live Stripe keys, no production service-role key.

## 2. Non-goals

- Per-PR preview environments with their own Supabase/Stripe.
- Nightly production releases.
- Migrating production data into staging.
- Making staging the production environment.
- Real payments, live Stripe keys, real customer data.
- A full VPN in front of Vercel itself (see Admin protection).

## 3. Topology

```text
staging.<domain>              Vercel project: apps/web
                              public, registration disabled
admin.staging.<domain>        Vercel project: apps/admin
                              protected by SSO / Access / self-hosted proxy
staging Supabase project      separate cloud project
                              migrations + seed via CI
Stripe test mode              test keys, test prices, staging webhook
GitHub Actions                staging environment
                              manual approval + nightly schedule
```

## 4. Decisions to lock before build

| #   | Decision               | Proposed default                                                                                                                                   |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Staging web visibility | Public, registration disabled, `noindex`, test data only                                                                                           |
| S2  | Admin protection       | Vercel Authentication (All Deployments) or Cloudflare Access plus generated-URL protection; true VPN only if admin is self-hosted                  |
| S3  | Supabase project       | New cloud project, separate from production                                                                                                        |
| S4  | Stripe mode            | Test mode only; `PAYMENT_DRIVER=stripe` on staging after the real driver + signature-verified webhook land                                         |
| S5  | Registration           | Supabase signups off + app-level `ALLOW_REGISTRATION=false`                                                                                        |
| S6  | Deploy gate            | GitHub `staging` environment with required reviewer                                                                                                |
| S7  | Nightly                | Deploy `main` at 02:00 UTC if it moved; tag `staging-YYYYMMDD-HHMMSS-<short-sha>` so manual and nightly deploys on the same UTC date stay distinct |
| S8  | Data reset             | Explicit operator action only; no automatic nightly reset                                                                                          |
| S9  | Agent access           | Web app + seeded test accounts; never admin                                                                                                        |
| S10 | Production promotion   | Manual, separate workflow; staging never deploys to prod                                                                                           |

## 5. Vercel

### Projects

Two Vercel projects from the same repo:

| Project | Root directory | Domain                   |
| ------- | -------------- | ------------------------ |
| web     | `apps/web`     | `staging.<domain>`       |
| admin   | `apps/admin`   | `admin.staging.<domain>` |

Build settings:

```text
Install command: bun install --frozen-lockfile
Build command:   bun run build
Output:          .next
Node:            22
```

### Environment variables

Web project:

```dotenv
NEXT_PUBLIC_SITE_URL=https://staging.<domain>
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...          # server-only
PAYMENT_DRIVER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
ALLOW_REGISTRATION=false
# MAIL_*, LLM_*, OTEL_* as needed for staging
```

Admin project:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_PEM_KEYS=...
```

Use Vercel environment scopes, not committed files. Never put the service-role key or Stripe secret in `NEXT_PUBLIC_*`.

### Deploy mode

For manual + nightly gating, **disable Git auto-deploys for the staging projects** and deploy through GitHub Actions with the Vercel CLI. Otherwise a push bypasses the approval gate.

Run one sequence per app, from that app's directory, so `vercel pull` writes
`.vercel/project.json` for the matching project ID and `build`/`deploy` reuse
that same project context:

```bash
# Web project
(
  cd apps/web
  VERCEL_ORG_ID="$VERCEL_ORG_ID" \
  VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID_WEB" \
    vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
  vercel build --prod --token="$VERCEL_TOKEN"
  vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
)

# Admin project
(
  cd apps/admin
  VERCEL_ORG_ID="$VERCEL_ORG_ID" \
  VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID_ADMIN" \
    vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
  vercel build --prod --token="$VERCEL_TOKEN"
  vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
)
```

Keep each deployment URL/ID as a workflow output for rollback.

### Admin protection

Protection must cover **every URL that serves the admin app**, not just the
custom domain: the production domain, generated Vercel deployment URLs
(`<project>-<hash>.vercel.app`), and any aliases. It must cover admin UI pages
as well as `/api/*`. The PEM gate in `apps/admin/src/proxy.ts` only guards API
routes; UI pages pass through, so it is not a substitute for deployment
protection.

Options, in order:

1. **Vercel Authentication / Deployment Protection with "All Deployments"** — team SSO covering preview and production deployments, including generated URLs. Do not rely on Standard Protection alone: it leaves production deployments public.
2. **Cloudflare Access** in front of the admin custom domain **plus** Vercel protection for the generated `*.vercel.app` URLs — identity-aware proxy, Google/GitHub/OTP, closer to a VPN experience. Custom-hostname-only Access is insufficient because generated Vercel URLs bypass it.
3. **True VPN** — host `apps/admin` on a VM/container behind Tailscale/WireGuard, optionally with Cloudflare Tunnel. Vercel-only admin cannot be network-level private.

Whichever option is chosen, verify that both a UI page and an `/api/*` route
return the protection challenge when signed out. Check the admin app's auth
mode: its API uses PEM signatures, and the browser panel cannot sign requests
in PEM mode. If the operator needs the browser UI, protection alone may not
make it usable; that needs an admin session design or a self-hosted admin.

## 6. Supabase staging

- Create a new Supabase cloud project; do not reuse production.
- Region close to Vercel.
- Configure:
  - Site URL: `https://staging.<domain>`
  - Redirect URLs: staging web + admin URLs
  - **Disable signups**
  - Email confirmation policy for staging: SMTP sandbox or disabled confirmations; do not send real mail to fake addresses
- Apply migrations through CI:

```bash
supabase link --project-ref "$STAGING_SUPABASE_REF"
supabase db push --remote --yes
```

- Back up/snapshot before schema changes.
- Seed:
  - one ops/admin account
  - known test users/orgs
  - plan/feature baseline
- Use the transaction pooler for serverless DB connections if needed.
- Keep the service-role key server-only.

## 7. Registration disabled

Two layers:

1. **Supabase Auth:** disable signups in the staging project.
2. **App:** add/confirm an env flag, e.g. `ALLOW_REGISTRATION=false`, checked by the register route and UI. Do not rely on hidden UI only.

Verify:

- `/register` and `POST /api/v1/auth/register` reject.
- Admin invitations still work with signups disabled.
- Seeded test users can log in.
- No public path creates a user.

## 8. Stripe test mode

- **Prerequisite: real Stripe driver + signed webhook.** The app currently
  wires `stripeController` to `MockStripeService`
  (`packages/server/src/controllers/stripe.controller.ts`), and the webhook
  route authenticates the caller via `withAuth` and accepts
  `MockWebhookEventSchema`. Setting `PAYMENT_DRIVER=stripe` alone enables
  neither real checkout nor a secure webhook.
- Before staging exercises Stripe, implement the real driver and webhook: create
  sessions/prices with Stripe test keys, verify the `Stripe-Signature` header
  against the raw request body using `STRIPE_WEBHOOK_SECRET`, make the webhook
  route public (no user session) while keeping signature verification, and
  handle events idempotently.
- Test-mode secret key only; never `sk_live_`.
- Staging webhook endpoint:
  `https://staging.<domain>/api/v1/stripe/webhook`
- Vercel Deployment Protection also covers production deployments, so a webhook
  cannot reach the endpoint until protection is handled. Configure the Stripe
  endpoint URL with Vercel's documented automation bypass:
  `https://staging.<domain>/api/v1/stripe/webhook?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>`
  (keep the secret out of logs), or expose the webhook from an endpoint
  arrangement that is genuinely public. Signature verification with
  `STRIPE_WEBHOOK_SECRET` remains mandatory either way.
- Set `STRIPE_WEBHOOK_SECRET` from the staging endpoint or `stripe listen` (they differ).
- Run the idempotent bootstrap against the staging test account:
  - Products/Prices `studiq_<plan>_monthly`
  - portal configuration
  - `stripe_prices` rows in staging DB
- Success/cancel URLs point at staging.
- Use Stripe test cards; no real money.
- `PAYMENT_DRIVER=mock` stays the default in CI/QA; once the prerequisites above land, staging is the only place that exercises `stripe`.

## 9. Access for agents

- Staging web: public with registration disabled, or protected with a deployment-protection bypass token.
- If protected, pass the bypass via Playwright `extraHTTPHeaders` / `httpCredentials`; never publish the token.
- Agents use seeded test accounts and per-test tenants.
- Agents never use admin.
- Add a visible staging banner and `noindex`.

## 10. CI/CD

### GitHub Environment

Create `staging` (manual deploys) with:

- required reviewers
- environment-scoped secrets
- deployment branch policy: `main`

Create `staging-nightly` (scheduled deploys) with:

- no required reviewers, because the run is unattended
- the same environment-scoped secrets
- deployment branch policy: `main`
- referenced only by the schedule workflow, not by `workflow_dispatch`

### Pipeline

```text
checks / lint / typecheck
  → unit
  → integration
  → migrations (approval-gated)
  → build web + admin
  → deploy web
  → deploy admin
  → smoke tests
  → notify Discord
  → tag staging-YYYYMMDD-HHMMSS-<short-sha>
```

Use `concurrency` so only one staging deploy runs at a time.

### Manual deploy

`workflow_dispatch` with a `ref` input (default `main`), gated by the `staging` environment.

Do not trust the workflow run's `GITHUB_REF` as the deployment source. Resolve
the input to an exact SHA independently, reject it unless it is `main` or an
ancestor of `origin/main`, and check out that SHA for the deploy. The
`staging` environment reviewer gate stays in place.

### Nightly release

- Schedule `02:00 UTC`.
- Skip if `main` equals the last deployed SHA.
- Nightly runs are unattended: use the separate `staging-nightly` environment
  (same secrets and `main` branch policy, no required reviewers) rather than
  the reviewer-gated `staging` environment. This is a distinct controlled
  path, not an approval bypass for manual deploys.
- Run the same checks/build/deploy/smoke pipeline.
- Migrations stay approval-gated: a nightly run with pending migrations stops
  at the migration gate instead of applying them unattended.
- Tag the deployed commit; publish URL + commit + tag to Discord.

### Migrations

- Separate approval-gated job before app deploy.
- `supabase db push --remote --yes`.
- Backup/snapshot first.
- Never run a destructive reset as part of a normal nightly deploy.
- The nightly workflow never auto-approves this job; pending migrations block
  the nightly deploy until an operator approves them.

### Rollback

- Roll back production to the previous known-good Vercel deployment with
  `vercel rollback <deployment-id-or-url>` (or Dashboard → Instant Rollback),
  which re-aliases production without rebuilding.
- After the incident is resolved, restore normal promotion: confirm the next
  verified `main` deployment promotes to production as usual (or use Promote in
  the dashboard) and remove any manual rollback pin.
- Database migrations are forward-only; restore from backup if a migration must be reverted.
- Do not delete the Supabase project.

## 11. Smoke tests

After deploy:

- `GET /login` returns 200.
- seeded test user can log in.
- one authenticated API call.
- one Stripe test checkout or webhook replay.
- admin health check only from the protected path.
- report result to Discord with deployment URL and commit.

## 12. First three days

### Day 1

1. Create Vercel web + admin projects and domains.
2. Create Supabase staging project; apply migrations; seed users.
3. Disable Supabase signups + app registration.
4. Add Stripe test keys, webhook, bootstrap prices/portal.
5. Manual deploy web; verify login, invite and test checkout.
6. Protect admin with Vercel Authentication or Cloudflare Access.

### Day 2

1. Add `staging` GitHub environment with required reviewer.
2. Add manual deploy workflow + smoke tests.
3. Add Discord notifications.
4. Document env vars, test accounts, seed/reset commands.

### Day 3

1. Add nightly schedule/tag.
2. Give agents the staging URL, test accounts and rules.
3. Run one regression/QA pass against staging.
4. Decide whether the web app stays public or gets a bypass token.

## 13. Risks and gotchas

- **Vercel is not a VPN.** Use SSO/Access or self-host the admin.
- **Admin PEM + browser UI:** verify the admin app is usable behind the chosen protection.
- **Stripe webhook secret is endpoint-specific.**
- **Staging emails** can leak real mail; use sandbox SMTP or disable confirmations.
- **Shared staging data drifts.** Use test tenants and an explicit reset, not one shared account.
- **Never point staging at production Supabase or live Stripe keys.**
- **Staging is for `main`/nightly.** Branch testing needs previews + preview DB/Stripe, later.
- **Rate-limit public login**; add WAF/Cloudflare if staging is public.
- **Migrations are forward-only.** Back up before push.

## 14. Open questions

- Vercel plan: is Deployment Protection / Vercel Authentication available?
- Admin protection: Vercel SSO vs Cloudflare Access vs self-hosted VPN?
- Staging web: public or protected with bypass token?
- Staging email: SMTP sandbox or confirmations off?
- Data reset cadence: manual only, or scheduled with a snapshot?
- Stripe account: are `charges_enabled` / `details_submitted` true in test mode?
- Domain and DNS ownership.
- Who approves staging deploys and who receives nightly notifications?
- Nightly time and retention/tag policy.

## 15. Environment variable reference

```dotenv
# Web
NEXT_PUBLIC_SITE_URL=https://staging.<domain>
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PAYMENT_DRIVER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
ALLOW_REGISTRATION=false

# Admin
ADMIN_PEM_KEYS=...

# CI/CD
VERCEL_TOKEN=...
VERCEL_ORG_ID=...
VERCEL_PROJECT_ID_WEB=...
VERCEL_PROJECT_ID_ADMIN=...
VERCEL_AUTOMATION_BYPASS_SECRET=...   # only if the Stripe webhook URL uses the bypass
STAGING_SUPABASE_REF=...
SUPABASE_ACCESS_TOKEN=...
```
