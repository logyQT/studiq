/**
 * Pure checks for `scripts/stripe-preflight.ts` (#662 workstream E).
 *
 * Kept free of the Stripe SDK/Supabase so the decision table is unit-tested;
 * the script fetches the rows and prints the issues without ever printing key
 * material.
 */
export interface PreflightPlan {
  key: string;
  priceMonthly: number;
  currency: string;
  isActive: boolean;
}

export interface PreflightPriceRow {
  planKey: string;
  billingCycle: string;
  stripePriceId: string;
  currency: string;
  unitAmount: number;
  interval: string;
  livemode: boolean;
  active: boolean;
}

export interface PriceMapCheckInput {
  plans: readonly PreflightPlan[];
  rows: readonly PreflightPriceRow[];
  /** The gateway mode derived from the key prefix. */
  livemode: boolean;
  /** `APP_ENV=production` (stricter: no active test-mode mapping at all). */
  production: boolean;
}

/**
 * Every active paid plan must map to exactly one active monthly Price in the
 * gateway's mode, with the catalog amount and currency. In production no active
 * test-mode row may remain.
 */
export function validatePriceMap(input: PriceMapCheckInput): string[] {
  const issues: string[] = [];
  const paidPlans = input.plans.filter((plan) => plan.isActive && plan.priceMonthly > 0);
  const paidKeys = new Set(paidPlans.map((plan) => plan.key));

  if (paidPlans.length === 0) {
    issues.push('the catalog has no active paid plans; run the seed/catalog update first');
  }

  for (const plan of paidPlans) {
    // Prefer the row in the key's mode; fall back to the other mode only to
    // report the mode mismatch explicitly. (plan_key+billing_cycle+livemode is
    // the primary key, so there is at most one of each.)
    const monthly = input.rows.filter(
      (candidate) => candidate.planKey === plan.key && candidate.billingCycle === 'monthly',
    );
    const row = monthly.find((candidate) => candidate.livemode === input.livemode) ?? monthly[0];

    if (!row) {
      issues.push(`${plan.key}: no stripe_prices row for the monthly cycle`);
      continue;
    }
    if (!row.active) {
      issues.push(`${plan.key}: the monthly mapping is inactive`);
      continue;
    }
    if (row.livemode !== input.livemode) {
      issues.push(
        `${plan.key}: mapping livemode=${row.livemode} does not match the key mode ${input.livemode}`,
      );
      continue;
    }
    if (row.currency.toUpperCase() !== plan.currency.toUpperCase()) {
      issues.push(`${plan.key}: mapping currency ${row.currency} != catalog ${plan.currency}`);
    }
    if (row.unitAmount !== plan.priceMonthly) {
      issues.push(`${plan.key}: mapping amount ${row.unitAmount} != catalog ${plan.priceMonthly}`);
    }
    if (row.interval !== 'month') {
      issues.push(`${plan.key}: mapping interval ${row.interval} != month`);
    }
  }

  // A stale active row would let a removed/renamed plan be sold or mask a
  // mapping problem.
  for (const row of input.rows) {
    if (row.active && !paidKeys.has(row.planKey)) {
      issues.push(`${row.planKey}: active mapping has no active paid catalog plan`);
    }
  }

  if (input.production) {
    const activeTestRows = input.rows.filter((row) => row.active && !row.livemode);
    if (activeTestRows.length > 0) {
      issues.push(
        `${activeTestRows.length} active test-mode mapping(s) remain in production: ${[
          ...new Set(activeTestRows.map((row) => row.planKey)),
        ].join(', ')}`,
      );
    }
  }

  return issues;
}

export interface PreflightPortalConfiguration {
  active: boolean;
  livemode: boolean;
}

/** The portal configuration must be active and in the key's mode. */
export function validatePortalConfiguration(
  portal: PreflightPortalConfiguration,
  livemode: boolean,
): string[] {
  const issues: string[] = [];
  if (!portal.active) issues.push('the Billing Portal configuration is not active');
  if (portal.livemode !== livemode) {
    issues.push(
      `the Billing Portal configuration livemode=${portal.livemode} does not match the key mode ${livemode}`,
    );
  }
  return issues;
}
