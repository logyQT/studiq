import {
  type PreflightPlan,
  type PreflightPriceRow,
  validatePortalConfiguration,
  validatePriceMap,
} from '@studiq/server/lib/payment/stripe-preflight';
import { describe, expect, it } from 'vitest';

const plans: PreflightPlan[] = [
  { key: 'spark', priceMonthly: 999, currency: 'PLN', isActive: true },
  { key: 'hub', priceMonthly: 29900, currency: 'PLN', isActive: true },
  { key: 'base', priceMonthly: 0, currency: 'PLN', isActive: true },
];

function row(overrides: Partial<PreflightPriceRow> = {}): PreflightPriceRow {
  return {
    planKey: 'spark',
    billingCycle: 'monthly',
    stripePriceId: 'price_spark',
    currency: 'PLN',
    unitAmount: 999,
    interval: 'month',
    livemode: true,
    active: true,
    ...overrides,
  };
}

const hubRow = row({
  planKey: 'hub',
  stripePriceId: 'price_hub',
  unitAmount: 29900,
});

describe('validatePriceMap', () => {
  it('accepts a complete live mapping and ignores free plans', () => {
    expect(
      validatePriceMap({
        plans,
        rows: [row(), hubRow],
        livemode: true,
        production: true,
      }),
    ).toEqual([]);
  });

  it('reports a missing monthly mapping', () => {
    expect(validatePriceMap({ plans, rows: [row()], livemode: true, production: false })).toEqual([
      'hub: no stripe_prices row for the monthly cycle',
    ]);
  });

  it('reports an inactive mapping', () => {
    expect(
      validatePriceMap({
        plans,
        rows: [row(), { ...hubRow, active: false }],
        livemode: true,
        production: false,
      }),
    ).toEqual(['hub: the monthly mapping is inactive']);
  });

  it('reports amount, currency and interval drift', () => {
    const issues = validatePriceMap({
      plans,
      rows: [row(), { ...hubRow, unitAmount: 1999, currency: 'EUR', interval: 'year' }],
      livemode: true,
      production: false,
    });

    expect(issues).toEqual([
      'hub: mapping currency EUR != catalog PLN',
      'hub: mapping amount 1999 != catalog 29900',
      'hub: mapping interval year != month',
    ]);
  });

  it('reports a mapping in the wrong mode', () => {
    expect(
      validatePriceMap({
        plans,
        rows: [row(), { ...hubRow, livemode: false }],
        livemode: true,
        production: false,
      }),
    ).toEqual(['hub: mapping livemode=false does not match the key mode true']);
  });

  it('reports stale active rows for plans outside the paid catalog', () => {
    expect(
      validatePriceMap({
        plans,
        rows: [row(), hubRow, row({ planKey: 'legacy', stripePriceId: 'price_legacy' })],
        livemode: true,
        production: false,
      }),
    ).toEqual(['legacy: active mapping has no active paid catalog plan']);
  });

  it('refuses active test-mode rows in production', () => {
    expect(
      validatePriceMap({
        plans,
        rows: [
          row(),
          hubRow,
          row({
            planKey: 'hub',
            billingCycle: 'yearly',
            livemode: false,
            unitAmount: 29900,
          }),
        ],
        livemode: true,
        production: true,
      }),
    ).toEqual(['1 active test-mode mapping(s) remain in production: hub']);
  });

  it('reports an empty paid catalog', () => {
    expect(
      validatePriceMap({
        plans: [plans[2]],
        rows: [],
        livemode: true,
        production: false,
      }),
    ).toEqual(['the catalog has no active paid plans; run the seed/catalog update first']);
  });
});

describe('validatePortalConfiguration', () => {
  it('accepts an active configuration in the key mode', () => {
    expect(validatePortalConfiguration({ active: true, livemode: true }, true)).toEqual([]);
  });

  it('reports an inactive configuration', () => {
    expect(validatePortalConfiguration({ active: false, livemode: true }, true)).toEqual([
      'the Billing Portal configuration is not active',
    ]);
  });

  it('reports a mode mismatch', () => {
    expect(validatePortalConfiguration({ active: true, livemode: false }, true)).toEqual([
      'the Billing Portal configuration livemode=false does not match the key mode true',
    ]);
  });
});
