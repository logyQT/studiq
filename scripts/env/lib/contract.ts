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

function readShared(): boolean {
  const raw = process.env.SUPABASE_SHARED ?? '';
  if (raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new UsageError(`SUPABASE_SHARED must be 0 or 1 (got '${raw}').`);
}

/**
 * A validated `SUPABASE_STACK`, or null when it is unset.
 *
 * Exported for callers that act on a stack (`down --all`): the lenient reader
 * below folds a malformed value to null so reporting and plain teardown keep
 * working, and acting on that null would silently target the default stack.
 */
export function readStackName(): string | null {
  const raw = process.env.SUPABASE_STACK ?? '';
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new UsageError(
      `SUPABASE_STACK='${raw}' is not a valid stack name (letters, digits, - and _).`,
    );
  }
  return raw;
}

function readAppPort(appUrl: string): number {
  const explicit = process.env.APP_PORT ?? '';
  if (explicit) return parsePort(explicit, 'APP_PORT');
  const fromUrl = urlPort(appUrl);
  if (fromUrl) return parsePort(fromUrl, 'APP_URL');
  return 3000;
}

export function readContract(): Contract {
  const shared = readShared();
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

/**
 * `down` and the read-only `status` snapshot must remain usable even with an
 * invalid contract: teardown/reporting must not be blocked by a bad `APP_PORT`
 * or `APP_URL`. The fallback is the same documented default, never a value file.
 */
export function readContractLenient(): Contract {
  // Each field falls back independently: a bad APP_PORT/APP_URL must not throw
  // away a valid SUPABASE_STACK, or `down --all` could target the wrong stack.
  let shared = false;
  try {
    shared = readShared();
  } catch {
    shared = false;
  }

  let stackName: string | null = null;
  try {
    stackName = readStackName();
  } catch {
    stackName = null;
  }

  const rawAppUrl = process.env.APP_URL ?? '';
  let appPort = 3000;
  let explicitValid = false;
  const explicitPort = process.env.APP_PORT ?? '';
  if (explicitPort) {
    try {
      appPort = parsePort(explicitPort, 'APP_PORT');
      explicitValid = true;
    } catch {
      appPort = 3000;
    }
  }
  if (!explicitValid) {
    const fromUrl = urlPort(rawAppUrl);
    if (fromUrl) {
      try {
        appPort = parsePort(fromUrl, 'APP_URL');
      } catch {
        appPort = 3000;
      }
    }
  }

  let appUrl = `http://localhost:${appPort}`;
  if (rawAppUrl) {
    try {
      appUrl = trimTrailingSlash(new URL(rawAppUrl).toString());
    } catch {
      /* invalid APP_URL: keep the derived default */
    }
  }

  return {
    shared,
    sharedOwner: process.env.SUPABASE_SHARED_OWNER || null,
    stackName,
    appPort,
    appUrl,
  };
}

/** Apply an app-port lease to a contract whose URL was not explicitly set. */
export function contractWithPort(contract: Contract, appPort: number): Contract {
  let appUrl: string;
  try {
    const parsed = new URL(contract.appUrl);
    parsed.port = String(appPort);
    appUrl = parsed.toString().replace(/\/$/, '');
  } catch {
    appUrl = `http://localhost:${appPort}`;
  }
  return { ...contract, appPort, appUrl };
}
