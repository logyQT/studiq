import {
  BOOTSTRAP_TAX_BEHAVIOR,
  type BootstrapStripePrice,
  type CatalogPlanForBootstrap,
  isProductTaxCodeConfirmed,
  lookupKeyForPlan,
  portalParams,
  priceMatches,
  productUpdateFor,
  resolveProductTaxCode,
  selectBootstrapPrices,
} from '@studiq/server/lib/payment/stripe-bootstrap';
import { describe, expect, it } from 'vitest';

function plan(overrides: Partial<CatalogPlanForBootstrap> = {}): CatalogPlanForBootstrap {
  return {
    key: 'plus',
    name: 'StudiQ Plus',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    sortOrder: 4,
    ...overrides,
  };
}

describe('lookupKeyForPlan', () => {
  it('encodes the plan key and cycle', () => {
    expect(lookupKeyForPlan('plus')).toBe('studiq_plus_monthly');
    expect(lookupKeyForPlan('campus')).toBe('studiq_campus_monthly');
  });
});

describe('selectBootstrapPrices', () => {
  it('selects active paid plans in catalog order', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ key: 'max', name: 'StudiQ Max', priceMonthly: 4999, sortOrder: 10 }),
      plan({ key: 'plus', sortOrder: 4 }),
    ]);

    expect(errors).toEqual([]);
    expect(prices.map((price) => price.planKey)).toEqual(['plus', 'max']);
    expect(prices[0]).toMatchObject({
      planKey: 'plus',
      productName: 'StudiQ Plus',
      lookupKey: 'studiq_plus_monthly',
      currency: 'pln',
      unitAmount: 999,
      interval: 'month',
      billingCycle: 'monthly',
    });
  });

  it('skips free and inactive plans', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ key: 'free', priceMonthly: 0, sortOrder: 1 }),
      plan({ key: 'old', isActive: false, sortOrder: 2 }),
      plan({ key: 'plus', sortOrder: 4 }),
    ]);

    expect(errors).toEqual([]);
    expect(prices.map((price) => price.planKey)).toEqual(['plus']);
  });

  it('defaults a missing currency to PLN and lowercases it for Stripe', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ currency: null }),
      plan({ key: 'pro', currency: 'pln', sortOrder: 7 }),
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

  it('rejects a negative amount instead of treating it as a free tier', () => {
    const { prices, errors } = selectBootstrapPrices([plan({ priceMonthly: -100 })]);

    expect(prices).toEqual([]);
    expect(errors).toEqual(['plus: amount must not be negative']);
  });

  it('rejects a non-integer amount', () => {
    const { prices, errors } = selectBootstrapPrices([plan({ priceMonthly: 999.5 })]);

    expect(prices).toEqual([]);
    expect(errors).toEqual(['plus: amount must be an integer number of minor units']);
  });

  it('rejects an invalid plan key and an empty name', () => {
    const { prices, errors } = selectBootstrapPrices([
      plan({ key: 'Plus Plan' }),
      plan({ key: 'pro', name: '   ', sortOrder: 7 }),
    ]);

    expect(prices).toEqual([]);
    expect(errors).toEqual([
      'Plus Plan: key must match /^[a-z0-9_]+$/ so it can be used in a lookup key',
      'pro: name is empty',
    ]);
  });

  it('reports duplicate plan keys once', () => {
    const { errors } = selectBootstrapPrices([plan(), plan({ sortOrder: 5 })]);

    expect(errors).toEqual(['duplicate plan key "plus"']);
  });

  it('reports every catalog problem instead of stopping at the first', () => {
    const { errors } = selectBootstrapPrices([
      plan({ key: 'plus', currency: 'USD' }),
      plan({ key: 'pro', priceMonthly: 0, sortOrder: 7 }),
      plan({ key: 'max', priceMonthly: 100, sortOrder: 10 }),
    ]);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('plus: currency must be PLN');
    expect(errors[1]).toContain('max: amount 100 is below the PLN minimum');
  });
});

const bootstrapPrice = {
  planKey: 'plus',
  productName: 'StudiQ Plus',
  lookupKey: 'studiq_plus_monthly',
  currency: 'pln',
  unitAmount: 999,
  interval: 'month' as const,
  billingCycle: 'monthly' as const,
};

