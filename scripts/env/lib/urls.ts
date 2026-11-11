/**
 * URL helpers. Every value handled here comes from the environment or the
 * Supabase CLI's status JSON; nothing is written back anywhere.
 */

/** Remove exactly one trailing slash (matches the legacy dev script's `env_url`). */
export function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Display normalisation used by `env:status`: a loopback URL is shown as
 * `localhost` instead of `127.0.0.1`. Nothing is resolved or probed here.
 */
export function normalizeLocalhost(url: string): string {
  return url.replace(/\/\/127\.0\.0\.1([:/]|$)/g, '//localhost$1');
}

/** Port from a URL, or null when the URL has no explicit port. */
export function urlPort(url: string): string | null {
  try {
    return new URL(url).port || null;
  } catch {
    return null;
  }
}

/**
 * A database URL without userinfo. `SUPABASE_DB_URL` carries the local
 * `postgres:postgres` password; the JSON contract only exposes host, port and
 * database name.
 */
export function stripDbCredentials(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return null;
    parsed.username = '';
    parsed.password = '';
    // Query/fragment can carry credentials too (`?password=…`, `?sslpassword=…`).
    parsed.search = '';
    parsed.hash = '';
    return normalizeLocalhost(parsed.toString());
  } catch {
    return null;
  }
}
