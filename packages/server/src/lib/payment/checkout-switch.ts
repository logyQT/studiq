type Env = Record<string, string | undefined>;

/**
 * Incident switch for NEW checkout sessions (#662 workstream E).
 *
 * It must not depend on remembering the exact literal `1`: during an incident
 * any positive-looking value (`1`, `true`, `yes`, `on`) stops checkout. Only an
 * absent/blank/falsey value keeps it enabled.
 */
export function isCheckoutDisabled(env: Env = process.env): boolean {
  const raw = env.CHECKOUT_KILL_SWITCH?.trim().toLowerCase() ?? '';
  return raw !== '' && raw !== '0' && raw !== 'false' && raw !== 'off';
}
