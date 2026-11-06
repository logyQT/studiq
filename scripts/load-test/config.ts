/**
 * Shared configuration + helpers for the StudiQ load-test tooling.
 *
 * Two entrypoints use this module:
 *   - scripts/load-test/seed.ts  → creates the account pool via the Supabase Admin API
 *   - scripts/load-test/bots.ts  → drives concurrent "bot" users against the running app
 *
 * Everything is dependency-free (Bun + Node builtins + global fetch). Bun
 * auto-loads `.env` / `.env.local`, so any value below can be overridden by an
 * env var of the same name; otherwise the values `scripts/dev` writes to
 * `apps/web/.env`, or the well-known local Supabase defaults, are used.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export type AccountType = 'student' | 'educator' | 'manager';

export interface AccountRecord {
  index: number;
  email: string;
  password: string;
  accountType: AccountType;
  name: string;
}

export interface LoadTestConfig {
  /** Supabase API base (Auth + REST), e.g. http://127.0.0.1:54321 */
  supabaseUrl: string;
  /** Anon/publishable key — used for direct Auth calls if ever needed. */
  anonKey: string;
  /** Service-role key — used for Admin API user provisioning. */
  serviceRoleKey: string;
  /** Next.js app base URL the bots talk to, e.g. http://localhost:3000 */
  appUrl: string;
  /** Directory for generated artifacts (account pool, run reports). */
  outDir: string;
  /** Account-pool file produced by seed.ts and consumed by bots.ts. */
  accountsFile: string;
  /** Password assigned to every seeded account. */
  password: string;
  /** Email domain used for seeded accounts (also used for --reset cleanup). */
  emailDomain: string;
}

/** supabase start defaults (legacy JWTs) — safe to hardcode for local dev. */
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function parsePort(raw: string | null | undefined): number | null {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port > 0 && port <= 65535 ? port : null;
}

/** A valid port from the environment, or null when unset/blank/invalid. */
function envPort(name: string): number | null {
  return parsePort(process.env[name]);
}

const ROOT = join(import.meta.dir, '..', '..');
const WEB_ENV = join(ROOT, 'apps', 'web', '.env');

/**
 * Value from the generated `apps/web/.env` (what the app itself uses). Stack
 * mode writes the discovered URLs/keys there, so it is the primary source for
 * the load-test harness too. Missing file/key is fine.
 */
function webValue(name: string): string | null {
  try {
    const raw = readFileSync(WEB_ENV, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0 || trimmed.slice(0, eq).trim() !== name) continue;
      return trimmed.slice(eq + 1).trim();
    }
  } catch {
    /* no generated app env yet */
  }
  return null;
}

function liveApiHealth(url: string): ImplicitTargetCheck {
  try {
    execFileSync(
      'curl',
      ['-sf', '--max-time', '2', '-o', '/dev/null', `${url.replace(/\/$/, '')}/auth/v1/health`],
      { stdio: 'ignore', timeout: 10_000 },
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: `no healthy Supabase API at ${url}` };
  }
}

/** Current branch, or null on a detached HEAD. */
function currentBranch(): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}

