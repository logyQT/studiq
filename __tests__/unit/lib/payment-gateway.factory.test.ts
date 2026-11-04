import {
  createPaymentGatewayFromEnv,
  parseStripeConfig,
  PaymentConfigError,
  resolvePaymentDriver,
} from '@studiq/server/lib/payment/payment-gateway.factory';
import { describe, expect, it } from 'vitest';

type Env = Record<string, string | undefined>;

const liveStripeEnv = {
  STRIPE_SECRET_KEY: 'rk_live_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_123',
  NEXT_PUBLIC_SITE_URL: 'https://studiq.app',
};
const testStripeEnv = {
  ...liveStripeEnv,
  STRIPE_SECRET_KEY: 'rk_test_123',
};

/**
 * The full `APP_ENV` × `PAYMENT_DRIVER` matrix from #662 §5 and handoff §5.
 * Production is the default posture; there is no mock override.
 */
describe('APP_ENV × PAYMENT_DRIVER matrix', () => {
  it.each<[string, Env, 'mock' | 'stripe' | RegExp]>([
    [
      'unset APP_ENV + unset driver fails closed on missing Stripe config',
      {},
      /STRIPE_SECRET_KEY is required/,
    ],
    [
      'unset APP_ENV + mock is a production boot error',
      { PAYMENT_DRIVER: 'mock' },
      /not available in production/,
    ],
    [
      'production + mock is always a boot error',
      { APP_ENV: 'production', PAYMENT_DRIVER: 'mock' },
      /not available in production/,
    ],
    [
      'production + test key is refused',
      { APP_ENV: 'production', PAYMENT_DRIVER: 'stripe', ...testStripeEnv },
      /test-mode Stripe keys .* refused in production/,
    ],
    [
      'production + live key starts',
      { APP_ENV: 'production', PAYMENT_DRIVER: 'stripe', ...liveStripeEnv },
      'stripe',
    ],
    [
      'production without a site URL fails boot',
      {
        APP_ENV: 'production',
        PAYMENT_DRIVER: 'stripe',
        ...liveStripeEnv,
        NEXT_PUBLIC_SITE_URL: undefined,
      },
      /NEXT_PUBLIC_SITE_URL \(or APP_URL\)/,
    ],
    [
      'production with an http site URL fails boot',
      {
        APP_ENV: 'production',
        PAYMENT_DRIVER: 'stripe',
        ...liveStripeEnv,
        NEXT_PUBLIC_SITE_URL: 'http://studiq.app',
      },
      /must start with https/,
    ],
    [
      'production with a localhost site URL fails boot',
      {
        APP_ENV: 'production',
        PAYMENT_DRIVER: 'stripe',
        ...liveStripeEnv,
        NEXT_PUBLIC_SITE_URL: 'https://localhost:3000',
      },
      /must not point at localhost/,
    ],
    ['development + unset driver defaults to mock', { APP_ENV: 'development' }, 'mock'],
    ['test + unset driver defaults to mock', { APP_ENV: 'test' }, 'mock'],
    ['qa + unset driver defaults to mock', { APP_ENV: 'qa' }, 'mock'],
    ['development + mock is allowed', { APP_ENV: 'development', PAYMENT_DRIVER: 'mock' }, 'mock'],
    [
      'test + stripe + test key is allowed',
      { APP_ENV: 'test', PAYMENT_DRIVER: 'stripe', ...testStripeEnv },
      'stripe',
    ],
    [
      'qa + stripe + test key is allowed',
      { APP_ENV: 'qa', PAYMENT_DRIVER: 'stripe', ...testStripeEnv },
      'stripe',
    ],
    [
      'development + live key is refused',
      { APP_ENV: 'development', PAYMENT_DRIVER: 'stripe', ...liveStripeEnv },
      /live Stripe key refused outside production/,
    ],
    [
      'development + live key with the explicit escape hatch starts',
      {
        APP_ENV: 'development',
        PAYMENT_DRIVER: 'stripe',
        ...liveStripeEnv,
        STRIPE_ALLOW_LIVE: '1',
      },
      'stripe',
    ],
    ['driver values are case-insensitive', { APP_ENV: 'QA', PAYMENT_DRIVER: 'MOCK' }, 'mock'],
    ['an unknown APP_ENV is a boot error', { APP_ENV: 'staging' }, /APP_ENV must be one of/],
    [
      'an unknown driver is a boot error',
      { APP_ENV: 'test', PAYMENT_DRIVER: 'strpe' },
      /unknown PAYMENT_DRIVER "strpe"/,
    ],
  ])('%s', (_label, env, expected) => {
    if (expected instanceof RegExp) {
      expect(() => createPaymentGatewayFromEnv(env)).toThrow(expected);
      return;
    }

    const gateway = createPaymentGatewayFromEnv(env);
    expect(gateway.driver).toBe(expected);
    expect(gateway.livemode).toBe(
      expected === 'stripe' && Boolean(env.STRIPE_SECRET_KEY?.includes('_live_')),
    );
  });
});

