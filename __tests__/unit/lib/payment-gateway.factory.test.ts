import {
  createPaymentGatewayFromEnv,
  parseStripeConfig,
  PaymentConfigError,
} from '@studiq/server/lib/payment/payment-gateway.factory';
import { describe, expect, it } from 'vitest';

const validStripeEnv = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_123',
};

describe('createPaymentGatewayFromEnv', () => {
  it('defaults to the mock driver when PAYMENT_DRIVER is unset', () => {
    expect(createPaymentGatewayFromEnv({}).driver).toBe('mock');
  });

  it('treats an empty or whitespace PAYMENT_DRIVER as mock', () => {
    expect(createPaymentGatewayFromEnv({ PAYMENT_DRIVER: '' }).driver).toBe('mock');
    expect(createPaymentGatewayFromEnv({ PAYMENT_DRIVER: '   ' }).driver).toBe('mock');
  });

  it('accepts the mock driver case-insensitively', () => {
    expect(createPaymentGatewayFromEnv({ PAYMENT_DRIVER: 'MOCK' }).driver).toBe('mock');
  });

  it('rejects an unknown driver instead of silently falling back to mock', () => {
    expect(() => createPaymentGatewayFromEnv({ PAYMENT_DRIVER: 'strpe' })).toThrow(
      PaymentConfigError,
    );
    expect(() => createPaymentGatewayFromEnv({ PAYMENT_DRIVER: 'strpe' })).toThrow(
      /unknown PAYMENT_DRIVER "strpe"/,
    );
  });

  it('reports the missing Stripe secret before the adapter is checked', () => {
    expect(() => createPaymentGatewayFromEnv({ PAYMENT_DRIVER: 'stripe' })).toThrow(
      /STRIPE_SECRET_KEY is required/,
    );
  });

  it('builds the Stripe adapter from a complete test-mode configuration', () => {
    const gateway = createPaymentGatewayFromEnv({
      PAYMENT_DRIVER: 'stripe',
      ...validStripeEnv,
    });

    expect(gateway.driver).toBe('stripe');
    expect(gateway.livemode).toBe(false);
  });
});

describe('parseStripeConfig', () => {
  it('parses a complete test-mode configuration', () => {
    expect(parseStripeConfig(validStripeEnv)).toEqual({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      portalConfigurationId: 'bpc_123',
      livemode: false,
    });
  });

  it('trims whitespace around every value', () => {
    expect(
      parseStripeConfig({
        STRIPE_SECRET_KEY: '  sk_test_123  ',
        STRIPE_WEBHOOK_SECRET: ' whsec_123 ',
        STRIPE_PORTAL_CONFIGURATION_ID: ' bpc_123 ',
      }),
    ).toEqual({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      portalConfigurationId: 'bpc_123',
      livemode: false,
    });
  });

  it('derives livemode from the secret key prefix', () => {
    expect(
      parseStripeConfig({
        ...validStripeEnv,
        STRIPE_SECRET_KEY: 'sk_live_123',
        NODE_ENV: 'production',
      }).livemode,
    ).toBe(true);
  });

  it('refuses a live key outside production', () => {
    expect(() =>
      parseStripeConfig({ ...validStripeEnv, STRIPE_SECRET_KEY: 'sk_live_123' }),
    ).toThrow(/live Stripe key refused outside production/);
  });

  it('allows a live key outside production only with the explicit escape hatch', () => {
    expect(
      parseStripeConfig({
        ...validStripeEnv,
        STRIPE_SECRET_KEY: 'sk_live_123',
        NODE_ENV: 'test',
        STRIPE_ALLOW_LIVE: '1',
      }).livemode,
    ).toBe(true);
  });

  it.each([
    [
      'STRIPE_SECRET_KEY',
      { ...validStripeEnv, STRIPE_SECRET_KEY: undefined },
      /STRIPE_SECRET_KEY is required/,
    ],
    [
      'malformed secret',
      { ...validStripeEnv, STRIPE_SECRET_KEY: 'pk_test_123' },
      /must start with sk_test_ or sk_live_/,
    ],
    [
      'STRIPE_WEBHOOK_SECRET',
      { ...validStripeEnv, STRIPE_WEBHOOK_SECRET: undefined },
      /STRIPE_WEBHOOK_SECRET is required/,
    ],
    [
      'malformed webhook secret',
      { ...validStripeEnv, STRIPE_WEBHOOK_SECRET: 'secret_123' },
      /must start with whsec_/,
    ],
    [
      'STRIPE_PORTAL_CONFIGURATION_ID',
      { ...validStripeEnv, STRIPE_PORTAL_CONFIGURATION_ID: undefined },
      /STRIPE_PORTAL_CONFIGURATION_ID is required/,
    ],
    [
      'malformed portal configuration',
      { ...validStripeEnv, STRIPE_PORTAL_CONFIGURATION_ID: 'portal_123' },
      /must start with bpc_/,
    ],
  ])('rejects a bad %s', (_label, env, pattern) => {
    expect(() => parseStripeConfig(env)).toThrow(pattern);
  });
});
