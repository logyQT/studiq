import { spawnSync } from 'node:child_process';
import { REPO_ROOT, canon, currentBranchRef } from './repo';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from './urls';

/**
 * Wrapper around the tools' only source for a running stack:
 * `supabase stack status --output-format json` (`stack list` for a stopped
 * stack's persisted runtime). Read helpers never write; the lifecycle commands
 * live in `stack-lifecycle.ts`. Key material is only ever held in memory and is
 * never copied into the JSON contract, a log or a state file.
 */
export interface StackPorts {
  api: number;
  db: number;
  studio: number;
  mail: number;
  mailSmtp: number;
  mailPop3: number;
  /** Realtime's own RPC port (`realtime.rpc`), never the edge inspector. */
  realtime: number;
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

/** Values relayed to a child process; never printed or persisted. */
export interface StackEnv {
  apiUrl: string;
  restUrl: string | null;
  /** Full URL, including userinfo: child environment only. */
  dbUrl: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  publishableKey: string | null;
  secretKey: string | null;
  mailUrl: string | null;
  studioUrl: string | null;
}

export interface StackRead {
  status: StackStatus;
  env: StackEnv;
  /** Running service names from `composition.members` (capability names). */
  services: string[];
}

type JsonObject = Record<string, unknown>;

export interface SpawnOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Superset of the two needs: phase 1 distinguishes "the CLI could not answer"
 * (`error`) from "the CLI answered with no stack"; phase 2 additionally needs
 * the exit status, stderr and timeout flag for start/stop/build handling.
 */
export interface SpawnResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set only when the CLI could not be spawned or timed out. */
  error: string | null;
  timedOut: boolean;
}

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

/**
 * Run the CLI from the checkout root. `supabase/config.toml` resolves APP_URL
 * through `env()`; an explicit APP_URL still wins, exactly like `scripts/dev`.
 *
 * Lifecycle commands pass their own child environment (cleared/pinned port
 * variables) and a longer timeout; read-only commands use the defaults.
 */