describe('resolvePaymentDriver', () => {
  it('derives the default driver from the posture', () => {
    expect(resolvePaymentDriver({}, 'production')).toBe('stripe');
    expect(resolvePaymentDriver({}, 'development')).toBe('mock');
    expect(resolvePaymentDriver({}, 'test')).toBe('mock');
    expect(resolvePaymentDriver({}, 'qa')).toBe('mock');
  });

  it('treats an empty driver as unset', () => {
    expect(resolvePaymentDriver({ PAYMENT_DRIVER: '   ' }, 'qa')).toBe('mock');
  });
});

describe('parseStripeConfig', () => {
  it('parses a restricted live key with an https site URL in production', () => {
    expect(parseStripeConfig(liveStripeEnv, 'production')).toEqual({
      secretKey: 'rk_live_123',
      webhookSecret: 'whsec_123',
      portalConfigurationId: 'bpc_123',
      livemode: true,
    });
  });

  it.each([
    ['sk_test_123', false],
    ['rk_test_123', false],
    ['sk_live_123', true],
    ['rk_live_123', true],
  ])('derives livemode from %s', (key, livemode) => {
    expect(
      parseStripeConfig(
        { ...testStripeEnv, STRIPE_SECRET_KEY: key },
        livemode ? 'production' : 'development',
      ).livemode,
    ).toBe(livemode);
  });

  it('trims whitespace around every value', () => {
    expect(
      parseStripeConfig(
        {
          STRIPE_SECRET_KEY: '  rk_test_123  ',
          STRIPE_WEBHOOK_SECRET: ' whsec_123 ',
          STRIPE_PORTAL_CONFIGURATION_ID: ' bpc_123 ',
        },
        'test',
      ),
    ).toEqual({
      secretKey: 'rk_test_123',
      webhookSecret: 'whsec_123',
      portalConfigurationId: 'bpc_123',
      livemode: false,
    });
  });

  it('accepts APP_URL as the production site origin fallback', () => {
    const { NEXT_PUBLIC_SITE_URL: _ignored, ...withoutSiteUrl } = liveStripeEnv;
    expect(
      parseStripeConfig({ ...withoutSiteUrl, APP_URL: 'https://studiq.pl' }, 'production').livemode,
    ).toBe(true);
  });

  it('refuses a live key outside production without the escape hatch', () => {
    expect(() => parseStripeConfig(liveStripeEnv, 'test')).toThrow(
      /live Stripe key refused outside production/,
    );
  });

  it.each([
    [
      'STRIPE_SECRET_KEY',
      { ...testStripeEnv, STRIPE_SECRET_KEY: undefined },
      /STRIPE_SECRET_KEY is required/,
    ],
    [
      'malformed secret',
      { ...testStripeEnv, STRIPE_SECRET_KEY: 'pk_test_123' },
      /must start with sk_test_, sk_live_, rk_test_ or rk_live_/,
    ],
    [
      'STRIPE_WEBHOOK_SECRET',
      { ...testStripeEnv, STRIPE_WEBHOOK_SECRET: undefined },
      /STRIPE_WEBHOOK_SECRET is required/,
    ],
    [
      'malformed webhook secret',
      { ...testStripeEnv, STRIPE_WEBHOOK_SECRET: 'secret_123' },
      /must start with whsec_/,
    ],
    [
      'STRIPE_PORTAL_CONFIGURATION_ID',
      { ...testStripeEnv, STRIPE_PORTAL_CONFIGURATION_ID: undefined },
      /STRIPE_PORTAL_CONFIGURATION_ID is required/,
    ],
    [
      'malformed portal configuration',
      { ...testStripeEnv, STRIPE_PORTAL_CONFIGURATION_ID: 'portal_123' },
      /must start with bpc_/,
    ],
  ])('rejects a bad %s', (_label, env, pattern) => {
    expect(() => parseStripeConfig(env, 'test')).toThrow(pattern);
  });

  it('trims STRIPE_ALLOW_LIVE before comparing', () => {
    expect(
      parseStripeConfig({ ...liveStripeEnv, STRIPE_ALLOW_LIVE: ' 1 ' }, 'development').livemode,
    ).toBe(true);
  });

  it('uses PaymentConfigError for every boot failure', () => {
    expect(() =>
      parseStripeConfig({ ...testStripeEnv, STRIPE_SECRET_KEY: 'nope' }, 'test'),
    ).toThrow(PaymentConfigError);
  });
});
