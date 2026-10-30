import {
  type CatalogPlanForBootstrap,
  lookupKeyForPlan,
  selectBootstrapPrices,
} from '@studiq/server/lib/payment/stripe-bootstrap';
import { describe, expect, it } from 'vitest';

function plan(overrides: Partial<CatalogPlanForBootstrap> = {}): CatalogPlanForBootstrap {
  return {
    key: 'spark',
    name: 'StudiQ Spark',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    sortOrder: 4,
    ...overrides,
  };
}

describe('lookupKeyForPlan', () => {
  it('encodes the plan key and cycle', () => {
    expect(lookupKeyForPlan('spark')).toBe('studiq_spark_monthly');
    expect(lookupKeyForPlan('campus')).toBe('studiq_campus_monthly');
  });
});

describe('selectBootstrapPrices', () => {
  it('selects active paid plans in catalog order', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ key: 'pro', name: 'StudiQ Pro', priceMonthly: 4999, sortOrder: 10 }),
      plan({ key: 'spark', sortOrder: 4 }),
    ]);

    expect(errors).toEqual([]);
    expect(prices.map((price) => price.planKey)).toEqual(['spark', 'pro']);
    expect(prices[0]).toMatchObject({
      planKey: 'spark',
      productName: 'StudiQ Spark',
      lookupKey: 'studiq_spark_monthly',
      currency: 'pln',
      unitAmount: 999,
      interval: 'month',
      billingCycle: 'monthly',
    });
  });

  it('skips free and inactive plans', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ key: 'base', priceMonthly: 0, sortOrder: 1 }),
      plan({ key: 'old', isActive: false, sortOrder: 2 }),
      plan({ key: 'spark', sortOrder: 4 }),
    ]);

    expect(errors).toEqual([]);
    expect(prices.map((price) => price.planKey)).toEqual(['spark']);
  });

  it('defaults a missing currency to PLN and lowercases it for Stripe', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ currency: null }),
      plan({ key: 'ace', currency: 'pln', sortOrder: 7 }),
    ]);

    expect(errors).toEqual([]);
    expect(prices.map((price) => price.currency)).toEqual(['pln', 'pln']);
  });

  it('rejects a non-PLN plan', () => {
    const { prices, errors } = selectBootstrapPrices([plan({ currency: 'EUR' })]);

    expect(prices).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('currency must be PLN');
  });

  it('rejects an amount below the PLN minimum', () => {
    const { prices, errors } = selectBootstrapPrices([plan({ priceMonthly: 199 })]);

    expect(prices).toEqual([]);
    expect(errors[0]).toContain('below the PLN minimum');
  });

  it('rejects an invalid plan key and an empty name', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ key: 'Spark Plan' }),
      plan({ key: 'ace', name: '   ', sortOrder: 7 }),
    ]);

    expect(prices).toEqual([]);
    expect(errors).toEqual([
      'Spark Plan: key must match /^[a-z0-9_]+$/ so it can be used in a lookup key',
      'ace: name is empty',
    ]);
  });

  it('reports duplicate plan keys once', () => {
    const { errors } = selectBootstrapPrices([plan(), plan({ sortOrder: 5 })]);

    expect(errors).toEqual(['duplicate plan key "spark"']);
  });

  it('reports every catalog problem instead of stopping at the first', () => {
    const { errors } = selectBootstrapPrices([
      plan({ key: 'spark', currency: 'USD' }),
      plan({ key: 'ace', priceMonthly: 0, sortOrder: 7 }),
      plan({ key: 'pro', priceMonthly: 100, sortOrder: 10 }),
    ]);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('spark: currency must be PLN');
    expect(errors[1]).toContain('pro: amount 100 is below the PLN minimum');
  });
});
