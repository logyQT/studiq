#!/usr/bin/env bun
/**
 * `env:selftest` — the phase-2 lifecycle gate.
 *
 * It creates a **scratch stack** for this checkout (`SUPABASE_STACK` set to a
 * unique name), drives the real CLI through `bun run env:*`, and destroys only
 * that stack at the end. It never touches the checkout's default stack or
 * another checkout's stack, and it never prints key material.
 *
 * Covered: issue §11 tests 3 (warm < 1 s, `cold:false`, no `stack status`),
 * 6 (idempotent `down`, lease kept/released), 7 (native default), 9 (JSON
 * contract/no secrets), §13 test 13 (capability reconcile), and shared-mode
 * `ensure`/`status`/`ports`.
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
import { SQL } from 'bun';
import { REPO_ROOT, currentBranchRef } from './lib/repo';
import { resolveRegistryDir } from './lib/registry';
import { identityKey } from './lib/state';

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

const failures: string[] = [];
const passed: string[] = [];
let scratchName = '';
let tempDir = '';
let traceFile = '';

function check(condition: boolean, message: string): void {
  if (condition) {
    passed.push(message);
    console.log(`  ✔ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✘ ${message}`);
  }
}

function assertOk(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function json(result: RunResult): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`expected one JSON object on stdout, got: ${result.stdout.slice(0, 300)}`);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): number {
  return typeof value === 'number' ? value : 0;
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
    'SUPABASE_LOCAL_SMTP_PORT',
    'SUPABASE_LOCAL_SMTP_SMTP_PORT',
    'SUPABASE_LOCAL_SMTP_POP3_PORT',
    'SUPABASE_RUNTIME',
  ]) {
    delete env[name];
  }
  return env;
}

function run(args: string[], extraEnv: Record<string, string | undefined> = {}): RunResult {
  const shimDir = join(tempDir, 'bin');
  const start = performance.now();
  const result = spawnSync('bun', ['run', ...args], {
    cwd: REPO_ROOT,
    env: {
      ...baseEnv(),
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
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

function traceLines(): string[] {
  try {
    return readFileSync(traceFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function clearTrace(): void {
  writeFileSync(traceFile, '');
}

function countCalls(needle: string): number {
  return traceLines().filter((line) => line.includes(needle)).length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)] as number;
}

function registryLeases(): Array<Record<string, unknown>> {
  const dir = resolveRegistryDir();
  if (!existsSync(dir)) return [];
  const leases: Array<Record<string, unknown>> = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('env-') || !name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed !== null && typeof parsed === 'object') {
        leases.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }
  }
  return leases;
}

function scratchLeases(): Array<Record<string, unknown>> {
  return registryLeases().filter(
    (lease) => lease.projectRoot === REPO_ROOT && lease.stackName === scratchName,
  );
}

function scanSecrets(label: string, text: string): void {
  const patterns = [
    /eyJ[A-Za-z0-9_-]{10,}/,
    /ANON_KEY/,
    /SERVICE_ROLE_KEY/,
    /PUBLISHABLE_KEY/,
    /SECRET_KEY/,
    /sb_secret_/,
    /sb_publishable_/,
    /postgres:[^@\s"']+@/,
  ];
  const hit = patterns.find((pattern) => pattern.test(text));
  check(hit === undefined, `${label}: no key material or DB password in output`);
}

async function authUserCount(dbUrl: string): Promise<number | null> {
  let sql: SQL | null = null;
  try {
    sql = new SQL(dbUrl);
    const rows = (await sql`select count(*)::int as count from auth.users`) as Array<{
      count: number;
    }>;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  } finally {
    if (sql) await sql.close();
  }
}

function readStackStatusFixture(name: string): Record<string, unknown> | null {
  const result = spawnSync(
    'bunx',
    ['supabase', 'stack', 'status', '--stack', name, '--output-format', 'json'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
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
        (stack) => stack.name === scratchName && stack.project_root === REPO_ROOT,
      );
      if (mine) {
        const destroy = spawnSync(
          'bunx',
          ['supabase', 'stack', 'destroy', '--stack', scratchName, '--yes'],
          { cwd: REPO_ROOT, encoding: 'utf8', timeout: 180_000 },
        );
        if (destroy.status !== 0) {
          console.error(`  ! could not destroy scratch stack: ${destroy.stderr.trim()}`);
        }
      }
    } catch {
      /* leave it */
    }
  }
  try {
    rmSync(
      join(
        REPO_ROOT,
        '.dev',
        'stacks',
        `${identityKey(REPO_ROOT, currentBranchRef(), scratchName)}.json`,
      ),
      { force: true },
    );
    // A failed run may not have reached `down --all`; drop only this checkout's
    // scratch lease, never another checkout's entry.
    for (const lease of scratchLeases()) {
      rmSync(join(resolveRegistryDir(), `${String(lease.projectId)}.json`), { force: true });
    }
  } catch {
    /* ignore */
  }
}

