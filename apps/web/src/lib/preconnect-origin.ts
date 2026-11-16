import { isLocalHostname } from '@studiq/server/lib/app-env';

/**
 * The origin worth a `preconnect` in the document head, or `undefined`.
 *
 * A preconnect is a hint about a real remote origin. A local stack's
 * `http://localhost:<port>` would be baked into every visitor's `<head>` — a dead
 * hint on a tunnel and a leak of the dev setup on a deploy — so it emits nothing,
 * as does a value that is not an absolute URL at all.
 */
export function preconnectOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    // A bare `host:port` string parses with that host as its scheme and no
    // hostname at all, so the protocol gate is what rejects it — the loopback
    // check below would see an empty host and pass it through.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return isLocalHostname(url.hostname) ? undefined : url.origin;
  } catch {
    return undefined;
  }
}
