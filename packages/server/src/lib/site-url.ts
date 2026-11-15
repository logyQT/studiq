const DEFAULT_SITE_URL = 'http://localhost:3000';

type Env = Record<string, string | undefined>;

/**
 * Resolve the configured public origin once, so validation and URL generation
 * cannot disagree on which variable wins.
 *
 * `NEXT_PUBLIC_SITE_URL` is the documented knob; `APP_URL` is the shared
 * root-`.env` name used by the Supabase auth config, so it is a safe fallback
 * when only the root env is loaded. A whitespace-only value counts as absent.
 */
export function configuredSiteUrl(env: Env = process.env): string | null {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim() || env.APP_URL?.trim();
  return configured && configured.length > 0 ? configured : null;
}

export function resolveSiteUrl(env: Env = process.env): string {
  return configuredSiteUrl(env) ?? DEFAULT_SITE_URL;
}

/**
 * Canonical public origin for generated URLs (metadata, sitemap, mock checkout
 * redirects). The default matches the fixed local dev contract (`bun run env:ensure --profile web`,
 * port 3000). Production validates this value before the server starts (see
 * `assertProductionSiteUrl`).
 */
export function getSiteUrl(): string {
  return resolveSiteUrl().replace(/\/+$/, '');
}
