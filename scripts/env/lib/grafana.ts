import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { probeHttp, probeHttpWithHeaders } from './health';
import { OBSERVABILITY_URLS } from './observability';

/**
 * Grafana's local service account for the agent MCP server.
 *
 * The token lives outside the checkout at a fixed path under the user's home so
 * `opencode.jsonc` can read it with `{file:~/.config/studiq/...}` — no env
 * export, no absolute machine path and no per-worktree setup. `mcp-grafana`
 * only needs `GRAFANA_URL`; the token is injected by OpenCode at config load.
 */
const GRAFANA_SERVICE_ACCOUNT = 'studiq-mcp';

export type GrafanaAuthState = 'ok' | 'no-token' | 'stale-token' | 'unreachable';

export interface GrafanaStatus {
  state: GrafanaAuthState;
  ok: boolean;
  minted: boolean;
  /**
   * Why the last mint attempt failed, or null. Kept apart from `state`/`ok`,
   * which stay the auth truth of the token already on disk: a still-valid token
   * must not be reported as broken just because a forced re-mint failed.
   */
  mintError: string | null;
  url: string;
  tokenFile: string;
  serviceAccount: string | null;
  role: string | null;
  tokenId: number | null;
  mintedAt: string | null;
  mcpBinary: boolean;
  detail: string | null;
}

interface GrafanaTokenMeta {
  serviceAccountId: number;
  serviceAccountName: string;
  role: string;
  tokenId: number | null;
  tokenName: string;
  mintedAt: string;
  url: string;
}

interface ServiceAccount {
  id: number;
  name: string;
  role: string;
}

