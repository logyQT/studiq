import { UsageError } from '../atoms';
import { trimTrailingSlash, urlPort } from './urls';

/**
 * This checkout's contract, resolved from the **process environment only**.
 * `status` / `ports` / `doctor` run unwrapped, so a root `.env.local` is only
 * visible when the operator (or varlock) already exported it. The tool never
 * parses a dotenv file.
 */
export interface Contract {
  shared: boolean;
  sharedOwner: string | null;
  stackName: string | null;
  appPort: number;
  appUrl: string;
}

function parsePort(value: string, label: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new UsageError(`${label}='${value}' is not a port number (1-65535).`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new UsageError(`${label}=${value} is out of range (1-65535).`);
  }
  return port;
}

/**
 * Strict shared-mode flag: only ''/'0'/'1' are accepted, so a value like
 * `true` is a usage error instead of silently meaning "not shared".
 */
export function isSharedMode(): boolean {
  const raw = process.env.SUPABASE_SHARED ?? '';
  if (raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new UsageError(`SUPABASE_SHARED must be 0 or 1 (got '${raw}').`);
}

function readStackName(): string | null {
  const raw = process.env.SUPABASE_STACK ?? '';
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new UsageError(
      `SUPABASE_STACK='${raw}' is not a valid stack name (letters, digits, - and _).`,
    );
  }
  return raw;
}

/** Ports a scheme implies when the URL omits an explicit one. */
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

/**
 * A URL this checkout serves itself: `APP_PORT` and `APP_URL` then describe the
 * same listener, so the two must agree. Hosted/proxied URLs are exempt.
 */
function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/** The URL's effective port (explicit, else the scheme default), or null. */
function effectivePort(url: string): number | null {
  const fromUrl = urlPort(url);
  if (fromUrl) return parsePort(fromUrl, 'APP_URL');
  try {
    return DEFAULT_PORTS[new URL(url).protocol] ?? null;
  } catch {
    return null;
  }
}

function readAppPort(appUrl: string): number {
  const explicit = process.env.APP_PORT ?? '';
  if (!appUrl) return explicit ? parsePort(explicit, 'APP_PORT') : 3000;

  const effective = isLoopbackUrl(appUrl) ? effectivePort(appUrl) : null;
  if (explicit) {
    const port = parsePort(explicit, 'APP_PORT');
    if (effective !== null && port !== effective) {
      throw new UsageError(
        `APP_PORT=${port} does not match loopback APP_URL ${appUrl} (port ${effective}); set one or align them`,
      );
    }
    return port;
  }
  if (effective !== null) return effective;
  const fromUrl = urlPort(appUrl);
  if (fromUrl) return parsePort(fromUrl, 'APP_URL');
  return 3000;
}

export function readContract(): Contract {
  const shared = isSharedMode();
  const stackName = readStackName();
  const rawAppUrl = process.env.APP_URL ?? '';
  const appPort = readAppPort(rawAppUrl);
  const appUrl = trimTrailingSlash(rawAppUrl || `http://localhost:${appPort}`);
  return {
    shared,
    sharedOwner: process.env.SUPABASE_SHARED_OWNER || null,
    stackName,
    appPort,
    appUrl,
  };
}