function stripePrice(overrides: Partial<BootstrapStripePrice> = {}): BootstrapStripePrice {
  return {
    active: true,
    type: 'recurring',
    product: 'prod_1',
    currency: 'pln',
    unit_amount: 999,
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: BOOTSTRAP_TAX_BEHAVIOR,
    ...overrides,
  };
}

describe('priceMatches', () => {
  it('reuses a matching tax-inclusive monthly Price', () => {
    expect(priceMatches(stripePrice(), bootstrapPrice, 'prod_1')).toBe(true);
  });

  it.each(['exclusive', 'unspecified', null])(
    'rotates a Price whose tax behavior is %s',
    (tax_behavior) => {
      expect(priceMatches(stripePrice({ tax_behavior }), bootstrapPrice, 'prod_1')).toBe(false);
    },
  );

  it.each([
    ['inactive', { active: false }],
    ['one-time', { type: 'one_time' }],
    ['another product', { product: 'prod_2' }],
    ['another currency', { currency: 'eur' }],
    ['another amount', { unit_amount: 1999 }],
    ['another interval', { recurring: { interval: 'year', interval_count: 1 } }],
  ])('rotates on %s', (_label, overrides) => {
    expect(
      priceMatches(
        stripePrice(overrides as Partial<BootstrapStripePrice>),
        bootstrapPrice,
        'prod_1',
      ),
    ).toBe(false);
  });
});

describe('productUpdateFor', () => {
  it('returns null when the name and tax code already match', () => {
    expect(
      productUpdateFor({ name: 'StudiQ Plus', tax_code: 'txcd_123' }, bootstrapPrice, 'txcd_123'),
    ).toBeNull();
  });

  it('updates only the name when the tax code matches', () => {
    expect(
      productUpdateFor({ name: 'Old', tax_code: 'txcd_123' }, bootstrapPrice, 'txcd_123'),
    ).toEqual({ name: 'StudiQ Plus' });
  });

  it('adds the tax code without renaming', () => {
    expect(
      productUpdateFor({ name: 'StudiQ Plus', tax_code: null }, bootstrapPrice, 'txcd_123'),
    ).toEqual({ tax_code: 'txcd_123' });
  });

  it('never clears an existing tax code when none is configured', () => {
    expect(
      productUpdateFor({ name: 'StudiQ Plus', tax_code: 'txcd_old' }, bootstrapPrice, null),
    ).toBeNull();
  });
});

describe('resolveProductTaxCode', () => {
  it('returns null when unset or blank', () => {
    expect(resolveProductTaxCode({})).toBeNull();
    expect(resolveProductTaxCode({ STRIPE_PRODUCT_TAX_CODE: '   ' })).toBeNull();
  });

  it('trims a valid code', () => {
    expect(resolveProductTaxCode({ STRIPE_PRODUCT_TAX_CODE: '  txcd_10103000 ' })).toBe(
      'txcd_10103000',
    );
  });

  it('rejects a malformed code instead of sending it to Stripe', () => {
    expect(() => resolveProductTaxCode({ STRIPE_PRODUCT_TAX_CODE: 'txcd_' })).toThrow(/txcd_/);
    expect(() => resolveProductTaxCode({ STRIPE_PRODUCT_TAX_CODE: 'saas' })).toThrow(/txcd_/);
  });
});

describe('isProductTaxCodeConfirmed', () => {
  it('requires the explicit confirmation flag, trimmed', () => {
    expect(isProductTaxCodeConfirmed({})).toBe(false);
    expect(isProductTaxCodeConfirmed({ STRIPE_PRODUCT_TAX_CODE_CONFIRMED: '0' })).toBe(false);
    expect(isProductTaxCodeConfirmed({ STRIPE_PRODUCT_TAX_CODE_CONFIRMED: ' 1 ' })).toBe(true);
  });
});

describe('portalParams', () => {
  it('keeps tax-id collection out and plan switching off', () => {
    const params = portalParams(false, 'https://studiq.test');

    expect(params.features.customer_update?.allowed_updates).toEqual(['email', 'address', 'name']);
    expect(params.features.customer_update?.allowed_updates).not.toContain('tax_id');
    expect(params.features.subscription_update).toBeUndefined();
    expect(params.default_return_url).toBe('https://studiq.test/app/billing');
    expect(params.metadata?.studiq_livemode).toBe('false');
  });
});