interface MintedToken {
  key: string;
  id: number | null;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 750;
const DEFAULT_REQUEST_TIMEOUT_MS = 2000;

/** `$HOME/.config/studiq/observability/grafana-mcp-token` (not XDG: config uses `~`). */
function grafanaTokenFile(): string {
  // Read HOME per call: `os.homedir()` caches the first value in Bun, which
  // would pin the path across a test that changes HOME.
  const home = (process.env.HOME ?? '').trim() || homedir();
  return join(home, '.config', 'studiq', 'observability', 'grafana-mcp-token');
}

function grafanaMetaFile(tokenFile = grafanaTokenFile()): string {
  return join(dirname(tokenFile), 'grafana-mcp.json');
}

/** `GRAFANA_URL` when set, else the machine-wide stack's Grafana. */
export function grafanaBaseUrl(): string {
  const configured = (process.env.GRAFANA_URL ?? '').trim();
  const base = configured || OBSERVABILITY_URLS.grafana;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** The token file is read-only state: never follow a symlink out of the directory. */
function readGrafanaToken(file = grafanaTokenFile()): string | null {
  try {
    if (lstatSync(file).isSymbolicLink()) return null;
    const token = readFileSync(file, 'utf8').trim();
    return token.length > 0 ? token : null;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function readGrafanaMeta(file = grafanaMetaFile()): GrafanaTokenMeta | null {
  try {
    if (lstatSync(file).isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const mintedAt = record.mintedAt;
    const serviceAccountName = record.serviceAccountName;
    if (typeof mintedAt !== 'string' || typeof serviceAccountName !== 'string') return null;
    return {
      serviceAccountId: typeof record.serviceAccountId === 'number' ? record.serviceAccountId : 0,
      serviceAccountName,
      role: typeof record.role === 'string' ? record.role : 'Viewer',
      tokenId: typeof record.tokenId === 'number' ? record.tokenId : null,
      tokenName: typeof record.tokenName === 'string' ? record.tokenName : '',
      mintedAt,
      url: typeof record.url === 'string' ? record.url : '',
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    return null;
  }
}

/** `2d ago` / `3h ago` for the mint timestamp, or null when it cannot be parsed. */
export function grafanaTokenAge(mintedAt: string | null): string | null {
  if (!mintedAt) return null;
  const elapsed = Date.now() - Date.parse(mintedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** One line for `env:doctor` / `env:observability`, shared so both stay in sync. */
export function grafanaAuthLabel(
  status: Pick<GrafanaStatus, 'state' | 'serviceAccount' | 'role' | 'mintedAt'>,
): string {
  switch (status.state) {
    case 'ok': {
      const parts = [status.serviceAccount ?? 'service account', status.role ?? 'unknown role'];
      const age = grafanaTokenAge(status.mintedAt);
      if (age) parts.push(age);
      return `ok (${parts.join(', ')})`;
    }
    case 'no-token':
      return "no token — run 'bun run env:observability'";
    case 'stale-token':
      return "stale token — run 'bun run env:observability'";
    case 'unreachable':
      return 'unreachable';
  }
}

/** Whether `mcp-grafana` is on the OpenCode server's PATH. */
function hasMcpBinary(): boolean {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    try {
      accessSync(join(dir, 'mcp-grafana'), constants.X_OK);
      return true;
    } catch {
      // Keep looking; a missing entry is normal.
    }
  }
  return false;
}

/**
 * Read-only view of the token and the stack. The caller can pass an already
 * measured health code so `env:doctor` does not probe `/api/health` twice.
 */
export async function inspectGrafana(
  options: {
    healthCode?: number;
    healthTimeoutMs?: number;
    requestTimeoutMs?: number;
  } = {},
): Promise<GrafanaStatus> {
  const url = grafanaBaseUrl();
  const tokenFile = grafanaTokenFile();
  const meta = readGrafanaMeta(grafanaMetaFile(tokenFile));
  const base: GrafanaStatus = {
    state: 'unreachable',
    ok: false,
    minted: false,
    mintError: null,
    url,
    tokenFile,
    serviceAccount: meta?.serviceAccountName ?? null,
    role: meta?.role ?? null,
    tokenId: meta?.tokenId ?? null,
    mintedAt: meta?.mintedAt ?? null,
    mcpBinary: hasMcpBinary(),
    detail: null,
  };

  const health =
    options.healthCode ??
    (await probeHttp(`${url}/api/health`, options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS));
  if (health === 0) return base;
  if (health !== 200) {
    return { ...base, detail: `health HTTP ${health}` };
  }

  let token: string | null;
  try {
    token = readGrafanaToken(tokenFile);
  } catch (error) {
    // Doctor/observability are the escalation path: an unreadable file must
    // still produce a report instead of throwing before any output.
    const code = isErrnoException(error) ? error.code : 'unknown';
    return { ...base, state: 'stale-token', detail: `token file unreadable (${code})` };
  }
  if (!token) return { ...base, state: 'no-token' };

  const code = await probeHttpWithHeaders(
    `${url}/api/datasources`,
    { authorization: `Bearer ${token}` },
    options.requestTimeoutMs ?? 1500,
  );
  if (code === 200) return { ...base, state: 'ok', ok: true };
  return { ...base, state: 'stale-token', detail: `datasources HTTP ${code}` };
}

/**
 * Mint a Viewer token when the current one is missing or stale.
 *
 * Idempotent: a valid token is returned untouched. There is deliberately no
 * rotation or TTL — a dead token is replaced on the next `env:ensure` or
 * `env:observability ensure`.
 */
export async function ensureGrafanaToken(
  options: {
    force?: boolean;
    healthCode?: number;
    healthTimeoutMs?: number;
    requestTimeoutMs?: number;
  } = {},
): Promise<GrafanaStatus> {
  const current = await inspectGrafana(options);
  if (current.state === 'ok' && options.force !== true) return current;
  if (current.state === 'unreachable') return current;

  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  try {
    const account = await findOrCreateServiceAccount(current.url, timeoutMs);
    const minted = await mintServiceAccountToken(current.url, account.id, timeoutMs);
    const code = await probeHttpWithHeaders(
      `${current.url}/api/datasources`,
      { authorization: `Bearer ${minted.key}` },
      timeoutMs,
    );
    if (code !== 200) throw new Error(`the new token failed validation (HTTP ${code})`);

    const mintedAt = new Date().toISOString();
    const meta: GrafanaTokenMeta = {
      serviceAccountId: account.id,
      serviceAccountName: account.name,
      role: account.role,
      tokenId: minted.id,
      tokenName: minted.name,
      mintedAt,
      url: current.url,
    };
    writePrivateFile(current.tokenFile, minted.key);
    writePrivateFile(grafanaMetaFile(current.tokenFile), `${JSON.stringify(meta, null, 2)}\n`);

    return {
      ...current,
      state: 'ok',
      ok: true,
      minted: true,
      serviceAccount: account.name,
      role: account.role,
      tokenId: minted.id,
      mintedAt,
      detail: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `state`/`ok` still describe the token on disk; a failed mint is its own
    // signal so a machine consumer cannot read `state: 'ok'` as "the command
    // that just ran succeeded".
    return { ...current, minted: false, mintError: message, detail: message };
  }
}

function basicAuth(): string {
  const user = process.env.GRAFANA_ADMIN_USER || 'admin';
  const password = process.env.GRAFANA_ADMIN_PASSWORD || 'admin';
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function jsonHeaders(): Record<string, string> {
  return { authorization: basicAuth(), 'content-type': 'application/json' };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function toServiceAccount(body: unknown): ServiceAccount {
  const record = asRecord(body);
  const id = record?.id;
  const name = record?.name;
  if (typeof id !== 'number' || typeof name !== 'string') {
    throw new Error('Grafana returned an unexpected service account payload');
  }
  return { id, name, role: typeof record?.role === 'string' ? record.role : 'Viewer' };
}

async function searchServiceAccount(
  url: string,
  timeoutMs: number,
): Promise<ServiceAccount | null> {
  const query = encodeURIComponent(GRAFANA_SERVICE_ACCOUNT);
  const result = await requestJson(
    `${url}/api/serviceaccounts/search?perpage=100&query=${query}`,
    { headers: { authorization: basicAuth() } },
    timeoutMs,
  );
  if (result.status !== 200) {
    throw new Error(`service account search failed (HTTP ${result.status})`);
  }
  const accounts = asRecord(result.body)?.serviceAccounts;
  if (!Array.isArray(accounts)) return null;
  for (const entry of accounts) {
    const account = asRecord(entry);
    if (account?.name === GRAFANA_SERVICE_ACCOUNT) return toServiceAccount(account);
  }
  return null;
}

async function findOrCreateServiceAccount(url: string, timeoutMs: number): Promise<ServiceAccount> {
  const existing = await searchServiceAccount(url, timeoutMs);
  if (existing) return existing;

  const created = await requestJson(
    `${url}/api/serviceaccounts`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: GRAFANA_SERVICE_ACCOUNT,
        role: 'Viewer',
        isDisabled: false,
      }),
    },
    timeoutMs,
  );
  if (created.status === 409) {
    // A concurrent mint won the race: reuse its account.
    const retry = await searchServiceAccount(url, timeoutMs);
    if (retry) return retry;
  }
  if (created.status >= 300) {
    throw new Error(`service account creation failed (HTTP ${created.status})`);
  }
  return toServiceAccount(created.body);
}

async function mintServiceAccountToken(
  url: string,
  accountId: number,
  timeoutMs: number,
): Promise<MintedToken & { name: string }> {
  const name = `mcp-${new Date().toISOString()}`;
  const result = await requestJson(
    `${url}/api/serviceaccounts/${accountId}/tokens`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }) },
    timeoutMs,
  );
  if (result.status >= 300) {
    throw new Error(`token mint failed (HTTP ${result.status})`);
  }
  const record = asRecord(result.body);
  const key = record?.key;
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Grafana returned no token key');
  }
  return { key, id: typeof record?.id === 'number' ? record.id : null, name };
}

/** `0600` file in a `0700` directory, written atomically and never through a symlink. */
function writePrivateFile(path: string, contents: string): void {
  const dir = dirname(path);
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${dir} must be a real directory`);
    }
  } catch (error) {
    if (!(isErrnoException(error) && error.code === 'ENOENT')) throw error;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }

  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
