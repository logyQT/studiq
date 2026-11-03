# Deployment

## Hosting

### Recommended Setup

| Component       | Platform         |
| --------------- | ---------------- |
| Frontend + API  | Vercel           |
| Database + Auth | Supabase (cloud) |

## Environment Variables

The following variables must be configured in production:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SITE_URL=https://your-domain.com

# Invitation e-mail (optional). Unset keeps the copyable invite link as the only delivery path.
# MAIL_DRIVER=smtp              # none (default) | smtp (the log driver only runs with NODE_ENV=development)
# MAIL_FROM=StudiQ <no-reply@your-domain.com>
# MAIL_SMTP_HOST=smtp.your-provider.com
# MAIL_SMTP_PORT=587            # 465 together with MAIL_SMTP_SECURE=true
# MAIL_SMTP_USER=...            # credentials only via the host's secret store, never in the repo
# MAIL_SMTP_PASS=...
#
# The mail settings are validated at boot (instrumentation.ts): a typo in any MAIL_* value stops the
# server instead of silently sending nothing, so check them in the deploy gate before switching on.
# Delivery is best effort: a failed send never fails the invitation, the copyable link stays.
# The 200 e-mails per organisation per hour limit is kept per process and resets on restart.

# LLM / AI Provider (optional — only if using AI features)
LLM_PROVIDER=openai
LLM_API_KEY=your-openai-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o-mini

# OpenTelemetry (optional) — OTLP trace/metric/log export.
# Exports to OTEL_EXPORTER_OTLP_ENDPOINT (default http://localhost:4318).
# Leave OTEL_SDK_DISABLED unset to keep telemetry on; set it to "true" to disable.
# OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com:4318
# OTEL_SDK_DISABLED=true
```

### Stripe (optional — test mode first)

`PAYMENT_DRIVER=mock` is the default and needs no Stripe configuration.
Switching to `stripe` requires **all** of the following; boot validation
(`parseStripeConfig`) refuses a partial or malformed configuration:

```env
PAYMENT_DRIVER=stripe
STRIPE_SECRET_KEY=sk_test_...          # sk_live_... only in production
STRIPE_WEBHOOK_SECRET=whsec_...        # per environment; stripe listen locally
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
# STRIPE_ALLOW_LIVE=1                  # explicit escape hatch, never for the sandbox
```

#### Bootstrap (once per Stripe mode)

```bash
bun scripts/stripe-bootstrap.ts --check   # validate the catalog, no network/writes
bun scripts/stripe-bootstrap.ts           # create/rotate products, prices, portal config
# prints STRIPE_PORTAL_CONFIGURATION_ID=bpc_…
```

The script is idempotent, refuses a live key unless `--live` is passed **and**
`NEXT_PUBLIC_SITE_URL` is an `https://` URL, never deletes a Stripe Price (it
rotates the lookup key), and writes the `stripe_prices` rows. Price ids live in
the database, never in git.

#### Local webhook forwarding

```bash
stripe login
stripe listen --forward-to localhost:$APP_PORT/api/v1/stripe/webhook \
  --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required
```

Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart the server.
The `stripe listen` secret is stable across restarts but **different** from a
Dashboard endpoint secret — a mismatch is the most common signature failure.
For preview/staging, create a Dashboard endpoint with the same event list and
store its secret in that environment. One endpoint per environment is the
default; sharing a staging endpoint across previews is an open decision (§12.1
Q9).

#### Portal configuration

The bootstrap creates the `StudiQ` Billing Portal configuration: payment-method
update, invoice history, cancel-at-period-end and tax-id update are enabled;
**plan switching is deliberately disabled**, because upgrades/downgrades go
through `/api/v1/billing/change-plan` (anchor reset / period-end schedule).
Put the returned `bpc_…` in `STRIPE_PORTAL_CONFIGURATION_ID`.

#### Livemode separation

- `livemode` is derived from the key prefix (`sk_live_`), stored on
  `billing_customers`/`billing_subscriptions`/`stripe_prices`/
  `stripe_webhook_events`, and filtered on every read. `payments` rows are
  mode-agnostic (the invoice id is unique within a mode).
- A live key outside `NODE_ENV=production` throws at boot unless
  `STRIPE_ALLOW_LIVE=1`.
- The webhook rejects an event from the other mode; the bootstrap refuses live
  without `--live` + production.
- Never mix test and live price ids in one `stripe_prices` row set.

#### Rollback

1. Set `PAYMENT_DRIVER=mock` and restart — new checkouts use the simulation.
   **Entitlement syncing stops with the driver flip**: in mock mode
   `/api/v1/stripe/webhook` is the authenticated mock branch, so real Stripe
   events get 401/400 and subscriptions freeze at their last known value.
2. Do **not** revert migrations or delete `billing_*`, `stripe_prices`,
   `stripe_webhook_events` or `payments` rows.
3. Keep `STRIPE_WEBHOOK_SECRET` valid and the Dashboard endpoint enabled while
   the driver is `stripe` (or flip back to `stripe` deliberately) until the last
   in-flight subscription is canceled.
4. Cancel a Stripe subscription in the Dashboard and let
   `customer.subscription.deleted` downgrade to free — with the driver back on
   `stripe` long enough to receive it. Never hand-edit
   `profiles.personal_plan_key` while the webhook is live.

#### Operational notes

- The reconcile endpoint has a **per-process** in-memory rate limit (20/min per
  user). A scaled-out deployment still needs a shared counter for a hard quota.
- Watch `billing.webhook_*`, `billing.duplicate_subscription`,
  `billing.price_unmapped`, `billing.payments_no_attributable_user` and
  `billing.reconcile_*` during a pilot.
- Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` declines,
  `4000 0000 0000 0341` attaches but fails the renewal charge (dunning).

### Vercel Configuration

1. Connect your GitHub repository to Vercel
2. Add environment variables in Vercel project settings
3. Set the build command to `bun run build`
4. Set the output directory to `.next`

### Supabase Configuration

1. Create a project at [supabase.com](https://supabase.com)
2. Run migrations: `bunx supabase db push`
3. Seed production data if needed
4. Configure auth settings:
   - Site URL
   - Redirect URLs
   - Email templates

## Production Considerations

- **HTTPS** — Vercel provides automatic HTTPS
- **Environment security** — never commit `.env.local` or service role keys
- **Email templates** — customize Supabase auth emails (confirmation, password reset, invite)
- **CORS** — configure if API is accessed from external domains
- **Rate limiting** — consider adding rate limits for public endpoints
- **Monitoring** — set up error tracking (Sentry, Vercel Analytics)

## Observability

The app exports OTLP (traces + metrics + logs) from `apps/web/src/instrumentation.ts`
to `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`). The local
Collector/Tempo/Loki/Prometheus/Grafana stack in `docker-compose.yml` is for
development only — in production point the endpoint at your own collector or a
managed backend (e.g. Grafana Cloud), or leave it unset and telemetry is simply
dropped harmlessly. See [observability-debugging.md](./observability-debugging.md).

## Build and Deploy

```bash
# Build locally
bun run build

# Start production server locally
bun start

# Deploy to Vercel (if CLI is installed)
vercel --prod
```

## Database Migrations

Push migrations to production Supabase:

```bash
bunx supabase db push
```

This applies any local migrations that haven't been applied to the remote database.
