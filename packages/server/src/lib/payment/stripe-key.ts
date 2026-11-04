/**
 * Stripe key parsing shared by the runtime factory and the bootstrap script
 * (#662 workstream B), so the prefix rule and the derived `livemode` cannot
 * drift between the two.
 *
 * Secret (`sk_`) and restricted (`rk_`) keys are both accepted. The suffix must
 * be non-empty: a bare `sk_live_` is a configuration error, not a live key.
 */
const STRIPE_SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_.+$/;

export interface ParsedStripeKey {
  livemode: boolean;
}

/** `null` means "not a Stripe secret/restricted key"; the caller decides the error. */
export function parseStripeKey(secretKey: string): ParsedStripeKey | null {
  const key = secretKey.trim();
  if (!STRIPE_SECRET_KEY_PATTERN.test(key)) return null;
  return { livemode: key.startsWith('sk_live_') || key.startsWith('rk_live_') };
}
