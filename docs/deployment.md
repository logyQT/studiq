# Deployment

> Local development uses the [`env` tool](./plans/env-tool.md); hosted staging is specified in [`staging-environment.md`](./plans/staging-environment.md).

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
# Exports to OTEL_EXPORTER_OTLP_ENDPOINT. The SDK default is
# http://localhost:4318; the local env tool sets http://localhost:7318, which
# is where docker-compose.yml publishes the machine-wide collector.
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
NEXT_PUBLIC_SITE_URL=https://studiq.app  # https, non-localhost (APP_URL is the fallback)
```

Two further variables are **bootstrap-only** (the runtime boot validation does
not read them): `STRIPE_PRODUCT_TAX_CODE` and
`STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1`. The live bootstrap refuses without them.

Test mode for a local/preview deployment:

```env
APP_ENV=development
PAYMENT_DRIVER=stripe
STRIPE_SECRET_KEY=rk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
```

`bun run start` (and `bun run env:serve`) runs `scripts/payment-preflight.ts`
**before the port binds**, because `next start` does not exit on an
instrumentation rejection. `next build` needs no Stripe secret: the gateway is
constructed lazily on the first request, not at module import.

#### Bootstrap (once per Stripe mode)

```bash
# --check reads subscription_plans; it makes no Stripe calls and no writes.
bun scripts/stripe-bootstrap.ts --check
# Test-mode run (APP_ENV must be development/test/qa):
APP_ENV=development bun scripts/stripe-bootstrap.ts
# After ANY catalog price change, re-run the test-mode write (not just
# --check): stripe_prices must rotate to the new amount or Stripe checkout
# fails closed with SERVICE_UNAVAILABLE.
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
  `STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1` after confirming in the Dashboard
  (Products > Tax code) that it is labelled "Eligible for Managed Payments".
  Managed Payments handles tax rates/remittance, but the product classification
  is still required; the bootstrap refuses **any write run** without both (test
  mode included), verifies the code exists in Stripe, and then verifies the
  human confirmation. Stripe's API does not expose the eligibility label, so the
  confirmation cannot be inferred from `taxCodes.retrieve`.
- Prices are created with `tax_behavior: 'inclusive'`: the displayed PLN price
  is the final consumer price (operator decision). A legacy exclusive/
  unspecified Price is rotated by the bootstrap.
- Customers see Link as the seller ("Sold through Link"), receipts/invoices
  come from Link, and Adaptive Pricing may present local currencies. Our
  invoice-history rows still come from `invoice.paid`.
- The Billing Portal no longer collects tax IDs; Link/Managed Payments owns them.

#### Portal configuration

The bootstrap creates the `StudiQ` Billing Portal configuration: payment-method
update, invoice history and cancel-at-period-end are enabled (tax-ID collection
belongs to Managed Payments); **plan switching is deliberately disabled**,
because upgrades/downgrades go through `/api/v1/billing/change-plan` (anchor
reset / period-end schedule).
Put the returned `bpc_…` in `STRIPE_PORTAL_CONFIGURATION_ID`.

#### Team access and secrets

GitHub Actions repository variables, required checks and CI secrets are
documented in [CI](ci.md).

**Environment model**

- **Development:** each developer runs `stripe login`, creates their own sandbox
  (`stripe sandbox create "name"`), then mints a restricted key **inside that
  sandbox's Dashboard** (Developers → API keys → Create restricted key) and puts
  that `rk_test_…` in their local root `.env.local`. Do not use the `secret_key`
  printed by `stripe sandbox create` (it starts with `rkcs_test_`, which the
  app does not accept). Copy the restricted key straight into `.env.local`; never into
  chat, tickets or an agent transcript.
- Before the write run, set `STRIPE_PRODUCT_TAX_CODE` to an eligible `txcd_` code
  and `STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1`; confirm the code is labelled
  "Eligible for Managed Payments" in the Dashboard (Products > Tax code). Every
  bootstrap write run refuses without both, test mode included; `--check` and
  the runtime boot do not read them.
- Each sandbox has its own Products/Prices/portal configuration: run
  `APP_ENV=development PAYMENT_DRIVER=stripe bun scripts/stripe-bootstrap.ts`
  once per sandbox and use `stripe listen` for its webhook secret. Outside
  production an unset `PAYMENT_DRIVER` resolves to `mock`; set
  `PAYMENT_DRIVER=stripe` in `.env.local` when testing the real path.
