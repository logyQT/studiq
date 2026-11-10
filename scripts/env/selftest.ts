#!/usr/bin/env bun
/**
 * Lean phase-2 lifecycle gate. Creates one scratch stack, drives the real CLI,
 * then stops/destroys only that stack.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DEV_DIR, identityKey, readStackState } from './lib/state';
import { REPO_ROOT, isThisCheckout, currentBranchRef } from './lib/repo';
import { resolveRegistryDir } from './lib/registry';
import { leaseProjectId, releaseProjectClaims } from './lib/lease';
import { readWebPid, stopWebServer } from './lib/web';

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

const passed: string[] = [];
const failures: string[] = [];
let scratchName = '';
let tempDir = '';
let traceFile = '';

function check(ok: boolean, message: string): void {
  if (ok) {
    passed.push(message);
    console.log(`  ✔ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✘ ${message}`);
  }
  if (!ok) throw new Error(message);
}

function json(result: RunResult): Record<string, unknown> {
  const value: unknown = JSON.parse(result.stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected one JSON object');
  }
  return value as Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function number(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
function tail(result: RunResult): string {
  return result.stderr.trim().split('\n').slice(-3).join(' | ').slice(-400);
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    'SUPABASE_SHARED',
    'SUPABASE_SHARED_OWNER',
    'APP_PORT',
    'APP_URL',
    'NEXT_PUBLIC_SITE_URL',
    'SUPABASE_URL',
    'SUPABASE_DB_URL',
    'SUPABASE_API_PORT',
    'SUPABASE_DB_PORT',
    'SUPABASE_RUNTIME',
  ]) {
    delete env[name];
  }
  return env;
}

function run(args: string[], extraEnv: Record<string, string | undefined> = {}): RunResult {
  const start = performance.now();
  const result = spawnSync('bun', ['run', ...args], {
    cwd: REPO_ROOT,
    env: {
      ...baseEnv(),
      PATH: `${join(tempDir, 'bin')}:${process.env.PATH ?? ''}`,
      ENV_TRACE_FILE: traceFile,
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ms: Math.round(performance.now() - start),
  };
}

function trace(): string[] {
  try {
    return readFileSync(traceFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
function calls(needle: string): number {
  return trace().filter((line) => line.includes(needle)).length;
}
function clearTrace(): void {
  writeFileSync(traceFile, '');
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)] ?? 0;
}

function leases(): Array<Record<string, unknown>> {
  const dir = resolveRegistryDir();
  if (!existsSync(dir)) return [];
  const result: Array<Record<string, unknown>> = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('env-') || !name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed && typeof parsed === 'object') result.push(parsed as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }
  return result;
}
function scratchLeases(): Array<Record<string, unknown>> {
  return leases().filter((lease) => lease.stackName === scratchName);
}

function scratchProjectId(): string {
  return leaseProjectId(identityKey(REPO_ROOT, currentBranchRef(), scratchName));
}

/** Port claims this scratch stack still holds in the shared registry. */
function scratchClaims(): Array<Record<string, unknown>> {
  const dir = join(resolveRegistryDir(), 'claims');
  if (!existsSync(dir)) return [];
  const projectId = scratchProjectId();
  const claims: Array<Record<string, unknown>> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.claim')) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).projectId === projectId
      ) {
        claims.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }
  }
  return claims;
}

