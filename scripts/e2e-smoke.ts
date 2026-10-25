/**
 * Deterministic Playwright smoke gate (issue #459).
 *
 * The only automated page-level guard for #320 (standalone quiz open answers) is
 * `__tests__/e2e/student-quiz-open-answer.spec.ts`, which was invisible to every
 * gate. This script is the pre-push entry point (see `lefthook.yml`):
 *
 *   1. preflight — seeded local Supabase reachable, loopback-only, free port;
 *   2. quota reset — clear today's standalone attempts for the smoke student so
 *      the daily `max_quiz_attempts_per_day` (10) cannot turn the gate red;
 *   3. run — the single spec on Chromium/1 worker against *this* checkout.
 *
 * It never reuses a server on the default port: in a worktree the app on :3000
 * usually belongs to the main checkout, and reusing it would report green for
 * code that was never tested. `E2E_SMOKE_REUSE=1` + `PLAYWRIGHT_BASE_URL` is the
 * explicit opt-in (used by QA slots whose app already runs on its own port).
 *
 * Escape hatches: `SKIP_E2E_SMOKE=1` (lefthook skip condition) and
 * `E2E_SMOKE_KEEP_ATTEMPTS=1` (do not delete quiz attempts).
 */
import { connect } from 'node:net';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SPEC = '__tests__/e2e/student-quiz-open-answer.spec.ts';
const SMOKE_EMAIL = 'student-classroom@dev.local';
const DEFAULT_PORT = 3100;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function fail(lines: string | string[]): never {
  console.error('');
  for (const line of Array.isArray(lines) ? lines : [lines]) console.error(`  x ${line}`);
  console.error('');
  process.exit(1);
}

function note(message: string): void {
  console.log(`  - e2e-smoke: ${message}`);
}

function setupHints(): string[] {
  return [
    'start the seeded local stack (Classroom open questions + `quiz` on the base plan):',
    '    bunx supabase start && bunx supabase db reset',
    'install the Chromium build Playwright needs:',
    '    bunx playwright install chromium',
    'skip this gate once (documented in docs/testing.md):',
    '    SKIP_E2E_SMOKE=1 git push',
  ];
}

/** `null` when reachable, otherwise a short reason. */
async function supabaseHealth(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Best-effort: the spec creates one non-assignment attempt per run, and
 * `max_quiz_attempts_per_day` is 10 on the base plan, so the 11th push in a UTC
 * day would 429. Deletes only the seeded smoke student's attempts started today;
 * `quiz_attempt_questions` / `student_answers` go with the FK cascade.
 */
async function resetPracticeQuota(supabaseUrl: string): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    note(
      'SUPABASE_SERVICE_ROLE_KEY is not set — skipping the daily-quota reset; ' +
        'the 11th run today may fail with USAGE_LIMIT_EXCEEDED.',
    );
    return;
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(SMOKE_EMAIL)}&select=id`,
      { headers, signal: AbortSignal.timeout(5_000) },
    );
    if (!profileRes.ok) {
      note(`quota reset skipped — profiles lookup returned HTTP ${profileRes.status}.`);
      return;
    }
    const profiles = (await profileRes.json()) as Array<{ id: string }>;
    const userId = profiles[0]?.id;
    if (!userId) {
      note(`quota reset skipped — ${SMOKE_EMAIL} is not seeded; run \`bunx supabase db reset\`.`);
      return;
    }

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const deleteRes = await fetch(
      `${supabaseUrl}/rest/v1/quiz_attempts` +
        `?user_id=eq.${userId}&assignment_id=is.null` +
        `&started_at=gte.${encodeURIComponent(dayStart.toISOString())}&select=id`,
      {
        method: 'DELETE',
        headers: { ...headers, Prefer: 'return=representation' },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!deleteRes.ok) {
      note(`quota reset skipped — attempt cleanup returned HTTP ${deleteRes.status}.`);
      return;
    }
    const removed = (await deleteRes.json()) as Array<{ id: string }>;
    if (removed.length > 0) {
      console.log(
        `  - e2e-smoke: cleared ${removed.length} practice attempt(s) (daily quiz quota) for ${SMOKE_EMAIL}`,
      );
    }
  } catch (error) {
    note(`quota reset skipped — ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function portIsFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (free: boolean) => {
      socket.destroy();
      resolve(free);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.setTimeout(1_000, () => finish(true));
  });
}

// ---------------------------------------------------------------------------
// 1. Preflight
// ---------------------------------------------------------------------------

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if (!rawSupabaseUrl) {
  fail([
    'NEXT_PUBLIC_SUPABASE_URL is missing.',
    'A worktree needs its own .env, exactly like `bun dev` does:',
    '    cp <main-checkout>/.env .env',
    '    cp <main-checkout>/apps/web/.env apps/web/.env',
  ]);
}

let supabaseUrl: string;
try {
  supabaseUrl = new URL(rawSupabaseUrl).origin;
} catch {
  fail(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${rawSupabaseUrl}`);
}