- **Shared test-mode account:** only the repo's opt-in sandbox suite uses one
  provisioned catalog/portal. Its lifecycle cases replay signed events through
  the local webhook service, so they need no Dashboard webhook endpoint; the
  catalog/portal checks do need a bootstrap run in that account. Do not share
  personal test keys.
- **CI:** unit, integration, e2e and QA run with the mock driver and need no
  Stripe secret (`vitest.config.ts` forces `APP_ENV=test`,
  `PAYMENT_DRIVER=mock`). The opt-in sandbox suite is **not wired into CI
  today**; if it is ever enabled, run it only via manual/trusted-branch dispatch
  behind an `environment:` with reviewers, never on fork PRs.
- **Production:** the live `rk_live_` key exists only in the production secret
  store. No engineer keeps a copy, no key is shared, and it is rotated on
  offboarding or any suspected exposure.

**Restricted-key scopes**

Runtime (least privilege): Checkout Sessions (write), Billing Portal Sessions
(write), Billing Portal Configurations (**read** — only `stripe:preflight` reads
it), Customers (write), Subscriptions (write), Subscription Schedules (write),
Prices (read), Invoices (read). Receiving webhooks needs **no** Stripe API
scope: the signature is verified locally with `whsec_`.

The bootstrap (operator run) additionally needs Products (write), Prices
(write), Billing Portal Configurations (write) and Tax Codes (read). The same key
may carry both sets; if you use a separate bootstrap key, do not revoke the
runtime key. Review the key's access policy in the Dashboard.

**Rules**

- Never print, log, paste or commit a key, `whsec_` or `.env.local` file. `bpc_` and
  `price_` ids are not secrets, but they belong in env/DB, not git.
- Do not use a live key in dev/CI/QA; the only exception is a deliberate,
  supervised smoke test with `STRIPE_ALLOW_LIVE=1` outside production.
- Fork PRs get no repository/environment secrets from GitHub, run the full gate
  with the mock driver, and must never be able to reach Stripe.
- Offboarding: revoke the person's sandbox/team access, run `stripe logout
--all` on shared machines, rotate the personal key and any shared test key,
  delete CI secrets if they were ever added, and rotate `rk_live_` if there was
  any exposure.

#### Production live bootstrap (operator only)

Never run `--live` from a developer machine, never paste a key into a shell, and
never commit the output. Do this in the production secret environment after the
approved price ladder is in the production catalog.

This is a **hard cutover**: the app refuses to boot until the live Stripe
configuration exists, and Stripe-mode checkout fails closed while the catalog
and live Prices disagree. Run the whole sequence in one maintenance window. If a
live deployment already serves checkout (a re-run), disable the checkout CTA or
use a maintenance page **before step 0** and keep it disabled until step 3
passes.

Preconditions:

- Managed Payments is enabled in the **live** Dashboard and its terms are
  accepted; the chosen `STRIPE_PRODUCT_TAX_CODE` is labelled "Eligible for
  Managed Payments" and `STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1` is set.
- `APP_ENV=production`, `NEXT_PUBLIC_SITE_URL=https://…` and a live restricted
  key `rk_live_…` are available in the production secret store. Minimum scopes:
  Checkout Sessions (write), Billing Portal Sessions (write), Billing Portal
  Configurations (write), Customers (write), Subscriptions (write), Subscription
  Schedules (write), Products/Prices (write for the bootstrap, read for runtime),
  Tax Codes (read for the bootstrap), Invoices (read).