function scanSecrets(label: string, text: string): void {
  const patterns = [
    /eyJ[A-Za-z0-9_-]{10,}/,
    /ANON_KEY/,
    /SERVICE_ROLE_KEY/,
    /sb_secret_/,
    /postgres:[^@\s"']+@/,
  ];
  check(!patterns.some((pattern) => pattern.test(text)), `${label}: no secrets`);
}

interface SharedScratchEnv {
  SUPABASE_SHARED: string;
  SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_MAIL_URL: string;
}

/**
 * Shared-stack values for this run's own scratch stack, read from its status:
 * a shared-mode `ensure` only borrows a stack, so it must be told where it is.
 */
function sharedScratchEnv(): SharedScratchEnv | null {
  const result = spawnSync(
    'bunx',
    ['supabase', 'stack', 'status', '--output-format', 'json', '--stack', scratchName],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) return null;
  try {
    const parsed = object(JSON.parse(result.stdout));
    const env = object(parsed.env);
    const mailPort = number(object(object(parsed.endpoints)['mail.http']).port);
    const mailUrl = string(env.MAILPIT_URL) || (mailPort ? `http://127.0.0.1:${mailPort}` : '');
    const apiUrl = string(env.API_URL);
    const anonKey = string(env.ANON_KEY);
    if (!apiUrl || !anonKey || !mailUrl) return null;
    return {
      SUPABASE_SHARED: '1',
      SUPABASE_URL: apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_MAIL_URL: mailUrl,
    };
  } catch {
    return null;
  }
}

function destroyScratch(): void {
  const listed = spawnSync('bunx', ['supabase', 'stack', 'list', '--output-format', 'json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (listed.status === 0) {
    try {
      const parsed = JSON.parse(listed.stdout) as { stacks?: Array<Record<string, unknown>> };
      const mine = parsed.stacks?.find(
        (stack) => stack.name === scratchName && isThisCheckout(string(stack.project_root)),
      );
      if (mine) {
        spawnSync('bunx', ['supabase', 'stack', 'destroy', '--stack', scratchName, '--yes'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 180_000,
        });
      }
    } catch {
      /* leave */
    }
  }
  // Only this run's attribution may be removed: a `stack.json` naming another
  // stack belongs to the operator's session, not to this run.
  if (readStackState()?.stackName === scratchName) {
    rmSync(join(DEV_DIR, 'stack.json'), { force: true });
  }
  for (const lease of scratchLeases()) {
    rmSync(join(resolveRegistryDir(), `${string(lease.projectId)}.json`), { force: true });
  }
  releaseProjectClaims(resolveRegistryDir(), scratchProjectId());
}

async function main(): Promise<number> {
  // `finally` stops this checkout's web server; one that was already up belongs
  // to the operator, so refuse before creating anything.
  const runningWeb = readWebPid();
  if (runningWeb) {
    console.error(
      `env:selftest: this checkout's web server is already running (pid ${runningWeb}); run 'bun env:down' first`,
    );
    return 1;
  }
  scratchName = `env-selftest-${process.pid}-${Date.now().toString(36)}`;
  tempDir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'studiq-env-selftest-'));
  const shimDir = join(tempDir, 'bin');
  mkdirSync(shimDir, { recursive: true, mode: 0o700 });
  traceFile = join(tempDir, 'bunx.log');
  writeFileSync(traceFile, '');
  const realBunx = spawnSync('bash', ['-lc', 'command -v bunx'], {
    encoding: 'utf8',
  }).stdout?.trim();
  if (!realBunx) throw new Error('bunx not found');
  const shim = join(shimDir, 'bunx');
  writeFileSync(
    shim,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "\${ENV_TRACE_FILE:?}"\nexec "${realBunx}" "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(shim, 0o755);

  const appPort = await freePort();
  const childEnv: Record<string, string | undefined> = {
    SUPABASE_STACK: scratchName,
    APP_PORT: String(appPort),
    APP_URL: `http://localhost:${appPort}`,
    APP_ENV: 'development',
    STUDIQ_STACK_MODE: '1',
  };
  console.log(`env:selftest — scratch stack '${scratchName}' on app port ${appPort}`);

  try {
    clearTrace();
    const cold = run(['env:ensure', '--profile', 'api', '--json'], childEnv);
    check(cold.code === 0, `cold api ensure exits 0 (${cold.code}: ${tail(cold)})`);
    const coldJson = json(cold);
    check(
      coldJson.cold === true && coldJson.runtime === 'native',
      'cold api ensure reports cold:true and native runtime',
    );
    check(
      string(object(coldJson.stack).projectRoot) === REPO_ROOT &&
        string(coldJson.profile) === 'api',
      'stack belongs to this checkout with profile api',
    );
    check(calls('stack start') === 1, 'exactly one stack start');
    scanSecrets('cold JSON', cold.stdout);

    clearTrace();
    const warmTimes: number[] = [];
    let warmColdSeen = false;
    for (let i = 0; i < 10; i += 1) {
      const warm = run(['env:ensure', '--profile', 'api', '--json'], childEnv);
      if (warm.code !== 0) throw new Error(`warm ensure failed: ${warm.stderr}`);
      warmTimes.push(warm.ms);
      if (json(warm).cold === true) warmColdSeen = true;
    }
    console.log(
      `    warm p50 ${percentile(warmTimes, 0.5)}ms, p95 ${percentile(warmTimes, 0.95)}ms`,
    );
    check(!warmColdSeen, 'warm ensure reports cold:false on all 10 runs');
    check(calls('stack start') === 0, 'warm ensure does not restart the stack');

    clearTrace();
    const conflict = run(['env:ensure', '--profile', 'web', '--json'], childEnv);
    check(
      conflict.code === 6 && /mail/.test(conflict.stderr) && /env:down --all/.test(conflict.stderr),
      'missing capability exits 6 with down --all guidance',
    );

    const downAll = run(['env:down', '--all', '--yes', '--json'], childEnv);
    check(
      downAll.code === 0 && scratchLeases().length === 0 && scratchClaims().length === 0,
      'down --all releases the lease and its app-port claim',
    );

    clearTrace();
    const web = run(['env:ensure', '--profile', 'web', '--json'], childEnv);
    check(web.code === 0, `cold web ensure exits 0 (${web.code}: ${tail(web)})`);
    const webJson = json(web);
    check(number(object(webJson.web).http) === 200, 'web serves HTTP 200');

    const named = run(
      ['env:ensure', '--profile', 'web', '--stack', `${scratchName}-other`, '--json'],
      childEnv,
    );
    check(
      named.code === 6 && Array.isArray(json(named).warnings),
      'second named stack exits 6 with valid JSON',
    );

    const oldPid = readWebPid();
    const handover = run(['env:ensure', '--profile', 'web', '--force-build', '--json'], childEnv);
    check(
      handover.code === 0 && readWebPid() !== null && readWebPid() !== oldPid,
      'same-stack handover replaces the web PID',
    );

    const sharedStatus = run(['env:status', '--json'], {
      ...childEnv,
      SUPABASE_SHARED: '1',
      SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:1',
    });
    check(sharedStatus.code === 0, 'shared status exits 0');
    const sharedDown = run(['env:down', '--all'], { ...childEnv, SUPABASE_SHARED: '1' });
    check(sharedDown.code === 6, 'shared down --all exits 6');

    const firstDown = run(['env:down'], childEnv);
    const secondDown = run(['env:down'], childEnv);
    check(
      firstDown.code === 0 && secondDown.code === 0 && scratchLeases().length === 1,
      'plain down is idempotent and keeps the lease',
    );

    // ---- phase-3 surface: serve / reset-db / logs / setup / verify / dev ----
    const served = run(['env:serve', '--json'], childEnv);
    check(served.code === 0, `env:serve exits 0 (${served.code}: ${tail(served)})`);
    check(
      number(object(json(served).web).http) === 200,
      'env:serve reports the existing build serving HTTP 200',
    );
    scanSecrets('serve JSON', served.stdout);

    const reset = run(['env:reset-db', '--yes', '--json'], childEnv);
    check(reset.code === 0, `env:reset-db --yes exits 0 (${reset.code}: ${tail(reset)})`);
    const sharedReset = run(['env:reset-db', '--yes'], { ...childEnv, SUPABASE_SHARED: '1' });
    check(sharedReset.code === 6, 'shared env:reset-db exits 6');

    const logs = run(['env:logs', '--no-follow'], childEnv);
    check(
      logs.code === 0 && /\.dev\/web\.log/.test(`${logs.stderr}${logs.stdout}`),
      'env:logs --no-follow prints the web log path without following',
    );

    const verify = run(['env:verify', '--json'], childEnv);
    check(
      (verify.code === 0 || verify.code === 1) &&
        Array.isArray(json(verify).missingKeys) &&
        typeof object(json(verify).vault).present === 'boolean',
      'env:verify --json reports key names and the optional vault, never a value',
    );
    // Key *names* are the report (that is the contract), so only values are a
    // leak: a JWT, a publishable/secret key value or a credentialed DB URL.
    check(
      !/eyJ[A-Za-z0-9_-]{10,}|sb_(?:secret|publishable)_|postgres(?:ql)?:\/\/[^@\s"]+@/.test(
        verify.stdout,
      ),
      'env:verify JSON carries key names only (no values)',
    );

    const devHelp = run(['env:dev', '--help'], childEnv);
    check(
      devHelp.code === 0 && /env:dev/.test(devHelp.stdout),
      'env:dev --help documents the human-only HMR command',
    );
    const devAdmin = run(['env:dev', '--admin'], childEnv);
    check(devAdmin.code === 2, 'env:dev --admin is refused (admin HMR is deferred)');

    const envLocal = join(REPO_ROOT, '.env.local');
    if (existsSync(envLocal)) {
      console.log('    (env:setup scaffold check skipped: the operator has .env.local)');
    } else {
      const setup = run(['env:setup'], childEnv);
      const created = existsSync(envLocal);
      const mode = created ? statSync(envLocal).mode & 0o777 : 0;
      check(
        setup.code === 0 && created && mode === 0o600,
        'env:setup scaffolds .env.local (mode 600) when absent',
      );
      if (created) {
        const scaffold = readFileSync(envLocal, 'utf8');
        check(
          scaffold.split('\n').every((line) => line.trim() === '' || line.trim().startsWith('#')),
          'env:setup writes comments only (never a value)',
        );
        const second = run(['env:setup'], childEnv);
        check(
          second.code === 0 && readFileSync(envLocal, 'utf8') === scaffold,
          'env:setup is idempotent without --force',
        );
        rmSync(envLocal, { force: true });
      }
    }

    const serveDown = run(['env:down'], childEnv);
    check(
      serveDown.code === 0,
      `plain down stops the server env:serve started (${tail(serveDown)})`,
    );

    // Two shared-mode web ensures against this run's own stack, with no
    // attribution to start from: the first must record the server it starts and
    // the second must still run — the build below must not be refused either.
    const sharedWeb = sharedScratchEnv();
    if (sharedWeb) {
      rmSync(join(DEV_DIR, 'stack.json'), { force: true });
      const sharedEnv = { ...childEnv, ...sharedWeb };
      const sharedFirst = run(['env:ensure', '--profile', 'web', '--json'], sharedEnv);
      check(
        sharedFirst.code === 0,
        `first shared web ensure exits 0 (${sharedFirst.code}: ${tail(sharedFirst)})`,
      );
      const sharedSecond = run(['env:ensure', '--profile', 'web', '--json'], sharedEnv);
      check(
        sharedSecond.code === 0,
        `second shared web ensure exits 0 (${sharedSecond.code}: ${tail(sharedSecond)})`,
      );
    } else {
      console.log('    (shared web ensures skipped: status has no API/mail endpoints)');
    }

    const preBuildDown = run(['env:down'], childEnv);
    check(preBuildDown.code === 0, `plain down before the explicit build (${tail(preBuildDown)})`);

    clearTrace();
    const build = run(['env:build', '--json'], childEnv);
    check(build.code === 0, `explicit build exits 0 (${build.code}: ${tail(build)})`);
  } finally {
    stopWebServer();
    destroyScratch();
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`\nenv:selftest — ${passed.length} passed, ${failures.length} failed`);
  return failures.length ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`env:selftest: ${error instanceof Error ? error.message : String(error)}`);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  process.exitCode = 1;
}
