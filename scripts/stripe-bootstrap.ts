#!/usr/bin/env bun
/**
 * Idempotent Stripe sandbox bootstrap for #662.
 *
 *   bun scripts/stripe-bootstrap.ts --check   # catalog validation, no network
 *   bun scripts/stripe-bootstrap.ts           # create/update test-mode objects
 *   bun scripts/stripe-bootstrap.ts --live    # explicit live-mode run
 *
 * Creates one Product per paid plan, one monthly Price per plan keyed by
 * `studiq_<plan>_monthly`, writes the `stripe_prices` mapping and creates or
 * updates the StudiQ Billing Portal configuration.
 *
 * Secrets come from the environment (Bun loads the root `.env`). Never pass a
 * key on the command line: it would leak into shell history and process lists.
 */
import Stripe from 'stripe';
import {
  type BootstrapPrice,
  type CatalogPlanForBootstrap,
  selectBootstrapPrices,
} from '@studiq/server/lib/payment/stripe-bootstrap';
import { getSiteUrl } from '@studiq/server/lib/site-url';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/** Pinned in the design; the SDK ships the same literal in `ApiVersion`. */
const API_VERSION = '2026-10-28.endive';

class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BootstrapError(message);
}

interface Args {
  check: boolean;
  live: boolean;
}

function parseArgs(argv: string[]): Args {
  const known = new Set(['--check', '--live']);
  for (const arg of argv) {
    if (!known.has(arg))
      throw new BootstrapError(`unknown argument "${arg}" (expected --check or --live)`);
  }
  return { check: argv.includes('--check'), live: argv.includes('--live') };
}

function modeLabel(livemode: boolean): string {
  return livemode ? 'LIVE' : 'test';
}

function formatAmount(row: BootstrapPrice): string {
  const amount = (row.unitAmount / 100).toFixed(2);
  return `${amount} ${row.currency.toUpperCase()}`;
}

async function loadCatalog(): Promise<CatalogPlanForBootstrap[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('key, name, price_monthly, currency, is_active, sort_order')
    .order('sort_order', { ascending: true });

  assert(!error, `could not read subscription_plans: ${error?.message ?? 'unknown error'}`);

  return (data ?? []).map((plan) => ({
    key: plan.key as string,
    name: plan.name as string,
    priceMonthly: (plan.price_monthly as number | null) ?? 0,
    currency: (plan.currency as string | null) ?? null,
    isActive: Boolean(plan.is_active),
    sortOrder: (plan.sort_order as number | null) ?? 0,
  }));
}

function printCheck(prices: BootstrapPrice[]): void {
  console.log('\nPlanned Stripe catalog (no network calls):\n');
  console.table(
    prices.map((price) => ({
      plan: price.planKey,
      product: price.productName,
      amount: formatAmount(price),
      lookupKey: price.lookupKey,
    })),
  );
  console.log(
    `${prices.length} paid plan(s). Re-run without --check to create/update Products, Prices and the portal configuration.`,
  );
}

function priceMatches(price: Stripe.Price, row: BootstrapPrice, productId: string): boolean {
  return (
    price.active &&
    price.type === 'recurring' &&
    price.product === productId &&
    price.currency.toLowerCase() === row.currency &&
    price.unit_amount === row.unitAmount &&
    price.recurring?.interval === row.interval &&
    price.recurring?.interval_count === 1
  );
}

async function loadProducts(stripe: Stripe): Promise<Map<string, Stripe.Product>> {
  const cache = new Map<string, Stripe.Product>();
  for await (const product of stripe.products.list({ limit: 100, active: true })) {
    const planKey = product.metadata?.studiq_plan_key;
    if (planKey && !cache.has(planKey)) cache.set(planKey, product);
  }
  return cache;
}

async function ensureProduct(
  stripe: Stripe,
  row: BootstrapPrice,
  cache: Map<string, Stripe.Product>,
): Promise<{ product: Stripe.Product; created: boolean }> {
  const existing = cache.get(row.planKey);
  if (existing) {
    if (existing.name === row.productName) return { product: existing, created: false };

    const updated = await stripe.products.update(existing.id, { name: row.productName });
    cache.set(row.planKey, updated);
    return { product: updated, created: false };
  }

  const product = await stripe.products.create({
    name: row.productName,
    metadata: { studiq_plan_key: row.planKey },
  });
  cache.set(row.planKey, product);
  return { product, created: true };
}

async function ensurePrice(
  stripe: Stripe,
  row: BootstrapPrice,
  productId: string,
  livemode: boolean,
): Promise<{ price: Stripe.Price; created: boolean }> {
  const existing = await stripe.prices.list({
    lookup_keys: [row.lookupKey],
    active: true,
    limit: 1,
  });
  const current = existing.data[0];
  if (current && priceMatches(current, row, productId)) {
    return { price: current, created: false };
  }

  const price = await stripe.prices.create(
    {
      product: productId,
      currency: row.currency,
      unit_amount: row.unitAmount,
      recurring: { interval: row.interval },
      lookup_key: row.lookupKey,
      transfer_lookup_key: true,
      nickname: `${row.productName} — monthly`,
      metadata: {
        studiq_plan_key: row.planKey,
        studiq_billing_cycle: row.billingCycle,
      },
    },
    {
      idempotencyKey: `studiq-bootstrap-price:${livemode ? 'live' : 'test'}:${row.planKey}:${row.unitAmount}:${row.currency}:${current?.id ?? 'no-current-price'}`,
    },
  );

  return { price, created: true };
}

