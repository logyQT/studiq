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

  const ordered = [...plans].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (const plan of ordered) {
    if (seen.has(plan.key)) {
      errors.push(`duplicate plan key "${plan.key}"`);
      continue;
    }
    seen.add(plan.key);

    if (!plan.isActive) continue;

    const amount = plan.priceMonthly ?? 0;
    if (!Number.isInteger(amount) || amount <= 0) continue; // free tier

    let valid = true;
    const fail = (message: string) => {
      errors.push(`${plan.key}: ${message}`);
      valid = false;
    };

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
    if (amount < PLN_MIN_CHARGE_MINOR) {
      fail(
        `amount ${amount} is below the ${BOOTSTRAP_CURRENCY} minimum of ${PLN_MIN_CHARGE_MINOR} minor units`,
      );
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