/** Fresh `supabase status --output-format json`, or null when it cannot answer. */
function freshStackStatus(): Record<string, unknown> | null {
  try {
    const stack = process.env.SUPABASE_STACK?.trim();
    const args = ['supabase', 'status', '--output-format', 'json'];
    if (stack) args.push('--stack', stack);
    const raw = execFileSync('bunx', args, {
      cwd: ROOT,
      env: { ...process.env, SUPABASE_EXPERIMENTAL_STACK: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
    });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI status JSON; fields are checked below
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Prove a generated `apps/web/.env` URL still belongs to this checkout, branch
 * and named stack before destructive seeding. A branch switch can leave the old
 * URL (and service-role key) in the file while the old stack stays healthy.
 */
function stackIdentityMatches(generatedUrl: string): ImplicitTargetCheck | null {
  const status = freshStackStatus();
  if (!status) return null;

  const identity = status.identity;
  if (!identity || typeof identity !== 'object') return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI stack identity; fields are type-checked below
  const fields = identity as Record<string, unknown>;
  const projectRoot = typeof fields.project_root === 'string' ? fields.project_root : '';
  const branchContext = typeof fields.branch_context === 'string' ? fields.branch_context : '';
  const stackName = typeof fields.name === 'string' ? fields.name : '';

  let actualRoot: string;
  let expectedRoot: string;
  try {
    actualRoot = realpathSync(projectRoot);
    expectedRoot = realpathSync(ROOT);
  } catch {
    return {
      ok: false,
      reason: `cannot resolve the generated stack's project root (${projectRoot})`,
    };
  }
  if (actualRoot !== expectedRoot) {
    return { ok: false, reason: `generated target belongs to ${actualRoot}, not ${expectedRoot}` };
  }

  const branch = currentBranch();
  const actualBranch = branchContext.replace(/^refs\/heads\//, '');
  if (branch && actualBranch && actualBranch !== branch) {
    return {
      ok: false,
      reason: `generated target belongs to branch ${actualBranch}, not ${branch}`,
    };
  }

  const expectedName = process.env.SUPABASE_STACK?.trim() || 'default';
  if (stackName && stackName !== expectedName) {
    return {
      ok: false,
      reason: `generated target belongs to stack ${stackName}, not ${expectedName}`,
    };
  }

  const envMap = status.env;
  const apiUrl =
    envMap &&
    typeof envMap === 'object' &&
    'API_URL' in envMap &&
    typeof envMap.API_URL === 'string'
      ? envMap.API_URL
      : '';
  if (!apiUrl) return null;
  if (apiUrl.replace(/\/$/, '') !== generatedUrl.replace(/\/$/, '')) {
    return { ok: false, reason: `CLI reports ${apiUrl}, but apps/web/.env has ${generatedUrl}` };
  }

  return { ok: true };
}

export type ImplicitTargetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Seeding writes accounts, so an implicit target read from `apps/web/.env` must
 * be loopback. Stack-mode targets (STUDIQ_STACK_MODE=1) additionally re-check
 * the fresh CLI identity (project root, branch, stack name, API URL). Non-stack
 * and shared targets must pass `--supabase-url` / `SUPABASE_URL`.
 */
export function implicitTargetOwnership(): ImplicitTargetCheck {
  if (env('SUPABASE_URL', '')) return { ok: true };

  // Stack mode: `apps/web/.env` is generated by `scripts/dev` for this
  // checkout's stack. Check its fresh identity (root + branch + name) before a
  // destructive seed/reset; a branch switch can leave a stale URL behind.
  const generatedUrl = webValue('NEXT_PUBLIC_SUPABASE_URL');
  if (generatedUrl) {
    try {
      const url = new URL(generatedUrl);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        return { ok: false, reason: `generated API URL is not loopback: ${generatedUrl}` };
      }
    } catch {
      return { ok: false, reason: `generated API URL is invalid: ${generatedUrl}` };
    }
    if (webValue('STUDIQ_STACK_MODE') === '1') {
      const identity = stackIdentityMatches(generatedUrl) ?? {
        ok: false as const,
        reason: 'cannot read fresh supabase status to verify the generated stack identity',
      };
      if (!identity.ok) return identity;
      return liveApiHealth(generatedUrl);
    }
    return {
      ok: false,
      reason:
        'apps/web/.env is not stack-generated (STUDIQ_STACK_MODE missing) — pass --supabase-url / SUPABASE_URL for a shared or non-stack target',
    };
  }

  return {
    ok: false,
    reason:
      'no generated stack target (run a bun dev:* command) — or pass --supabase-url / SUPABASE_URL explicitly',
  };
}

export function resolveConfig(overrides: Partial<LoadTestConfig> = {}): LoadTestConfig {
  const outDir = overrides.outDir ?? env('LOADTEST_DIR', '.dev/load-test');
  const emailDomain =
    overrides.emailDomain ?? env('LOADTEST_EMAIL_DOMAIN', 'loadtest.studiq.local');
  // No fixed-port derivation: stack mode supplies apps/web/.env, and
  // SUPABASE_API_PORT is the non-stack/CI escape hatch. Defaults are
  // 3000 and 54321 when nothing is configured.
  const appPort = envPort('APP_PORT') ?? 3000;
  // Stack mode writes the real URL to apps/web/.env; explicit env still wins.
  // SUPABASE_API_PORT is the non-stack/CI escape hatch.
  const supabaseApiPort = envPort('SUPABASE_API_PORT') ?? 54321;
  const generatedSupabaseUrl = webValue('NEXT_PUBLIC_SUPABASE_URL');
  const generatedAppUrl = webValue('NEXT_PUBLIC_SITE_URL');
  return {
    supabaseUrl:
      overrides.supabaseUrl ??
      env('SUPABASE_URL', generatedSupabaseUrl ?? `http://127.0.0.1:${supabaseApiPort}`),
    anonKey:
      overrides.anonKey ??
      env('SUPABASE_ANON_KEY', webValue('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? LOCAL_ANON_KEY),
    serviceRoleKey:
      overrides.serviceRoleKey ??
      env(
        'SUPABASE_SERVICE_ROLE_KEY',
        webValue('SUPABASE_SERVICE_ROLE_KEY') ?? LOCAL_SERVICE_ROLE_KEY,
      ),
    appUrl: overrides.appUrl ?? env('APP_URL', generatedAppUrl ?? `http://localhost:${appPort}`),
    outDir,
    accountsFile: overrides.accountsFile ?? `${outDir}/accounts.json`,
    password: overrides.password ?? env('LOADTEST_PASSWORD', 'Password123!'),
    emailDomain,
  };
}

// ── Tiny argv parser ────────────────────────────────────────────────────────
// Supports: --key value | --key=value | --flag (boolean) | --no-flag
export type Args = Map<string, string | boolean>;

export function parseArgs(argv = process.argv.slice(2)): Args {
  const args: Args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    if (body.startsWith('no-')) {
      args.set(body.slice(3), false);
      continue;
    }
    const eq = body.indexOf('=');
    if (eq >= 0) {
      args.set(body.slice(0, eq), body.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args.set(body, argv[i + 1]);
      i++;
    } else {
      args.set(body, true);
    }
  }
  return args;
}

export function argNum(args: Args, key: string, fallback: number): number {
  const value = args.get(key);
  if (value === undefined || value === true || value === false) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function argStr(args: Args, key: string, fallback: string): string {
  const value = args.get(key);
  return typeof value === 'string' ? value : fallback;
}

export function argBool(args: Args, key: string, fallback = false): boolean {
  const value = args.get(key);
  if (value === undefined) return fallback;
  return value !== false && value !== 'false';
}

// ── Small utilities ─────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` over `items` with a bounded number of concurrent workers. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Deterministic PRNG (mulberry32) so runs are reproducible with the same --seed. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

// ── App HTTP client (cookie-aware) ──────────────────────────────────────────

export interface ApiResult<T = unknown> {
  action: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  ms: number;
  /** The `x-trace-id` response header — the Tempo trace id for this request. */
  traceId: string | null;
  body: T | null;
}

export class AppClient {
  private jar = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  get cookieCount(): number {
    return this.jar.size;
  }

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private capture(res: Response): void {
    const setCookies =
      typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = /max-age=0|expires=Thu, 01 Jan 1970/i.test(cookie);
      if (!value || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; action?: string } = {},
  ): Promise<ApiResult<T>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.jar.size > 0) headers.Cookie = this.cookieHeader();

    const action = init.action ?? `${method} ${path}`;
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual',
      });
    } catch (error) {
      return {
        action,
        method,
        path,
        status: 0,
        ok: false,
        ms: performance.now() - t0,
        traceId: null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- API error bodies are typed by the caller at this boundary
        body: { networkError: String(error) } as T,
      };
    }

    this.capture(res);
    const ms = performance.now() - t0;
    const traceId = res.headers.get('x-trace-id');

    let body: T | null;
    try {
      const text = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON response body, typed by the caller at this boundary
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }

    return { action, method, path, status: res.status, ok: res.ok, ms, traceId, body };
  }

  get<T = unknown>(path: string, action?: string): Promise<ApiResult<T>> {
    return this.request<T>('GET', path, { action });
  }

  post<T = unknown>(path: string, body: unknown, action?: string): Promise<ApiResult<T>> {
    return this.request<T>('POST', path, { body, action });
  }

  /** Log in through the app so the returned Supabase cookies land in the jar. */
  login(email: string, password: string): Promise<ApiResult> {
    return this.post('/api/v1/auth/login', { email, password }, 'auth.login');
  }

  logout(): Promise<ApiResult> {
    return this.post('/api/v1/auth/logout', {}, 'auth.logout');
  }
}

// ── Response shape helpers ──────────────────────────────────────────────────

/** Lists come back as `{ data: { items: [...] } }`, `{ data: [...] }` or `{ data: { decks } }`. */
export function extractItems(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Array.isArray proves the list; members are read as records
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- plain object check above; keys are probed below
    const obj = data as Record<string, unknown>;
    for (const key of ['items', 'decks', 'topics', 'cards', 'flashcards', 'banks']) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Array.isArray proves the list; members are read as records
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export function idOf(item: Record<string, unknown> | undefined): string | null {
  if (!item) return null;
  const id = item.id ?? item.flashcardId ?? item.uuid;
  return typeof id === 'string' ? id : null;
}

// ── Stats collection ────────────────────────────────────────────────────────

export class Stats {
  readonly perAction = new Map<
    string,
    { count: number; ok: number; err: number; totalMs: number }
  >();
  readonly statuses = new Map<number, number>();
  readonly latencies: number[] = [];
  readonly failingTraces: { traceId: string; action: string; status: number }[] = [];
  total = 0;
  errors = 0;
  networkErrors = 0;
  /** How many responses carried an `x-trace-id` header (observability wiring). */
  withTraceId = 0;

  record(result: ApiResult): void {
    this.total++;
    if (result.traceId) this.withTraceId++;
    const bucket = this.perAction.get(result.action) ?? { count: 0, ok: 0, err: 0, totalMs: 0 };
    bucket.count++;
    bucket.totalMs += result.ms;
    if (result.ok) bucket.ok++;
    else bucket.err++;
    this.perAction.set(result.action, bucket);

    this.statuses.set(result.status, (this.statuses.get(result.status) ?? 0) + 1);
    this.latencies.push(result.ms);

    if (!result.ok) {
      this.errors++;
      if (result.status === 0) this.networkErrors++;
      if (result.traceId && this.failingTraces.length < 25) {
        this.failingTraces.push({
          traceId: result.traceId,
          action: result.action,
          status: result.status,
        });
      }
    }
  }

  recordMany(results: ApiResult[]): void {
    for (const result of results) this.record(result);
  }

  percentile(p: number): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].toSorted((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index];
  }
}
