import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0']);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (/^fe[89ab][0-9a-f]?:/.test(normalized)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) {
    const embedded = normalized.slice('::ffff:'.length);
    if (embedded.includes('.')) return isPrivateIPv4(embedded);
  }
  return false;
}

/**
 * Blocks SSRF: rejects non-http(s) protocols and any hostname that is (or
 * resolves to) a loopback/private/link-local address — including the cloud
 * metadata endpoint 169.254.169.254. Resolves DNS itself rather than trusting
 * the hostname alone, so a public-looking domain that rebinds to an internal
 * IP is still caught. Fails closed: DNS resolution errors block the request.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Blocked: not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked: unsupported protocol "${parsed.protocol}"`);
  }

  // URL.hostname keeps the brackets for an IPv6 literal (e.g. "[::1]") — strip
  // them before hostname checks and isIP(), which don't accept brackets.
  const hostname = parsed.hostname.toLowerCase();
  const bareHostname =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (
    BLOCKED_HOSTNAMES.has(bareHostname) ||
    bareHostname.endsWith('.localhost') ||
    bareHostname.endsWith('.local')
  ) {
    throw new Error(`Blocked: "${bareHostname}" is not a permitted destination`);
  }

  const literalIpVersion = isIP(bareHostname);
  if (literalIpVersion === 4) {
    if (isPrivateIPv4(bareHostname)) {
      throw new Error(`Blocked: "${bareHostname}" is a private/internal address`);
    }
    return;
  }
  if (literalIpVersion === 6) {
    if (isPrivateIPv6(bareHostname)) {
      throw new Error(`Blocked: "${bareHostname}" is a private/internal address`);
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(bareHostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Blocked: could not resolve "${bareHostname}"`);
  }

  for (const { address, family } of addresses) {
    const isPrivate = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
    if (isPrivate) {
      throw new Error(
        `Blocked: "${bareHostname}" resolves to a private/internal address (${address})`,
      );
    }
  }
}
