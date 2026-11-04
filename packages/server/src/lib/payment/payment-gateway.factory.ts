import type { PaymentDriver, PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import { mockPaymentGateway } from '@studiq/server/lib/payment/mock-payment.gateway';
import { parseStripeKey } from '@studiq/server/lib/payment/stripe-key';
import { createStripeClient } from '@studiq/server/lib/payment/stripe-client';
import { StripePaymentGateway } from '@studiq/server/lib/payment/stripe-payment.gateway';
import {
  AppEnvError,
  assertProductionSiteUrl,
  type AppEnv,
  type Env,
  resolveAppEnv,
} from '@studiq/server/lib/app-env';

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(`Invalid payment configuration: ${message}`);
    this.name = 'PaymentConfigError';
  }
}

/**
 * Stripe settings validated at boot. `livemode` is derived from the key
 * prefix, never from a separate flag that could disagree with the key.
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  portalConfigurationId: string;
  livemode: boolean;
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new PaymentConfigError(`${name} is required when PAYMENT_DRIVER=stripe`);
  return value;
}

/**
 * Validates every Stripe setting up front so a typo crashes the server at
 * boot instead of surfacing as a 500 on the first checkout.
 *
 * Production is strict by design (#662 workstream B):
 *
 * - only a live `sk_live_` / `rk_live_` key is accepted;
 * - `NEXT_PUBLIC_SITE_URL` (or `APP_URL`) must be an `https://` non-localhost
 *   origin, because it is the Checkout/Portal return URL.
 *
 * Exported separately from the factory because tests exercise the parser
 * without a network or SDK.
 */
export function parseStripeConfig(
  env: Env = process.env,
  appEnv: AppEnv = resolveAppEnv(env),
): StripeConfig {
  const secretKey = required(env, 'STRIPE_SECRET_KEY');
  const parsedKey = parseStripeKey(secretKey);
  if (!parsedKey) {
    throw new PaymentConfigError(
      'STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_ or rk_live_ and contain a key suffix',
    );
  }

  const { livemode } = parsedKey;

  if (appEnv === 'production') {
    if (!livemode) {
      throw new PaymentConfigError(
        'test-mode Stripe keys (sk_test_ / rk_test_) are refused in production',
      );
    }
    try {
      assertProductionSiteUrl(env);
    } catch (error) {
      if (error instanceof AppEnvError) throw new PaymentConfigError(error.message);
      throw error;
    }
  } else if (livemode && env.STRIPE_ALLOW_LIVE?.trim() !== '1') {
    throw new PaymentConfigError(
      'live Stripe key refused outside production (set STRIPE_ALLOW_LIVE=1 only for a deliberate live smoke test)',
    );
  }

  const webhookSecret = required(env, 'STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret.startsWith('whsec_') || webhookSecret.length <= 'whsec_'.length) {
    throw new PaymentConfigError(
      'STRIPE_WEBHOOK_SECRET must start with whsec_ and contain a secret',
    );
  }

  const portalConfigurationId = required(env, 'STRIPE_PORTAL_CONFIGURATION_ID');
  if (!portalConfigurationId.startsWith('bpc_') || portalConfigurationId.length <= 'bpc_'.length) {
    throw new PaymentConfigError(
      'STRIPE_PORTAL_CONFIGURATION_ID must start with bpc_ and contain an id',
    );
  }

  return { secretKey, webhookSecret, portalConfigurationId, livemode };
}

/**
 * The driver matrix (#662 §5). Production is the default posture:
 *
 * | APP_ENV                     | PAYMENT_DRIVER | driver                 |
 * | --------------------------- | -------------- | ---------------------- |
 * | unset → production          | unset          | stripe (fails closed)  |
 * | production                  | mock           | **boot error, no override** |
 * | production                  | stripe         | stripe                 |
 * | development/test/qa         | unset          | mock                   |
 * | development/test/qa         | mock/stripe    | the named driver       |
 */
export function resolvePaymentDriver(env: Env = process.env, appEnv?: AppEnv): PaymentDriver {
  const posture = appEnv ?? resolveAppEnv(env);
  const raw = (env.PAYMENT_DRIVER ?? '').trim().toLowerCase();

  if (raw === '') return posture === 'production' ? 'stripe' : 'mock';

  if (raw === 'mock') {
    if (posture === 'production') {
      throw new PaymentConfigError(
        'PAYMENT_DRIVER=mock is not available in production; production always uses Stripe',
      );
    }
    return 'mock';
  }

  if (raw === 'stripe') return 'stripe';

  throw new PaymentConfigError(`unknown PAYMENT_DRIVER "${raw}" (expected mock or stripe)`);
}

/**
 * Picks the payment adapter from environment variables, mirroring the mailer
 * driver (`MAIL_DRIVER`).
 *
 * There is **no override** that enables `mock` in production: the only
 * production driver is Stripe, and a missing Stripe configuration fails boot.
 */
export function createPaymentGatewayFromEnv(env: Env = process.env): PaymentGateway {
  const appEnv = resolveAppEnv(env);
  const driver = resolvePaymentDriver(env, appEnv);

  if (driver === 'mock') return mockPaymentGateway;

  const config = parseStripeConfig(env, appEnv);
  return new StripePaymentGateway({
    client: createStripeClient(config.secretKey),
    config,
  });
}

let cached: PaymentGateway | undefined;

/** Process-wide gateway built from `process.env` on first use. */
export function getPaymentGateway(): PaymentGateway {
  if (!cached) cached = createPaymentGatewayFromEnv();
  return cached;
}
