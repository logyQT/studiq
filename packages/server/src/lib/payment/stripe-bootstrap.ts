/**
 * Pure catalog → Stripe Price planning for `scripts/stripe-bootstrap.ts`.
 *
 * Kept free of the Stripe SDK and Supabase so `--check` and unit tests never
 * touch the network: the script fetches the catalog, this module decides which
 * plans get a monthly Price and validates the values that would be charged.
 */

export const STRIPE_LOOKUP_KEY_PREFIX = 'studiq';

/** Monthly Price lookup key: `studiq_<plan_key>_monthly`. */
export const BOOTSTRAP_BILLING_CYCLE = 'monthly' as const;

/** Stripe's minimum charge for PLN is 2.00 (200 minor units). */
export const PLN_MIN_CHARGE_MINOR = 200;

/** The catalog and the sandbox are PLN-only (#662 D2). */
export const BOOTSTRAP_CURRENCY = 'PLN';

export interface CatalogPlanForBootstrap {
  key: string;
  name: string;
  priceMonthly: number | null;
  currency: string | null;
  isActive: boolean;
  sortOrder?: number | null;
}

export interface BootstrapPrice {
  planKey: string;
  productName: string;
  lookupKey: string;
  /** Lowercase ISO code, as Stripe expects. */
  currency: string;
  /** Minor units. */
  unitAmount: number;
  interval: 'month';
  billingCycle: typeof BOOTSTRAP_BILLING_CYCLE;
}

export interface BootstrapSelection {
  prices: BootstrapPrice[];
  errors: string[];
}

export function lookupKeyForPlan(planKey: string): string {
  return `${STRIPE_LOOKUP_KEY_PREFIX}_${planKey}_${BOOTSTRAP_BILLING_CYCLE}`;
}

/**
 * Selects active paid plans and validates them. Free plans are skipped (they
 * are not purchasable); inactive plans are skipped and their existing mapping
 * is deactivated by the script.
 */