- The production database is reachable from the bootstrap environment:
  `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the script reads
  `subscription_plans` and writes `stripe_prices`).
- This release's migrations are applied to the production database **before**
  `--live` (it writes `stripe_prices`, which those migrations create). Deploying
  schema is separate from deploying the app binary.
- The production `subscription_plans` rows carry the approved ladder. The seed
  (`supabase/seeds/00_plans.sql`) is for a **new, empty** project only: it
  deletes and re-inserts the catalog and will hit FKs once accounts exist. For
  an existing catalog, run this UPDATE and confirm it returns exactly 9 rows:

  ```sql
  UPDATE public.subscription_plans AS p
  SET price_monthly = v.amount, updated_at = now()
  FROM (VALUES
    ('spark', 999), ('ace', 1999), ('pro', 3999),
    ('guide', 1999), ('creator', 3999), ('master', 7999),
    ('team', 9900), ('hub', 29900), ('campus', 69900)
  ) AS v(key, amount)
  WHERE p.key = v.key
  RETURNING p.key, p.price_monthly;
  ```

Steps:

0. Apply this release's migrations to the production database (for a Supabase
   project: `bunx supabase db push --remote --yes`), then run the catalog UPDATE
   above in the same window. Do not leave the catalog and the live Prices
   mismatched between steps.
1. `bun scripts/stripe-bootstrap.ts --check` in the production secret environment
   (read-only: it reads `subscription_plans` and makes no Stripe calls). Confirm
   the 9 amounts and the tax-code line. Any additional active paid plan (a
   legacy catalog row) must be deactivated first.
2. `bun scripts/stripe-bootstrap.ts --live`. It requires `--live`, a live
   `rk_live_`/`sk_live_` key, `APP_ENV=production`, an `https://` non-localhost
   site URL, `STRIPE_PRODUCT_TAX_CODE` and
   `STRIPE_PRODUCT_TAX_CODE_CONFIRMED=1`. It creates/rotates the StudiQ Products,
   tax-inclusive Prices and the portal configuration, and prints
   `STRIPE_PORTAL_CONFIGURATION_ID=bpc_…`.
3. Verify before deploying:
   - 9 active `stripe_prices` rows with `livemode = true` whose amounts match the
     catalog;
   - every StudiQ Product (`metadata.studiq_plan_key`) carries the tax code;
   - every Price referenced by those 9 rows has `tax_behavior = 'inclusive'`;
   - the printed portal configuration is active, `livemode`, and belongs to this
     account.
4. Create the live Dashboard webhook endpoint
   `https://<site>/api/v1/stripe/webhook` with
   `checkout.session.completed`, `checkout.session.expired`,
   `customer.subscription.created/updated/deleted`, `invoice.paid`,
   `invoice.payment_failed`, `invoice.payment_action_required`. Copy its
   `whsec_…` into the secret store (never into a shell log). With
   `STRIPE_WEBHOOK_SECRET` and the step-2
   `STRIPE_PORTAL_CONFIGURATION_ID` set in the preflight environment,
   `bun run stripe:preflight` must exit 0 (it only checks the `whsec_` shape,
   not whether the secret is correct).
