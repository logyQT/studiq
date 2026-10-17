/**
 * Shared configuration + helpers for the StudiQ load-test tooling.
 *
 * Two entrypoints use this module:
 *   - scripts/load-test/seed.ts  → creates the account pool via the Supabase Admin API
 *   - scripts/load-test/bots.ts  → drives concurrent "bot" users against the running app
 *
 * Everything is dependency-free (Bun + global fetch). Bun auto-loads `.env` /
 * `.env.local`, so any value below can be overridden by an env var of the same
 * name; otherwise the well-known local Supabase defaults are used.
 */

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
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export function resolveConfig(overrides: Partial<LoadTestConfig> = {}): LoadTestConfig {
  const outDir = overrides.outDir ?? env('LOADTEST_DIR', '.dev/load-test');
  const emailDomain =
    overrides.emailDomain ?? env('LOADTEST_EMAIL_DOMAIN', 'loadtest.studiq.local');
  return {
    supabaseUrl: overrides.supabaseUrl ?? env('SUPABASE_URL', LOCAL_SUPABASE_URL),
    anonKey: overrides.anonKey ?? env('SUPABASE_ANON_KEY', LOCAL_ANON_KEY),
    serviceRoleKey:
      overrides.serviceRoleKey ?? env('SUPABASE_SERVICE_ROLE_KEY', LOCAL_SERVICE_ROLE_KEY),
    appUrl: overrides.appUrl ?? env('APP_URL', 'http://localhost:3000'),
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
        body: { networkError: String(error) } as T,
      };
    }

    this.capture(res);
    const ms = performance.now() - t0;
    const traceId = res.headers.get('x-trace-id');

    let body: T | null = null;
    try {
      const text = await res.text();
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
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['items', 'decks', 'topics', 'cards', 'flashcards', 'banks']) {
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
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index];
  }
}