export function runSupabase(args: string[], options: SpawnOptions = {}): SpawnResult {
  const base = options.env ?? process.env;
  const appUrl = base.APP_URL || `http://localhost:${base.APP_PORT || '3000'}`;
  const result = spawnSync('bunx', ['supabase', ...args], {
    cwd: REPO_ROOT,
    env: { ...base, APP_URL: appUrl },
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  const timedOut = code === 'ETIMEDOUT';
  const status = result.status;
  let error: string | null = null;
  if (result.error) {
    error = result.error.message;
  } else if (status !== 0) {
    // A stopped stack exits 0 (identity + empty endpoints), so a non-zero exit
    // is a real CLI failure and must not be reported as an absent stack.
    error = `\`supabase ${args.join(' ')}\` exited with code ${status ?? 'unknown'}`;
  }
  return {
    ok: error === null,
    status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error,
    timedOut,
  };
}

function stackArgs(command: 'status' | 'list', stackName: string | null): string[] {
  const args = ['stack', command, '--output-format', 'json'];
  if (stackName) args.push('--stack', stackName);
  return args;
}

function parseStatus(parsed: JsonObject): StackStatus | null {
  const env = asObject(parsed.env) ?? {};
  const rawApiUrl = asString(env.API_URL);
  if (!rawApiUrl) return null;

  const identity = asObject(parsed.identity) ?? {};
  const endpoints = asObject(parsed.endpoints) ?? {};
  const drift = asObject(parsed.config_drift);
  const apiUrl = normalizeLocalhost(trimTrailingSlash(rawApiUrl));
  const studioUrl = asString(env.STUDIO_URL);
  const mailUrl = asString(env.MAILPIT_URL);
  const dbUrl = asString(env.DB_URL);

  return {
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
      realtime: endpointPort(endpoints, 'realtime.rpc'),
      analytics: endpointPort(endpoints, 'analytics.http'),
      edgeInspector: endpointPort(endpoints, 'functions.inspector'),
      pooler: endpointPort(endpoints, 'pooler.sql'),
      pgmeta: endpointPort(endpoints, 'pgmeta.http'),
    },
  };
}

function parseEnv(parsed: JsonObject): StackEnv {
  const env = asObject(parsed.env) ?? {};
  const apiUrl = asString(env.API_URL);
  return {
    apiUrl: apiUrl ? normalizeLocalhost(trimTrailingSlash(apiUrl)) : '',
    restUrl: asString(env.REST_URL),
    dbUrl: asString(env.DB_URL),
    anonKey: asString(env.ANON_KEY),
    serviceRoleKey: asString(env.SERVICE_ROLE_KEY),
    publishableKey: asString(env.PUBLISHABLE_KEY),
    secretKey: asString(env.SECRET_KEY),
    mailUrl: asString(env.MAILPIT_URL),
    studioUrl: asString(env.STUDIO_URL),
  };
}

function parseServices(parsed: JsonObject): string[] {
  const composition = asObject(parsed.composition);
  const members = composition?.members;
  if (Array.isArray(members)) {
    return members
      .map((member) => asString(asObject(member)?.service))
      .filter((service): service is string => service !== null);
  }
  const services = parsed.services;
  if (Array.isArray(services)) {
    return services
      .map((member) => asString(asObject(member)?.service))
      .filter((service): service is string => service !== null);
  }
  return [];
}

interface StackReadResult {
  read: StackRead | null;
  /** Spawn/timeout failure of the CLI itself; null means the CLI answered. */
  error: string | null;
}

/**
 * Parse a status response into the phase-2 read shape while keeping phase 1's
 * error distinction: `stack status` exits 0 for a stopped stack (identity +
 * empty endpoints, no API URL), so an absent stack and a broken CLI stay
 * distinguishable.
 */
function readStackWithError(stackName: string | null): StackReadResult {
  const { ok, stdout, error } = runSupabase(stackArgs('status', stackName));
  if (!ok) return { read: null, error };
  const parsed = parseJsonObject(stdout);
  if (!parsed) {
    // Exit 0 without a JSON object means a broken/truncated CLI (or a banner on
    // stdout), not a stopped stack — those still print identity JSON.
    return {
      read: null,
      error: '`supabase stack status --output-format json` did not return a JSON object',
    };
  }
  const status = parseStatus(parsed);
  if (!status) return { read: null, error: null };
  return {
    read: { status, env: parseEnv(parsed), services: parseServices(parsed) },
    error: null,
  };
}

export interface StackStatusProbe {
  /** The running stack, or null when it is stopped/unusable/absent. */
  stack: StackStatus | null;
  /** Spawn/timeout, non-zero exit or non-JSON stdout; null means it answered. */
  error: string | null;
}

/** Read-only probe used by `doctor`/`status` to distinguish "no stack" from "CLI broke". */
export function probeStackStatus(stackName: string | null): StackStatusProbe {
  const { read, error } = readStackWithError(stackName);
  return { stack: read?.status ?? null, error };
}

/**
 * The running stack plus the values needed by a child process. A status
 * response without an API URL describes a stopped/unusable stack (`scripts/dev`
 * treats it the same way), so it also yields null.
 */
export function readStack(stackName: string | null): StackRead | null {
  return readStackWithError(stackName).read;
}

export function readStackStatus(stackName: string | null): StackStatus | null {
  return readStack(stackName)?.status ?? null;
}

export interface ListedStack {
  id: string;
  name: string;
  projectRoot: string;
  branch: string | null;
  runtime: string | null;
  /** `reachable` when the stack's owner can be queried (running). */
  owner: string | null;
}

/**
 * Every stack `supabase stack list` knows about, or null when the CLI cannot be
 * read. Read-only: used to verify ownership before a stack-scoped stop and to
 * find a stopped stack's persisted runtime.
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
      owner: asString(stack.owner),
    });
  }
  return listed;
}

/** This checkout's stack entry from `stack list`, running or stopped. */
function readListedStack(
  stackName: string | null,
): { runtime: string | null; branch: string | null; id: string } | null {
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
  return hit ? { runtime: hit.runtime, branch: hit.branch, id: hit.id } : null;
}

/**
 * The persisted runtime of this checkout's stack, including a stopped one.
 * Identity is `project_root + name + branch_context`, the same match the CLI
 * itself uses.
 */
export function readListedStackRuntime(stackName: string | null): string | null {
  return readListedStack(stackName)?.runtime ?? null;
}