function portalParams(
  livemode: boolean,
  siteUrl: string,
): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    name: 'StudiQ',
    business_profile: {
      headline: 'StudiQ — zarządzanie rozliczeniami',
    },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'unused', 'other'],
        },
      },
      customer_update: {
        enabled: true,
        allowed_updates: ['email', 'address', 'name', 'tax_id'],
      },
    },
    default_return_url: `${siteUrl}/app/billing`,
    metadata: {
      studiq_managed: 'true',
      studiq_livemode: String(livemode),
    },
  };
}

async function ensurePortalConfiguration(
  stripe: Stripe,
  livemode: boolean,
  siteUrl: string,
): Promise<{ id: string; created: boolean }> {
  let existing: Stripe.BillingPortal.Configuration | undefined;
  for await (const configuration of stripe.billingPortal.configurations.list({ limit: 100 })) {
    if (
      configuration.active &&
      configuration.livemode === livemode &&
      (configuration.name === 'StudiQ' || configuration.metadata?.studiq_managed === 'true')
    ) {
      existing = configuration;
      break;
    }
  }

  if (existing) {
    const updated = await stripe.billingPortal.configurations.update(
      existing.id,
      portalParams(livemode, siteUrl) as Stripe.BillingPortal.ConfigurationUpdateParams,
    );
    return { id: updated.id, created: false };
  }

  const created = await stripe.billingPortal.configurations.create(portalParams(livemode, siteUrl));
  return { id: created.id, created: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  assert(secretKey, 'STRIPE_SECRET_KEY is required (root .env or environment)');
  assert(
    secretKey.startsWith('sk_test_') || secretKey.startsWith('sk_live_'),
    'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_',
  );

  const livemode = secretKey.startsWith('sk_live_');
  if (livemode && !args.live) {
    throw new BootstrapError('refusing a live key without --live');
  }

  const siteUrl = getSiteUrl();
  if (livemode) {
    assert(
      siteUrl.startsWith('https://'),
      'NEXT_PUBLIC_SITE_URL must start with https:// in live mode (the portal return URL cannot be localhost)',
    );
  }

  assert(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to write stripe_prices',
  );

  const plans = await loadCatalog();
  const { prices, errors } = selectBootstrapPrices(plans);

  if (errors.length > 0) {
    console.error('Catalog validation failed:');
    for (const error of errors) console.error(`  - ${error}`);
    throw new BootstrapError(`${errors.length} catalog problem(s); nothing was written`);
  }

  // A populated catalog may contain only free/inactive plans: that must reach
  // the stale-mapping cleanup so a plan that became free stops being sold.
  // An empty catalog means the seed did not run, so stop before writing.
  assert(plans.length > 0, 'no active paid plans found in subscription_plans');

  if (args.check) {
    printCheck(prices);
    return;
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  console.log(`Bootstrapping Stripe ${modeLabel(livemode)} mode against ${siteUrl}…\n`);

  const supabase = createServiceClient();
  const productCache = await loadProducts(stripe);
  let productsCreated = 0;
  let pricesCreated = 0;
  let pricesReused = 0;

  for (const row of prices) {
    const { product, created: productCreated } = await ensureProduct(stripe, row, productCache);
    if (productCreated) productsCreated += 1;

    const { price, created: priceCreated } = await ensurePrice(stripe, row, product.id, livemode);
    if (priceCreated) pricesCreated += 1;
    else pricesReused += 1;

    const { error } = await supabase.from('stripe_prices').upsert(
      {
        plan_key: row.planKey,
        billing_cycle: row.billingCycle,
        stripe_price_id: price.id,
        currency: row.currency.toUpperCase(),
        unit_amount: row.unitAmount,
        interval: row.interval,
        livemode,
        active: true,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'plan_key,billing_cycle,livemode' },
    );
    assert(!error, `stripe_prices upsert failed for ${row.planKey}: ${error?.message}`);

    console.log(
      `${row.planKey.padEnd(8)} ${formatAmount(row).padStart(10)}  ${row.lookupKey.padEnd(22)} ${price.id}${priceCreated ? ' (new)' : ''}`,
    );
  }

  const activePlans = new Set(prices.map((row) => row.planKey));
  const { data: mappedRows, error: mappedError } = await supabase
    .from('stripe_prices')
    .select('plan_key')
    .eq('livemode', livemode);
  assert(!mappedError, `could not read stripe_prices: ${mappedError?.message}`);

  const stalePlans = [
    ...new Set(
      (mappedRows ?? [])
        .map((row) => row.plan_key as string)
        .filter((planKey) => !activePlans.has(planKey)),
    ),
  ];

  if (stalePlans.length > 0) {
    const { error } = await supabase
      .from('stripe_prices')
      .update({ active: false })
      .eq('livemode', livemode)
      .in('plan_key', stalePlans);
    assert(!error, `could not deactivate stale prices: ${error?.message}`);
    console.log(`\nDeactivated ${stalePlans.length} stale mapping(s): ${stalePlans.join(', ')}`);
  }

  const portal = await ensurePortalConfiguration(stripe, livemode, siteUrl);

  console.log(
    `\nBootstrap complete (${modeLabel(livemode)}): ${prices.length} plans, ` +
      `${productsCreated} product(s) and ${pricesCreated} price(s) created, ` +
      `${pricesReused} price(s) reused.`,
  );
  console.log(`Portal configuration ${portal.created ? 'created' : 'updated'}: ${portal.id}`);
  console.log('\nAdd to .env:');
  console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${portal.id}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nStripe bootstrap failed: ${message}`);
  process.exit(1);
});
