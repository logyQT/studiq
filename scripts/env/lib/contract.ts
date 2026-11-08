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