const hostname = new URL(supabaseUrl).hostname;
if (!LOCAL_HOSTS.has(hostname) && process.env.E2E_SMOKE_ALLOW_REMOTE !== '1') {
  fail([
    `refusing to run against a non-local Supabase (${hostname}).`,
    'The smoke writes and deletes quiz attempts, so it is loopback-only by design.',
    'Override deliberately with E2E_SMOKE_ALLOW_REMOTE=1 if you really mean it.',
  ]);
}

const healthError = await supabaseHealth(supabaseUrl);
if (healthError !== null) {
  fail([`local Supabase is not reachable at ${supabaseUrl} (${healthError}).`, ...setupHints()]);
}

// ---------------------------------------------------------------------------
// 2. Daily-quota reset + port ownership
// ---------------------------------------------------------------------------

if (process.env.E2E_SMOKE_KEEP_ATTEMPTS === '1') {
  note("E2E_SMOKE_KEEP_ATTEMPTS=1 — keeping today's quiz attempts.");
} else {
  await resetPracticeQuota(supabaseUrl);
}

const reuse = process.env.E2E_SMOKE_REUSE === '1';
const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
let port: number | undefined;
let baseURL: string;

if (reuse) {
  if (!configuredBaseUrl) {
    fail([
      'E2E_SMOKE_REUSE=1 requires PLAYWRIGHT_BASE_URL to point at the running app.',
      'Example (QA slot): E2E_SMOKE_REUSE=1 PLAYWRIGHT_BASE_URL=http://localhost:3015 bun run test:e2e:smoke',
    ]);
  }
  baseURL = configuredBaseUrl.replace(/\/$/, '');
  note(`reusing the running app at ${baseURL} (E2E_SMOKE_REUSE=1).`);
} else {
  const rawPort = process.env.E2E_SMOKE_PORT ?? process.env.PLAYWRIGHT_PORT ?? `${DEFAULT_PORT}`;
  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    fail(`E2E_SMOKE_PORT / PLAYWRIGHT_PORT is not a valid port: ${rawPort}`);
  }
  if (!(await portIsFree(parsedPort))) {
    fail([
      `port ${parsedPort} is already in use, and the smoke never reuses another checkout's server.`,
      `pick a free port:  E2E_SMOKE_PORT=3110 bun run test:e2e:smoke`,
      'or reuse the app you are already running:',
      `    E2E_SMOKE_REUSE=1 PLAYWRIGHT_BASE_URL=http://localhost:<port> bun run test:e2e:smoke`,
    ]);
  }
  port = parsedPort;
  baseURL = `http://localhost:${port}`;
  note(`starting a dedicated dev server on :${port} for this checkout.`);
}

// ---------------------------------------------------------------------------
// 3. Run the deterministic spec
// ---------------------------------------------------------------------------

const childEnv: Record<string, string | undefined> = {
  ...process.env,
  PLAYWRIGHT_BASE_URL: baseURL,
  PLAYWRIGHT_REUSE_SERVER: reuse ? '1' : '0',
  PORT: port === undefined ? process.env.PORT : `${port}`,
};
if (port === undefined) {
  delete childEnv.PLAYWRIGHT_PORT;
} else {
  childEnv.PLAYWRIGHT_PORT = `${port}`;
}

const child = Bun.spawn(
  [
    'bunx',
    'playwright',
    'test',
    SPEC,
    '--project=chromium',
    '--workers=1',
    '--reporter=line',
    // `trace: 'on-first-retry'` never fires outside CI (retries = 0), so force a
    // retained trace to keep the failure hint below actionable.
    '--trace=retain-on-failure',
    '--forbid-only',
  ],
  {
    cwd: ROOT,
    env: childEnv,
    stdio: ['inherit', 'inherit', 'inherit'],
  },
);

const exitCode = await child.exited;
if (exitCode !== 0) {
  fail([
    `Playwright failed (exit ${exitCode}).`,
    'open the trace of the failed run:',
    '    bunx playwright show-trace test-results/**/trace.zip',
    ...setupHints(),
  ]);
}

console.log(`✓ e2e smoke passed — ${SPEC} (chromium) against ${baseURL}`);