5. Put the runtime variables (`APP_ENV=production`, `PAYMENT_DRIVER=stripe` or
   unset, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PORTAL_CONFIGURATION_ID`, the site URL) into the production secret
   store, then deploy. The two tax-code variables are bootstrap-only and are not
   read at runtime. On the container/VM path `bun run start` runs the payment
   preflight and must print `provider=stripe livemode=true`; on Vercel (which
   does not use root `start`) verify `payment.gateway_ready` in the configured
   OTLP log backend, or in Vercel Runtime Logs when `OTEL_SDK_DISABLED=true`
   (the deployment/build log is not the runtime log source).
6. If a key or the webhook secret is ever exposed, rotate it in the Dashboard and
   restart; never reuse a leaked value.

Rollback is **not** a driver flip: roll back the release, disable the checkout
CTA/maintenance-page if needed, and keep the webhook endpoint and
`STRIPE_WEBHOOK_SECRET` valid while any active subscription or pending delivery
still depends on them (a release rollback does not cancel subscriptions). The
rollback target must be a **Stripe-capable** release — production `stripe`
driver, signature-verified webhook and the fenced entitlement writer. Never roll
back to a pre-Stripe/mock-only binary after live subscriptions exist: blocking
checkout does not stop that binary's mock-completion webhook command.

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

1. Stop **new checkout sessions server-side** before rolling back: set
   `CHECKOUT_KILL_SWITCH=1` on a release that supports it, or block
   `POST /api/v1/stripe/create-checkout-session` at the edge/maintenance page if
   the rollback target predates the switch. Disabling only the CTA or
   `/checkout` page does not stop an already-open client. This must not change
   `PAYMENT_DRIVER` and must not stop the webhook endpoint.
2. Roll back to a **Stripe-capable** application release — the rollback floor —
   with the same valid Stripe configuration. A pre-Stripe/mock-only base is not
   a recovery target after live subscriptions exist: it requires a user session
   on `/api/v1/stripe/webhook`, treats that call as mock completion, and has no
   production mock boot guard.
3. If no Stripe-capable predecessor exists, do **not** roll back the process
   that owns the webhook. Preserve this release's billing processor (or run the
   webhook handler independently of the rolled-back app) and roll back only
   unrelated changes.
4. Verify the rollback target consumes Stripe events: a signed test event is
   accepted, `provider=stripe livemode=true` is reported, and a cancellation
   still downgrades.
5. Keep `STRIPE_WEBHOOK_SECRET` valid and the Dashboard endpoint enabled while
   any active subscription or pending delivery still depends on them.
6. Do **not** revert migrations or delete `billing_*`, `stripe_prices`,
   `stripe_webhook_events` or `payments` rows. Never hand-edit
   `profiles.personal_plan_key` / `organizations.plan` while the webhook is live.

#### Preflight, kill switch, alerting and rotation

**Preflight (read-only).** `bun run stripe:preflight` validates the posture and
the live configuration without creating anything or printing a key:

- key prefix/mode, webhook-secret presence/shape and the production site URL
  (through the factory);
- the Billing Portal configuration exists, is active and is in the key's mode;
- every active paid plan has one active monthly `stripe_prices` row with the
  catalog amount/currency, in the key's mode;
- production (or any live key) has no active test-mode mapping.

It reads `subscription_plans`/`stripe_prices` with the production
service-role credentials. With `PAYMENT_DRIVER=mock` it refuses unless
`--allow-mock` is passed (a local smoke), because a deploy must see
`provider=stripe`. It exits 1 on any issue, so a deploy step can gate on it. Run
it after the live bootstrap + webhook secret and before enabling the release,
and on demand during an incident.

Three different checks, different jobs:

| Command                                               | When                     | Network           | Proves                                                                      |
| ----------------------------------------------------- | ------------------------ | ----------------- | --------------------------------------------------------------------------- |
| `scripts/payment-preflight.ts` (automatic in `start`) | every app start          | no                | `APP_ENV`/driver/key/site-URL contract, `provider`/`livemode`               |
| `stripe-bootstrap.ts --check`                         | before a bootstrap write | DB only           | the catalog plans/amounts the bootstrap would create                        |
| `stripe-preflight.ts`                                 | before enabling a deploy | DB + Stripe reads | portal config, catalog ↔ `stripe_prices` parity, no test rows in production |

**Kill switch.** `CHECKOUT_KILL_SWITCH=1` (any positive value: `1`, `true`,
`yes`, `on`) makes `POST /api/v1/stripe/create-checkout-session` return
`SERVICE_UNAVAILABLE` and logs `billing.checkout_disabled`. It stops **new**
sessions only: webhooks, the Billing Portal and change/cancel keep working, and
the payment driver is untouched. It is read from `process.env` per request, so
set the variable and restart/redeploy to apply it.

**Rate limits.** Checkout creation, change-plan, cancel and
release-scheduled-plan each have their own per-process, per-user bucket
(10/min each, so 40/min combined); reconcile has 20/min. A scaled-out
deployment still needs a shared counter for a hard quota.

**Alert on** (Loki/Grafana; records carry `trace_id` when OTel is enabled):

| Event                                   | Meaning                                | First action                                                             |
| --------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `billing.webhook_failed`                | handler raised; Stripe retries         | inspect the logged `eventId`, `type`, `message`, then replay after a fix |
| `billing.webhook_signature_invalid`     | wrong/rotated `whsec_`                 | compare the Dashboard endpoint secret, rotate env                        |
| `billing.webhook_livemode_mismatch`     | test event in live (or vice versa)     | check the endpoint/key pairing, no writes happened                       |
| `billing.duplicate_subscription`        | second checkout for an active owner    | refund/cancel in Stripe; verify the active mirror                        |
| `billing.price_unmapped`                | a live Price is not in `stripe_prices` | re-run `stripe:preflight`; fix the mapping                               |
| `billing.price_mismatch`                | catalog ≠ mapped Price                 | re-run the bootstrap (test/live) before enabling checkout                |
| `billing.payments_no_attributable_user` | org invoice without a payer profile    | check old admin left; history row skipped, entitlement applied           |
| `billing.reconcile_*`                   | success-page reconcile errors          | webhook remains authoritative; investigate Stripe reads                  |
| `billing.managed_payments_unavailable`  | MP/tax-code account misconfiguration   | enable MP/accept terms/set the tax code; checkout is 503                 |
| `billing.checkout_disabled`             | kill switch is on                      | expected during an incident; confirm before re-enabling                  |

**Rotation / incident response.** Never print, paste, log or commit a key.

- **Restricted key rotation:** create the new `rk_live_` in the Dashboard, put it
  in the production secret store, redeploy (or restart), verify
  `stripe:preflight` and a test checkout, then revoke the old key. Do not rotate
  and change the price catalog in the same step.
- **Webhook secret rotation:** create/rotate the endpoint secret in the
  Dashboard, update `STRIPE_WEBHOOK_SECRET`, redeploy, and confirm a test event
  is accepted. There is one app-side secret; retire the **old Dashboard
  endpoint** once the new one is live. Stripe retries failed deliveries for up
  to 3 days; events replay safely through the idempotency table.
- **Emergency stop:** set `CHECKOUT_KILL_SWITCH=1` (server-side, blocks the
  checkout API even for an open client; on a pre-switch release block the route
  at the edge), keep the webhook endpoint and secret valid, then roll back the
  release only to a Stripe-capable floor (see [Rollback](#rollback-never-to-the-mock)).
  Never route production to `mock`, never hand-edit entitlements, never delete
  `billing_*` / `stripe_prices` / `stripe_webhook_events` / `payments` rows.
- **Test cards:** `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002`
  declines, `4000 0000 0000 0341` attaches but fails the renewal charge
  (dunning).

### Vercel Configuration

1. Connect your GitHub repository to Vercel
2. Add environment variables in Vercel project settings
3. Set the build command to `bun run build`
4. Set the output directory to `.next`

### Supabase Configuration

1. Create a project at [supabase.com](https://supabase.com)
2. Link the checkout: `bunx supabase link --project-ref <ref>`
3. Run migrations: `bunx supabase db push --remote --yes`
4. Seed production data if needed
5. Configure auth settings:
   - Site URL
   - Redirect URLs
   - Email templates

## Billing endpoints

Every route below is wrapped in `withAuth()` (the proxy skips `/api/*`).
`POST /api/v1/stripe/webhook` is the only public one, and only in `stripe` mode,
where the `stripe-signature` header is verified over the raw body; in `mock` mode
it authenticates the caller and acts on that caller's own account only.

The billing **owner is the authenticated user** (`ctx.userId`) for personal plans
and the **active organization** (`ctx.activeOrgId`) for organization plans — with
one exception: `create-checkout-session` accepts an `orgId`, because a manager can
buy for a non-active organization. That id is only a hint; the server re-checks
`org_members` and the `admin` role before using it. The client never supplies a
customer id, subscription id, price id or amount.

| Method | Endpoint                                 | Body                           | Notes                                                                                                                                                          |
| ------ | ---------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/billing/subscription`           | —                              | Shared read model: effective plan, billed plan, status, period, cancel/pending flags, portal/change/cancel capability, invoice URL                             |
| `POST` | `/api/v1/stripe/create-checkout-session` | `{ planKey, orgId?, locale? }` | Returns `{ url }`: hosted Stripe Checkout, or the local mock form. `orgId` is required for manager plans and must be a uuid                                    |
| `GET`  | `/api/v1/stripe/portal?locale=pl\|en`    | —                              | Returns `{ url }` for the hosted Billing Portal; `404` when the owner has no Stripe customer mapping                                                           |
| `POST` | `/api/v1/billing/change-plan`            | `{ planKey }`                  | Upgrade applies now (anchor reset + unused-time credit); downgrade schedules at the period boundary. No entitlement write                                      |
| `POST` | `/api/v1/billing/cancel`                 | `{ cancel: boolean }`          | `true` = cancel at period end, `false` = reactivate. No entitlement write                                                                                      |
| `POST` | `/api/v1/billing/release-scheduled-plan` | —                              | “Keep current plan”: releases a scheduled downgrade and clears the display marker. No entitlement write; returns `{ released: false }` when no schedule exists |
| `POST` | `/api/v1/billing/reconcile`              | `{ sessionId }`                | Success-page reconcile: verifies session ownership, reuses the idempotent activation path, activate-only                                                       |
| `POST` | `/api/v1/stripe/webhook`                 | raw Stripe event               | `stripe` mode: public + signature-verified. `mock` mode: `withAuth`, caller's own account only                                                                 |

### Billing read model

```jsonc
{
  "provider": "mock | stripe",
  "planKey": "spark", // effective entitlement (/me/plan); may be a seat plan
  "planName": "StudiQ Spark",
  "billedPlanKey": "spark", // what Stripe actually bills
  "billedPlanName": "StudiQ Spark",
  "entitlementAppliedPlanKey": "spark", // written by the fenced webhook; null until it runs
  "status": "active | trialing | past_due | unpaid | canceled | incomplete | incomplete_expired | paused | free | none",
  "currentPeriodEnd": "2026-12-01T00:00:00.000Z",
  "cancelAtPeriodEnd": false,
  "pendingPlanKey": null, // display-only marker for a scheduled downgrade
  "priceMonthly": 999, // minor units
  "currency": "PLN",
  "canManagePortal": true,
  "canChangePlan": true,
  "canCancel": true,
  "hostedInvoiceUrl": "https://invoice.stripe.com/…", // owner-scoped, signed
}
```

The response is `Cache-Control: private, no-store` because the invoice URL is
signed.

### Billing errors

| Code                   | When                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `BAD_REQUEST`          | Free plan, unknown plan/cadence, missing org id, change to the current plan                                  |
| `UNAUTHORIZED`         | No session (every route except the Stripe webhook)                                                           |
| `FORBIDDEN`            | Wrong plan family, non-admin org caller, foreign checkout session                                            |
| `NOT_FOUND`            | No active subscription/customer mapping (mock driver returns this for provider actions)                      |
| `CONFLICT`             | Owner already has an active subscription, or the live Stripe price no longer matches the mirror              |
| `UNPROCESSABLE_ENTITY` | Invalid body (e.g. missing `planKey`, non-uuid `orgId`)                                                      |
| `RATE_LIMITED`         | Stripe rate-limited a provider call (429)                                                                    |
| `SERVICE_UNAVAILABLE`  | Checkout kill switch, Managed Payments misconfiguration, missing/mismatched `stripe_prices`, provider outage |

Entitlements (`organizations.plan`, `profiles.personal_plan_key`) are written
**only** by `EntitlementService`, on the fenced path used by webhook activation
and `POST /api/v1/billing/reconcile`.

## Production Considerations

- **HTTPS** — Vercel provides automatic HTTPS
- **Environment security** — never commit `.env.local` or service role keys
- **Email templates** — customize Supabase auth emails (confirmation, password reset, invite)
- **CORS** — configure if API is accessed from external domains
- **Rate limiting** — consider adding rate limits for public endpoints
- **Monitoring** — set up error tracking (Sentry, Vercel Analytics)

## Observability

The app exports OTLP (traces + metrics + logs) from `apps/web/src/instrumentation.ts`
to `OTEL_EXPORTER_OTLP_ENDPOINT` (SDK default `http://localhost:4318`; the local
env tool sets `http://localhost:7318`). The local
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

Push migrations to production Supabase (CLI v3: local is the default target, so
hosted commands need `--remote`, and unattended runs need `--yes`):

```bash
bunx supabase db push --remote --yes
```

This applies any local migrations that haven't been applied to the remote database.

## Staging

The persistent staging environment is specified separately in
[`plans/staging-environment.md`](./plans/staging-environment.md). It covers:

- Vercel web + admin projects and domains
- separate Supabase staging project and migrations
- registration disabled
- Stripe test mode and staging webhook
- admin is **not deployed**; `apps/admin` has no app-level auth and deployment is blocked by the ordered items in [ADR-0009](./decisions/0009-admin-is-internal-not-deployed.md)
- manual deploy gate + nightly `main` deploys

Staging is not production and must never use production Supabase or live Stripe keys.