async function main(): Promise<number> {
  scratchName = `env-selftest-${process.pid}-${Date.now().toString(36)}`;
  tempDir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'studiq-env-selftest-'));
  const shimDir = join(tempDir, 'bin');
  mkdirSync(shimDir, { recursive: true, mode: 0o700 });
  traceFile = join(tempDir, 'bunx-trace.log');
  writeFileSync(traceFile, '');

  const realBunx = spawnSync('bash', ['-lc', 'command -v bunx'], {
    encoding: 'utf8',
  }).stdout?.trim();
  assertOk(Boolean(realBunx), 'could not find bunx on PATH');
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
  console.log('');

  try {
    console.log('▸ cold `ensure --profile api`');
    clearTrace();
    const cold = run(['env:ensure', '--profile', 'api', '--json'], childEnv);
    check(cold.code === 0, `cold api ensure exits 0 (got ${cold.code})`);
    const coldJson = json(cold);
    check(coldJson.cold === true, 'cold api ensure reports cold:true');
    check(coldJson.runtime === 'native', 'runtime is native by default (§11 test 7)');
    check(object(coldJson.ports).block === null, 'ports.block is null (phase 2)');
    check(string(coldJson.profile) === 'api', 'profile is api');
    check(object(coldJson.stack).projectRoot === REPO_ROOT, 'stack belongs to this checkout');
    check(countCalls('stack start') === 1, 'exactly one stack start on a cold ensure');
    console.log(`    cold wall time: ${cold.ms} ms`);
    const stack = object(coldJson.stack);
    const stackId = string(stack.id);
    const coldPorts = object(coldJson.ports);
    check(stackId.length > 0, 'cold ensure reports a stack id');
    scanSecrets('cold ensure JSON', cold.stdout);

    const statusFixture = readStackStatusFixture(scratchName);
    const dbUrl = string(
      object(statusFixture ?? {}).env ? object(object(statusFixture ?? {}).env).DB_URL : '',
    );
    const usersBefore = dbUrl ? await authUserCount(dbUrl) : null;

    console.log('');
    console.log('▸ runtime selection');
    clearTrace();
    const dockerFlag = run(
      ['env:ensure', '--profile', 'api', '--runtime', 'docker', '--json'],
      childEnv,
    );
    check(dockerFlag.code === 6, '`--runtime docker` against a native stack conflicts (exit 6)');
    check(countCalls('stack start') === 0, 'the docker conflict never starts anything');
    const dockerEnv = run(['env:ensure', '--profile', 'api', '--json'], {
      ...childEnv,
      SUPABASE_RUNTIME: 'docker',
    });
    check(dockerEnv.code === 6, 'SUPABASE_RUNTIME=docker also conflicts (exit 6)');

    console.log('');
    console.log('▸ warm path (§11 test 3)');
    clearTrace();
    const warmTimings: number[] = [];
    let warmCold: boolean | null = null;
    for (let index = 0; index < 10; index += 1) {
      const warm = run(['env:ensure', '--profile', 'api', '--json'], childEnv);
      assertOk(
        warm.code === 0,
        `warm ensure ${index + 1} failed (exit ${warm.code}): ${warm.stderr}`,
      );
      warmTimings.push(warm.ms);
      warmCold = json(warm).cold === true;
    }
    const p50 = percentile(warmTimings, 0.5);
    const p95 = percentile(warmTimings, 0.95);
    console.log(`    warm p50: ${p50} ms, p95: ${p95} ms (10 runs)`);
    check(p50 < 1000 && p95 < 1000, 'warm p50 and p95 stay below 1 s');
    check(warmCold === false, 'warm ensure reports cold:false');
    check(
      countCalls('stack status') === 0,
      'warm ensure never spawns `stack status` (fresh heartbeat)',
    );
    check(countCalls('stack start') === 0, 'warm ensure never starts the stack');

    console.log('');
    console.log('▸ capability change (§13 test 13)');
    clearTrace();
    const conflict = run(['env:ensure', '--profile', 'web', '--json'], childEnv);
    check(conflict.code === 6, '`ensure --profile web` without --reconcile exits 6');
    check(
      /mail/.test(conflict.stderr) && /--reconcile/.test(conflict.stderr),
      'the conflict names the missing capability and --reconcile',
    );
    check(countCalls('stack start') === 0, 'the conflict does not restart the stack');

    clearTrace();
    const reconcile = run(
      ['env:ensure', '--profile', 'web', '--reconcile', '--yes', '--json'],
      childEnv,
    );
    check(
      reconcile.code === 0,
      `reconcile exits 0 (got ${reconcile.code}): ${reconcile.stderr.slice(-300)}`,
    );
    const reconcileJson = json(reconcile);
    const reconciledPorts = object(reconcileJson.ports);
    check(
      object(reconcileJson.stack).id === stackId,
      'reconcile keeps the same stack id (data kept)',
    );
    check(
      reconciledPorts.api === coldPorts.api,
      'reconcile keeps the observed API port (read-then-pin)',
    );
    check(reconciledPorts.db === coldPorts.db, 'reconcile keeps the observed DB port');
    check(reconcileJson.runtime === 'native', 'reconcile keeps the persisted runtime');
    check(reconcileJson.ready === true, 'reconcile reports ready:true');
    check(
      number(object(reconcileJson.web).http) === 200,
      '`ensure --profile web` serves the production build',
    );
    scanSecrets('reconcile JSON', reconcile.stdout);
    console.log(`    reconcile wall time: ${reconcile.ms} ms`);

    if (dbUrl) {
      const usersAfter = await authUserCount(dbUrl);
      check(
        usersBefore !== null && usersAfter === usersBefore,
        'reconcile keeps the database data (auth.users count unchanged)',
      );
    }

    clearTrace();
    const narrow = run(['env:ensure', '--profile', 'api', '--json'], childEnv);
    check(narrow.code === 0, 'a narrower request against the superset is ready');
    check(countCalls('stack start') === 0, 'a narrower request never restarts the stack');
    check(countCalls('stack stop') === 0, 'a narrower request never stops the stack');

    console.log('');
    console.log('▸ JSON contract (§11 test 9)');
    const required = [
      'ready',
      'profile',
      'runtime',
      'cold',
      'stack',
      'ports',
      'urls',
      'seeded',
      'build',
      'warnings',
      'log',
      'projectId',
      'worktree',
      'mode',
      'shared',
      'sharedOwner',
      'owner',
      'registry',
      'stackId',
      'branch',
      'web',
      'supabase',
      'dbUrl',
      'mailUrl',
    ];
    const missing = required.filter((key) => !(key in reconcileJson));
    check(
      missing.length === 0,
      `JSON contract has every field (missing: ${missing.join(', ') || 'none'})`,
    );
    check(
      /'warmMs'/.test(JSON.stringify(reconcileJson)) === false,
      'JSON contract has no warmMs field',
    );
    scanSecrets('contract JSON', JSON.stringify(reconcileJson));

    console.log('');
    console.log('▸ shared mode');
    const statusFixture2 = readStackStatusFixture(scratchName);
    const sharedEnvRaw = object(object(statusFixture2 ?? {}).env);
    const sharedEnv: Record<string, string | undefined> = {
      SUPABASE_SHARED: '1',
      SUPABASE_URL: string(sharedEnvRaw.API_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: string(sharedEnvRaw.ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: string(sharedEnvRaw.SERVICE_ROLE_KEY),
      SUPABASE_DB_URL: string(sharedEnvRaw.DB_URL),
    };
    clearTrace();
    const sharedEnsure = run(['env:ensure', '--profile', 'api', '--json'], {
      ...childEnv,
      ...sharedEnv,
    });
    check(
      sharedEnsure.code === 0,
      `shared ensure exits 0 (got ${sharedEnsure.code}): ${sharedEnsure.stderr.slice(-300)}`,
    );
    check(json(sharedEnsure).shared === true, 'shared ensure reports shared:true');
    check(json(sharedEnsure).ready === true, 'shared ensure is ready');
    check(
      countCalls('stack start') + countCalls('stack stop') + countCalls('stack status') === 0,
      'shared ensure performs zero stack mutation',
    );
    scanSecrets('shared ensure JSON', sharedEnsure.stdout);

    const sharedStatus = run(['env:status', '--json'], { ...childEnv, ...sharedEnv });
    check(sharedStatus.code === 0, 'shared status exits 0');
    check(json(sharedStatus).shared === true, 'shared status reports shared:true');
    const sharedPorts = run(['env:ports', '--json'], { ...childEnv, ...sharedEnv });
    check(sharedPorts.code === 0, 'shared ports exits 0');

    const sharedDown = run(['env:down', '--all'], { ...childEnv, ...sharedEnv });
    check(sharedDown.code === 6, 'shared `down --all` exits 6 (§11 test 8)');

    console.log('');
    console.log('▸ explicit build');
    const downOnce = run(['env:down', '--json'], childEnv);
    check(downOnce.code === 0, 'plain down exits 0');
    const build = run(['env:build', '--json'], childEnv);
    check(build.code === 0, `explicit build exits 0 (got ${build.code})`);
    const buildJson = json(build);
    check(object(buildJson.build).present === true, 'build JSON reports the artifact present');
    scanSecrets('build JSON', build.stdout);

    console.log('');
    console.log('▸ idempotent down and lease lifetime (§11 test 6)');
    check(scratchLeases().length === 1, 'the app-port lease exists while the stack runs');
    const downA = run(['env:down', '--json'], childEnv);
    const downB = run(['env:down', '--json'], childEnv);
    check(downA.code === 0 && downB.code === 0, 'plain down is idempotent (exit 0 twice)');
    check(scratchLeases().length === 1, 'plain down keeps the app-port lease while the stack runs');
    const downAll = run(['env:down', '--all', '--yes', '--json'], childEnv);
    check(downAll.code === 0, 'down --all --yes exits 0');
    check(scratchLeases().length === 0, 'down --all releases the app-port lease');
    const downAllAgain = run(['env:down', '--all', '--yes', '--json'], childEnv);
    check(downAllAgain.code === 0, 'down --all is idempotent');
  } finally {
    destroyScratch();
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('');
  console.log(`env:selftest — ${passed.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ✘ ${failure}`);
    return 1;
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`env:selftest: ${error instanceof Error ? error.message : String(error)}`);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  process.exitCode = 1;
}
