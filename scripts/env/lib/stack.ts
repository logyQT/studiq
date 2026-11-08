import { spawnSync } from 'node:child_process';
import { REPO_ROOT, canon, currentBranchRef } from './repo';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from './urls';

/**
 * Read-only wrapper around the tools' only source for a running stack:
 * `supabase stack status --output-format json` (`stack list` for a stopped
 * stack's persisted runtime). Nothing here starts, stops or writes a stack, and
 * the CLI's key material is never copied into a variable we keep — only the
 * URL/port fields the contract needs are read.
 */
export interface StackPorts {
  api: number;
  db: number;
  studio: number;
  mail: number;
  mailSmtp: number;
  mailPop3: number;
  analytics: number;
  edgeInspector: number;
  pooler: number;
  pgmeta: number;
}

export interface StackStatus {
  id: string;
  name: string;
  projectRoot: string;
  branch: string | null;
  runtime: string;
  lifecycle: string | null;
  configDrift: string | null;
  apiUrl: string;
  /** Credential-free database URL. */
  dbUrl: string | null;
  studioUrl: string | null;
  mailUrl: string | null;
  ports: StackPorts;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPort(value: unknown): number {
  const port =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function endpointPort(endpoints: JsonObject, key: string): number {
  return asPort(asObject(endpoints[key])?.port);
}

function parseJsonObject(raw: string): JsonObject | null {
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

interface SupabaseRun {
  ok: boolean;
  stdout: string;
  /** Set only when the CLI could not be spawned or timed out — not for a
   *  non-zero exit (a stopped stack still exits 0 with no API URL). */
  error: string | null;
}

function runSupabase(args: string[]): SupabaseRun {
  // `supabase/config.toml` resolves APP_URL through env(); the CLI reads no
  // values file. An explicit APP_URL still wins, exactly like `scripts/dev`.
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.APP_PORT || '3000'}`;
  const result = spawnSync('bunx', ['supabase', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, APP_URL: appUrl },
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) return { ok: false, stdout: '', error: result.error.message };
  return { ok: result.status === 0, stdout: result.stdout ?? '', error: null };
}

function stackArgs(command: 'status' | 'list', stackName: string | null): string[] {
  const args = ['stack', command, '--output-format', 'json'];
  if (stackName) args.push('--stack', stackName);
  return args;
}

export interface StackStatusProbe {
  /** The running stack, or null when it is stopped/unusable/absent. */
  stack: StackStatus | null;
  /** Spawn/timeout failure of the CLI itself; null means the CLI answered. */
  error: string | null;
}

/**
 * Probe the running stack for this checkout. `stack status` exits 0 for a
 * stopped stack (identity + empty endpoints, no API URL), so an absent stack and
 * a broken CLI stay distinguishable: `stack` is null in both cases, but only a
 * spawn failure/timeout sets `error`.
 */
export function probeStackStatus(stackName: string | null): StackStatusProbe {
  const { ok, stdout, error } = runSupabase(stackArgs('status', stackName));
  if (!ok) return { stack: null, error };
  const parsed = parseJsonObject(stdout);
  if (!parsed) return { stack: null, error: null };

  const env = asObject(parsed.env) ?? {};
  const rawApiUrl = asString(env.API_URL);
  if (!rawApiUrl) return { stack: null, error: null };

  const identity = asObject(parsed.identity) ?? {};
  const endpoints = asObject(parsed.endpoints) ?? {};
  const drift = asObject(parsed.config_drift);
  const apiUrl = normalizeLocalhost(trimTrailingSlash(rawApiUrl));
  const studioUrl = asString(env.STUDIO_URL);
  const mailUrl = asString(env.MAILPIT_URL);
  const dbUrl = asString(env.DB_URL);

  return {
    stack: {
      id: asString(identity.id) ?? '',
      name: asString(identity.name) ?? 'default',
      projectRoot: asString(identity.project_root) ?? '',
      branch: asString(identity.branch_context),
      runtime: asString(parsed.runtime) ?? '',
      lifecycle: asString(parsed.lifecycle),
      configDrift: asString(drift?.status),
      apiUrl,
      dbUrl: dbUrl ? stripDbCredentials(dbUrl) : null,
      studioUrl: studioUrl ? normalizeLocalhost(trimTrailingSlash(studioUrl)) : null,
      mailUrl: mailUrl ? normalizeLocalhost(trimTrailingSlash(mailUrl)) : null,
      ports: {
        api: endpointPort(endpoints, 'rest.http') || endpointPort(endpoints, 'auth.http'),
        db: endpointPort(endpoints, 'database.sql'),
        studio: endpointPort(endpoints, 'studio.http'),
        mail: endpointPort(endpoints, 'mail.http'),
        mailSmtp: endpointPort(endpoints, 'mail.smtp'),
        mailPop3: endpointPort(endpoints, 'mail.pop3'),
        analytics: endpointPort(endpoints, 'analytics.http'),
        edgeInspector: endpointPort(endpoints, 'functions.inspector'),
        pooler: endpointPort(endpoints, 'pooler.sql'),
        pgmeta: endpointPort(endpoints, 'pgmeta.http'),
      },
    },
    error: null,
  };
}

/** The running stack for this checkout, or null when there is none. */
export function readStackStatus(stackName: string | null): StackStatus | null {
  return probeStackStatus(stackName).stack;
}

export interface ListedStack {
  id: string;
  name: string;
  projectRoot: string;
  branch: string | null;
  runtime: string | null;
}

/**
 * Every stack `supabase stack list` knows about, or null when the CLI cannot be
 * read. Read-only: used to verify ownership before a stack-scoped stop.
 */
export function readStackList(): ListedStack[] | null {
  const { ok, stdout } = runSupabase(stackArgs('list', null));
  if (!ok) return null;
  const parsed = parseJsonObject(stdout);
  const stacks = parsed?.stacks;
  if (!Array.isArray(stacks)) return null;
  const listed: ListedStack[] = [];
  for (const item of stacks) {
    const stack = asObject(item);
    if (!stack) continue;
    const id = asString(stack.id);
    if (!id) continue;
    listed.push({
      id,
      name: asString(stack.name) ?? 'default',
      projectRoot: asString(stack.project_root) ?? '',
      branch: asString(stack.branch_context),
      runtime: asString(stack.runtime),
    });
  }
  return listed;
}

/**
 * The persisted runtime of this checkout's stack, including a stopped one.
 * Identity is `project_root + name + branch_context`, the same match the CLI
 * itself uses.
 */
export function readListedStackRuntime(stackName: string | null): string | null {
  const stacks = readStackList();
  if (!stacks) return null;
  const wantedName = stackName || 'default';
  const wantedBranch = currentBranchRef();
  const hit = stacks.find(
    (stack) =>
      canon(stack.projectRoot) === REPO_ROOT &&
      stack.name === wantedName &&
      (stack.branch ?? '') === wantedBranch,
  );
  return hit?.runtime ?? null;
}
