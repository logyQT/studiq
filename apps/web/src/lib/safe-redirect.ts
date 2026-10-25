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
  // WHATWG normalisation can turn `.//evil.com`, `/..//evil.com`, `/%2E//evil.com`
  // … into a `//evil.com` pathname that still reports the app's origin. The
  // consumers re-resolve the returned string, which reads a leading `//` as
  // another host — an open redirect. Only a *leading* `//` is dangerous;
  // internal double slashes (`/app//x`) stay same-origin and are legitimate.
  if (parsed.pathname.startsWith('//')) return null;
  if (parsed.pathname.startsWith('/api/')) return null;
  if (AUTH_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`))) {
    return null;
  }

  const destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // Belt-and-braces: whatever the consumers re-resolve must land back here.
  if (!URL.canParse(destination, base)) return null;
  if (new URL(destination, base).origin !== baseUrl.origin) return null;

  return destination;
}
