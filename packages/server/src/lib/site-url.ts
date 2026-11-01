/**
 * Canonical public origin for generated URLs (metadata, sitemap, mock checkout
 * redirects). `NEXT_PUBLIC_SITE_URL` is the documented knob; `APP_URL` is the
 * shared root-`.env` name used by the Supabase auth config, so it is a safe
 * fallback when only the root env is loaded. The default matches the fixed
 * local dev contract (`bun dev:up`, port 3000).
 */
const DEFAULT_SITE_URL = 'http://localhost:3000';

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL;
  const siteUrl = configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_SITE_URL;
  return siteUrl.replace(/\/+$/, '');
}
