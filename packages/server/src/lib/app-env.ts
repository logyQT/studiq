import { configuredSiteUrl } from '@studiq/server/lib/site-url';

/**
 * `APP_ENV` is the deployment posture (#662 workstream B).
 *
 * `NODE_ENV` is deliberately **not** used: `next start` in QA and e2e also runs
 * with `NODE_ENV=production`, so it cannot distinguish those environments from
 * the real production deployment.
 *
 * Production is the default when `APP_ENV` is unset, so a missing value fails
 * closed instead of silently enabling a development-only payment driver.
 */
export const APP_ENVS = ['production', 'development', 'test', 'qa'] as const;

export type AppEnv = (typeof APP_ENVS)[number];

export type Env = Record<string, string | undefined>;

export class AppEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppEnvError';
  }
}

export function resolveAppEnv(env: Env = process.env): AppEnv {
  const raw = env.APP_ENV?.trim().toLowerCase();
  if (!raw) return 'production';

  const match = APP_ENVS.find((value) => value === raw);
  if (match) return match;

  throw new AppEnvError(
    `APP_ENV must be one of ${APP_ENVS.join(', ')} (got "${raw}"); production is the default when unset`,
  );
}

export function isProductionEnv(env: Env = process.env): boolean {
  return resolveAppEnv(env) === 'production';
}

/** Loopback names that can never be a production origin. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');

  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    // All of 127.0.0.0/8 is loopback, not just 127.0.0.1. Match IPv4 only:
    // a DNS name such as `127.example.com` is not loopback.
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === '::1' ||
    host === '::' ||
    host.startsWith('::ffff:127.')
  );
}

/**
 * Validate an origin that Stripe will redirect to (Checkout `success_url`, the
 * Billing Portal return URL). Production requires TLS, a real host and no path:
 * those URLs are built by appending `/app/...` to the origin.
 */
export function assertSecureSiteUrl(value: string, label = 'NEXT_PUBLIC_SITE_URL'): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppEnvError(`${label} must be an https:// non-localhost URL in production`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppEnvError(`${label} must be a valid absolute URL (got "${trimmed}")`);
  }

  if (url.protocol !== 'https:') {
    throw new AppEnvError(`${label} must start with https:// in production (got "${trimmed}")`);
  }
  if (isLocalHostname(url.hostname)) {
    throw new AppEnvError(`${label} must not point at localhost in production (got "${trimmed}")`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new AppEnvError(
      `${label} must be an origin without a path (got "${trimmed}"); return URLs are appended to it`,
    );
  }
  if (url.search || url.hash) {
    throw new AppEnvError(`${label} must not contain a query or fragment (got "${trimmed}")`);
  }

  return url.origin;
}

/**
 * The production site origin. `NEXT_PUBLIC_SITE_URL` is the documented knob;
 * `APP_URL` is the shared root-`.env` name, kept as a fallback so a single
 * value can drive both.
 */
export function assertProductionSiteUrl(env: Env = process.env): string {
  const configured = configuredSiteUrl(env);
  if (!configured) {
    throw new AppEnvError(
      'NEXT_PUBLIC_SITE_URL (or APP_URL) must be an https:// non-localhost URL in production',
    );
  }
  return assertSecureSiteUrl(configured);
}
