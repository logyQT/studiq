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

### Environment posture (`APP_ENV`) and Stripe

`APP_ENV` is the deployment posture, **not** `NODE_ENV`: `next start` in QA and
e2e also runs with `NODE_ENV=production`. Production is the default when
`APP_ENV` is unset; every non-production environment must set it explicitly.

| `APP_ENV`                     | `PAYMENT_DRIVER`    | Result                                                                     |
| ----------------------------- | ------------------- | -------------------------------------------------------------------------- |
| unset → `production`          | unset → `stripe`    | boot error if the Stripe config is missing                                 |
| `production`                  | `stripe`            | only a live `sk_live_` / `rk_live_` key; `https://` non-localhost site URL |
| `production`                  | `mock`              | **boot error, no override**                                                |
| `production`                  | `stripe` + test key | **boot error** (`sk_test_` / `rk_test_` refused)                           |
| `development` / `test` / `qa` | unset → `mock`      | no Stripe configuration needed                                             |
| `development` / `test` / `qa` | `stripe` + test key | allowed                                                                    |
| `development` / `test` / `qa` | `stripe` + live key | error unless `STRIPE_ALLOW_LIVE=1` (deliberate live smoke test)            |

Production requires **all** of the following **before this release is
deployed**: the server refuses to start otherwise (hard cutover, no mock
fallback). Boot validation (`parseStripeConfig`) refuses a partial or malformed
configuration:

```env
APP_ENV=production
PAYMENT_DRIVER=stripe
STRIPE_SECRET_KEY=rk_live_...          # restricted key preferred; sk_live_ also accepted
STRIPE_WEBHOOK_SECRET=whsec_...        # per environment
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_PRODUCT_TAX_CODE=txcd_...            # eligible Managed Payments product code
STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1        # after checking the eligible label
NEXT_PUBLIC_SITE_URL=https://studiq.app  # https, non-localhost (APP_URL is the fallback)
```

Test mode for a local/preview deployment:

```env
APP_ENV=development
PAYMENT_DRIVER=stripe
STRIPE_SECRET_KEY=rk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
```

`bun run start` (and `bun dev:serve`) runs `scripts/payment-preflight.ts`
**before the port binds**, because `next start` does not exit on an
instrumentation rejection. `next build` needs no Stripe secret: the gateway is
constructed lazily on the first request, not at module import.

#### Bootstrap (once per Stripe mode)

```bash
# --check reads subscription_plans; it makes no Stripe calls and no writes.
bun scripts/stripe-bootstrap.ts --check
# Test-mode run (APP_ENV must be development/test/qa):
APP_ENV=development bun scripts/stripe-bootstrap.ts
# Live run (operator only, APP_ENV=production, --live):
bun scripts/stripe-bootstrap.ts --live
# prints STRIPE_PORTAL_CONFIGURATION_ID=bpc_…
```

The script accepts secret (`sk_`) and restricted (`rk_`) keys, derives live vs
test from the prefix, and ties the mode to the posture: production only runs a
live bootstrap (`--live`, `APP_ENV=production`, `https://` non-localhost site
URL), and development/test/QA only run a test-mode bootstrap. It never deletes a
Stripe Price (it rotates the lookup key) and writes the `stripe_prices` rows.
Price ids live in the database, never in git. Never run `--live` from a
developer machine; the production operator runs it in the production secret
environment.

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

#### Managed Payments (merchant of record)

Checkout sessions are created with `managed_payments: { enabled: true }`. Stripe
becomes the merchant of record: it calculates, withholds and remits indirect
tax, handles fraud/disputes and provides transaction support through Link.

- Enable Managed Payments in the Stripe Dashboard for each mode and accept its
  terms of service; the API call fails if the account is not eligible or the
  terms are not accepted. All checkouts fail until this is done.
- Managed Payments applies only to **new** subscriptions bought through a
  Managed Payments Checkout Session; existing subscriptions cannot be migrated.
  Re-run `stripe-bootstrap.ts --live` (which rotates the Prices to tax-inclusive
  `tax_behavior`) **before** deploying this release, or a legacy exclusive Price
  would keep being sold at price + VAT.
- Stripe **forbids** `automatic_tax` and `tax_id_collection` on a Managed
  Payments session. They are absent (not `false`).
- Set `STRIPE_PRODUCT_TAX_CODE` to an eligible product tax code and
  `STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1` after confirming it is labelled
  "Eligible for Managed Payments". Managed Payments handles tax
  rates/remittance, but the product classification is still required; the
  bootstrap refuses **any write run** without both (test mode included),
  verifies the code exists in Stripe, and then verifies the human confirmation.
  Stripe's API does not expose the eligibility flag, so the confirmation is
  explicit rather than inferred from `taxCodes.retrieve`.
- Prices are created with `tax_behavior: 'inclusive'`: the displayed PLN price
  is the final consumer price (operator decision). A legacy exclusive/
  unspecified Price is rotated by the bootstrap.
- Customers see Link as the seller ("Sold through Link"), receipts/invoices
  come from Link, and Adaptive Pricing may present local currencies. Our
  invoice-history rows still come from `invoice.paid`.
- The Billing Portal no longer collects tax IDs; Link/Managed Payments owns them.

#### Portal configuration

The bootstrap creates the `StudiQ` Billing Portal configuration: payment-method
update, invoice history, cancel-at-period-end and tax-id update are enabled;
**plan switching is deliberately disabled**, because upgrades/downgrades go
through `/api/v1/billing/change-plan` (anchor reset / period-end schedule).
Put the returned `bpc_…` in `STRIPE_PORTAL_CONFIGURATION_ID`.

#### Livemode separation

- `livemode` is derived from the key prefix (`sk_live_` / `rk_live_`), stored on
  `billing_customers`/`billing_subscriptions`/`stripe_prices`/
  `stripe_webhook_events`, and filtered on every read. `payments` rows are
  mode-agnostic (the invoice id is unique within a mode).
- Production rejects test keys at boot; a live key outside production throws
  unless `STRIPE_ALLOW_LIVE=1`.
- The webhook rejects an event from the other mode; the bootstrap refuses live
  without `--live` + an `https://` non-localhost site URL.
- Never mix test and live price ids in one `stripe_prices` row set.

#### Rollback (never to the mock)

Production **never** switches to the mock driver: `APP_ENV=production` +
`PAYMENT_DRIVER=mock` is a boot error and there is no override.

1. Roll back to the previous application release with the same valid Stripe
   configuration.
2. If new checkouts must stop, disable the checkout CTA or point `/checkout` at
   a maintenance page. That stops new sessions only; it must not change
   `PAYMENT_DRIVER` and must not stop the webhook endpoint. (A dedicated
   driver-independent kill switch is planned in #662 workstream E.)
3. Keep `STRIPE_WEBHOOK_SECRET` valid and the Dashboard endpoint enabled until
   the last in-flight subscription is canceled.
4. Do **not** revert migrations or delete `billing_*`, `stripe_prices`,
   `stripe_webhook_events` or `payments` rows. Never hand-edit
   `profiles.personal_plan_key` / `organizations.plan` while the webhook is live.

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
