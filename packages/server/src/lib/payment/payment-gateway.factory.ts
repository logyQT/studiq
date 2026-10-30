import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import { mockPaymentGateway } from '@studiq/server/lib/payment/mock-payment.gateway';

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(`Invalid payment configuration: ${message}`);
    this.name = 'PaymentConfigError';
  }
}

type Env = Record<string, string | undefined>;

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
 * Exported separately from the factory because phase 2 wires the real
 * `StripePaymentGateway` and tests the parser without a network or SDK.
 */
export function parseStripeConfig(env: Env = process.env): StripeConfig {
  const secretKey = required(env, 'STRIPE_SECRET_KEY');
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
    throw new PaymentConfigError('STRIPE_SECRET_KEY must start with sk_test_ or sk_live_');
  }

  const livemode = secretKey.startsWith('sk_live_');
  if (livemode && env.NODE_ENV !== 'production' && env.STRIPE_ALLOW_LIVE !== '1') {
    throw new PaymentConfigError(
      'live Stripe key refused outside production (set STRIPE_ALLOW_LIVE=1 only for a deliberate live smoke test)',
    );
  }

  const webhookSecret = required(env, 'STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret.startsWith('whsec_')) {
    throw new PaymentConfigError('STRIPE_WEBHOOK_SECRET must start with whsec_');
  }

  const portalConfigurationId = required(env, 'STRIPE_PORTAL_CONFIGURATION_ID');
  if (!portalConfigurationId.startsWith('bpc_')) {
    throw new PaymentConfigError('STRIPE_PORTAL_CONFIGURATION_ID must start with bpc_');
  }

  return { secretKey, webhookSecret, portalConfigurationId, livemode };
}

/**
 * Picks the payment adapter from environment variables, mirroring the mailer
 * driver (`MAIL_DRIVER`):
 *
 * - `PAYMENT_DRIVER` unset or `mock`: the simulation. No Stripe env is needed.
 * - `PAYMENT_DRIVER=stripe`: validates the full Stripe configuration; the
 *   adapter itself lands in phase 2, so this throws until then rather than
 *   silently falling back to the mock.
 *
 * Anything else throws a `PaymentConfigError`, so a typo fails at boot.
 */
export function createPaymentGatewayFromEnv(env: Env = process.env): PaymentGateway {
  const driver = (env.PAYMENT_DRIVER ?? 'mock').trim().toLowerCase();

  if (driver === '' || driver === 'mock') return mockPaymentGateway;

  if (driver === 'stripe') {
    // Validate keys first so a missing secret is reported as such, then fail
    // loudly on the missing adapter instead of charging through the mock.
    parseStripeConfig(env);
    throw new PaymentConfigError(
      'PAYMENT_DRIVER=stripe is not wired yet; StripePaymentGateway lands in phase 2',
    );
  }

  throw new PaymentConfigError(`unknown PAYMENT_DRIVER "${driver}" (expected mock or stripe)`);
}

let cached: PaymentGateway | undefined;

/** Process-wide gateway built from `process.env` on first use. */
export function getPaymentGateway(): PaymentGateway {
  if (!cached) cached = createPaymentGatewayFromEnv();
  return cached;
}