export function selectBootstrapPrices(
  plans: readonly CatalogPlanForBootstrap[],
): BootstrapSelection {
  const errors: string[] = [];
  const prices: BootstrapPrice[] = [];
  const seen = new Set<string>();

  const ordered = [...plans].toSorted((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (const plan of ordered) {
    if (seen.has(plan.key)) {
      errors.push(`duplicate plan key "${plan.key}"`);
      continue;
    }
    seen.add(plan.key);

    if (!plan.isActive) continue;

    let valid = true;
    const fail = (message: string) => {
      errors.push(`${plan.key}: ${message}`);
      valid = false;
    };

    const amount = plan.priceMonthly ?? 0;
    if (amount === 0) continue; // free tier

    if (!Number.isInteger(amount)) {
      fail('amount must be an integer number of minor units');
    } else if (amount < 0) {
      fail('amount must not be negative');
    } else if (amount < PLN_MIN_CHARGE_MINOR) {
      fail(
        `amount ${amount} is below the ${BOOTSTRAP_CURRENCY} minimum of ${PLN_MIN_CHARGE_MINOR} minor units`,
      );
    }

    if (!/^[a-z0-9_]+$/.test(plan.key)) {
      fail('key must match /^[a-z0-9_]+$/ so it can be used in a lookup key');
    }
    if (!plan.name?.trim()) {
      fail('name is empty');
    }

    const currency = (plan.currency ?? BOOTSTRAP_CURRENCY).trim().toUpperCase();
    if (currency !== BOOTSTRAP_CURRENCY) {
      fail(`currency must be ${BOOTSTRAP_CURRENCY}, got "${plan.currency ?? ''}"`);
    }

    if (!valid) continue;

    prices.push({
      planKey: plan.key,
      productName: plan.name.trim(),
      lookupKey: lookupKeyForPlan(plan.key),
      currency: currency.toLowerCase(),
      unitAmount: amount,
      interval: 'month',
      billingCycle: BOOTSTRAP_BILLING_CYCLE,
    });
  }

  return { prices, errors };
}

// ── Managed Payments / tax policy ───────────────────────────────────────────
// Pure decisions used by the bootstrap script so they can be unit-tested
// without the Stripe network or a Supabase instance.

/** Prices are tax-inclusive: the PLN amount is the final consumer price. */
export const BOOTSTRAP_TAX_BEHAVIOR = 'inclusive' as const;

/** The operator supplies an eligible Managed Payments product tax code. */
const PRODUCT_TAX_CODE_PATTERN = /^txcd_[0-9]+$/;

/** Managed Payments owns tax IDs; the portal must not collect them. */
export const PORTAL_CUSTOMER_ALLOWED_UPDATES = ['email', 'address', 'name'] as const;

export function resolveProductTaxCode(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env.STRIPE_PRODUCT_TAX_CODE?.trim();
  if (!value) return null;
  if (!PRODUCT_TAX_CODE_PATTERN.test(value)) {
    throw new Error('STRIPE_PRODUCT_TAX_CODE must look like txcd_<digits>');
  }
  return value;
}

/**
 * Stripe's Tax Codes API does not expose the Managed Payments eligibility flag,
 * so existence cannot prove eligibility. A write run requires an explicit human
 * confirmation that the code is labelled "Eligible for Managed Payments".
 */
export function isProductTaxCodeConfirmed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.STRIPE_PRODUCT_TAX_CODE_CONFIRMED?.trim() === '1';
}

/** Minimal Price shape the comparison needs (avoids the SDK at runtime). */
export interface BootstrapStripePrice {
  active: boolean;
  type: string;
  /** The SDK may return the expanded Product object instead of its id. */
  product: string | { id: string };
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
  tax_behavior: string | null;
}

function objectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * A mapped Price can be reused only when it still matches the catalog and is
 * tax-inclusive. Any mismatch (including a legacy exclusive/unspecified Price)
 * rotates the lookup key to a new Price.
 */
export function priceMatches(
  price: BootstrapStripePrice,
  row: BootstrapPrice,
  productId: string,
): boolean {
  return (
    price.active &&
    price.type === 'recurring' &&
    objectId(price.product) === productId &&
    price.currency.toLowerCase() === row.currency &&
    price.unit_amount === row.unitAmount &&
    price.recurring?.interval === row.interval &&
    price.recurring?.interval_count === 1 &&
    price.tax_behavior === BOOTSTRAP_TAX_BEHAVIOR
  );
}

export interface BootstrapStripeProduct {
  name: string;
  /** The SDK returns a TaxCode object (or its id) once a code is assigned. */
  tax_code?: string | { id: string } | null;
}

/**
 * The Product fields that must change, or `null` for a no-op. A null tax code
 * never clears an existing classification.
 */
export function productUpdateFor(
  existing: BootstrapStripeProduct,
  row: BootstrapPrice,
  taxCode: string | null,
): { name?: string; tax_code?: string } | null {
  const needsName = existing.name !== row.productName;
  const needsTaxCode = Boolean(taxCode) && objectId(existing.tax_code) !== taxCode;
  if (!needsName && !needsTaxCode) return null;

  return {
    ...(needsName ? { name: row.productName } : {}),
    ...(needsTaxCode && taxCode ? { tax_code: taxCode } : {}),
  };
}

/**
 * The StudiQ Billing Portal configuration. Managed Payments is the merchant of
 * record and owns tax IDs, so `customer_update.allowed_updates` omits `tax_id`.
 * `subscription_update` is intentionally absent (#662 X5).
 */
export function portalParams(
  livemode: boolean,
  siteUrl: string,
): import('stripe').Stripe.BillingPortal.ConfigurationCreateParams {
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
        allowed_updates: [...PORTAL_CUSTOMER_ALLOWED_UPDATES],
      },
    },
    default_return_url: `${siteUrl}/app/billing`,
    metadata: {
      studiq_managed: 'true',
      studiq_livemode: String(livemode),
    },
  };
}
