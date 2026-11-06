#!/usr/bin/env bun
/**
 * Pre-bind payment preflight (#662 workstream B).
 *
 * Next's `next start` swallows an instrumentation `register()` rejection (the
 * process stays up and every request 500s), so the payment contract is checked
 * here *before* the port binds. Prints the provider and mode only — never key
 * material.
 *
 * Exits 1 on a production + mock posture, a test key in production, a missing
 * Stripe configuration or a non-https/localhost site URL.
 */
import { createPaymentGatewayFromEnv } from '@studiq/server/lib/payment/payment-gateway.factory';

try {
  const gateway = createPaymentGatewayFromEnv();
  console.log(`[payment-preflight] provider=${gateway.driver} livemode=${gateway.livemode}`);
} catch (error) {
  console.error(
    `[payment-preflight] refusing to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
