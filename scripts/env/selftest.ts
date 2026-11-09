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
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DEV_DIR, identityKey } from './lib/state';
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
  rmSync(join(DEV_DIR, 'stack.json'), { force: true });
  for (const lease of scratchLeases()) {
    rmSync(join(resolveRegistryDir(), `${string(lease.projectId)}.json`), { force: true });
  }
  releaseProjectClaims(resolveRegistryDir(), scratchProjectId());
}

async function main(): Promise<number> {
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
    let warmCold = true;
    for (let i = 0; i < 10; i += 1) {
      const warm = run(['env:ensure', '--profile', 'api', '--json'], childEnv);
      if (warm.code !== 0) throw new Error(`warm ensure failed: ${warm.stderr}`);
      warmTimes.push(warm.ms);
      warmCold = json(warm).cold === true;
    }
    console.log(
      `    warm p50 ${percentile(warmTimes, 0.5)}ms, p95 ${percentile(warmTimes, 0.95)}ms`,
    );
    check(warmCold === false, 'warm ensure reports cold:false');
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
