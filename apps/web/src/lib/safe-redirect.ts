/** Auth routes may never be a `next` target (the proxy would redirect again → loop). */
const AUTH_PATHS = ['/login', '/register'];

/**
 * Same-origin, internal path for a post-login redirect, or `null` when unsafe.
 *
 * Shared by the login page and the proxy so both trust exactly one validation
 * (`?next=` is attacker-controlled): cross-origin, protocol-relative and
 * `javascript:` URLs are rejected, as are `/api/*` (not a page) and the auth
 * routes themselves (redirect loop).
 */
export function toSafeInternalPath(raw: string | null | undefined, base: string): string | null {
  if (!raw || !base || !URL.canParse(raw, base)) return null;

  const parsed = new URL(raw, base);
  const baseUrl = new URL(base);

  // Cross-origin / protocol-relative / `javascript:` all resolve to another origin.
  if (parsed.origin !== baseUrl.origin) return null;
  if (parsed.pathname.startsWith('/api/')) return null;
  if (AUTH_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`))) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
