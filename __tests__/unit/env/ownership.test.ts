import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appPortBase,
  createHarness,
  firstFreePort,
  objectField,
  parseJsonObject,
  REPO_ROOT,
  stackStatusFixture,
  type Harness,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface ParsedCommand {
  command: string;
  json: boolean;
  passthrough: string[];
  ensure: null;
  down: null;
  serve: { stack: string | null } | null;
  resetDb: { stack: string | null } | null;
  build: null;
  yes: boolean;
  quiet: boolean;
  verbose: boolean;
  dev: null;
  logs: null;
  setup: null;
  verify: null;
}

interface ServeModule {
  runServe(parsed: ParsedCommand): Promise<number>;
}

/** The registry lease `env:ensure` writes; `serve` adopts its `appPort`. */
interface AppLease {
  projectId: string;
  appPort: number;
}

// `state.ts` captures DEV_DIR at import time, so point it at a temp dir before
// loading any `scripts/env` module (the suite must never write the real `.dev/`).
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-ownership-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const atomsModule = await loadEnvModule<{ parseCommand(argv: string[]): ParsedCommand }>(
  'atoms.ts',
);
const serveModule = await loadEnvModule<ServeModule>('commands/serve.ts');
const fingerprintModule = await loadEnvModule<{
  computeBuildFingerprint(input: { root: string; mode: string; envHash: string }): string;
}>('lib/fingerprint.ts');
const stateModule = await loadEnvModule<{
  identityKey(projectRoot: string, branch: string, stackName: string): string;
  classifyBuildArtifact(expected: {
    fingerprint: string | null;
    envHash: string | null;
  }): 'current' | 'stale' | 'unrecorded' | 'missing' | null;
}>('lib/state.ts');
const leaseModule = await loadEnvModule<{
  leaseProjectId(identityKey: string): string;
  newLease(input: {
    projectId: string;
    projectRoot: string;
    branch: string;
    stackName: string;
    appPort: number;
    shared: boolean;
    sharedOwner: string | null;
    mode: 'dev' | 'prod';
  }): AppLease;
  writeLease(lease: AppLease): void;
}>('lib/lease.ts');
const repoModule = await loadEnvModule<{ currentBranchRef(): string }>('lib/repo.ts');
const lifecycleModule = await loadEnvModule<{
  applyStackEnv(env: unknown, extras: { appUrl: string; appEnv: string; stackId?: string }): void;
}>('lib/stack-lifecycle.ts');
const webModule = await loadEnvModule<{
  startWebServer(input: { appPort: number; appUrl: string; env: NodeJS.ProcessEnv }): number;
  waitForWeb(
    appUrl: string,
    pid: number,
    timeoutSeconds: number,
    appPort: number,
  ): Promise<{ ok: boolean; reason: string; http: number }>;
  readWebPid(): number | null;
  stopWebServer(): { pid: number | null; stopped: boolean };
}>('lib/web.ts');
const healthModule = await loadEnvModule<{
  probeHttp(url: string, timeoutMs?: number): Promise<number>;
}>('lib/health.ts');
const webOwnerModule = await loadEnvModule<{
  liveServerConflict(input: unknown, action: string): string | null;
}>('lib/web-owner.ts');
const locksModule = await loadEnvModule<{
  worktreeKey(root?: string): string;
  processStartTime(pid: number): string | null;
}>('lib/locks.ts');
const stackModule = await loadEnvModule<{
  readStack(stackName: string | null): unknown;
}>('lib/stack.ts');

const baselineEnv: NodeJS.ProcessEnv = { ...process.env };
const harnesses: Harness[] = [];

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
  // Restore the process environment the in-process command mutates, so one
  // test's stack values never leak into the next one.
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(baselineEnv)) process.env[key] = value;
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/** Put this test's harness environment on the in-process command's env. */
function applyHarnessEnv(harness: Harness): void {
  for (const [key, value] of Object.entries(harness.env)) {
    if (value !== undefined) process.env[key] = value;
  }
  process.env.STUDIQ_ENV_STATE_DIR = stateDir;
  process.env.APP_ENV = 'test';
  delete process.env.APP_URL;
  delete process.env.APP_PORT;
  delete process.env.SUPABASE_SHARED;
  delete process.env.SUPABASE_WORKDIR;
  // Every value a local stack relays starts unset: a test may only observe the
  // ones the command under test applies itself.
  for (const name of [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]) {
    delete process.env[name];
  }
}

function parse(args: string[]): ParsedCommand {
  return atomsModule.parseCommand(args);
}

/** A running stack that reports another checkout's project root. */
function foreignStackFixture(): Record<string, unknown> {
  const fixture = stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 });
  fixture.identity = {
    id: 'foreign-fixture-id',
    name: 'foreignprobe',
    project_root: '/tmp/foreign-checkout',
    branch_context: 'refs/heads/other',
  };
  return fixture;
}

describe('env:reset-db refuses a stack this checkout does not own', () => {
  it('refuses a foreign SUPABASE_WORKDIR before any CLI call', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );

    const result = await harness.run(['reset-db', '--yes'], {
      SUPABASE_WORKDIR: '/tmp/agent-shots/foreign-wt',
      SUPABASE_STACK: 'foreignprobe',
    });

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('SUPABASE_WORKDIR');
    expect(result.stderr).toContain(REPO_ROOT);
    // Nothing was discovered and nothing was reset.
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses a named stack whose project_root is another checkout and never resets', async () => {
    const harness = newHarness();
    harness.setStatusFixture(foreignStackFixture());

    const result = await harness.run(['reset-db', '--yes'], { SUPABASE_STACK: 'foreignprobe' });

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('/tmp/foreign-checkout');
    expect(result.stderr).toContain(REPO_ROOT);
    expect(harness.bunxCalls()).toContain('stack status');
    // The destructive command was never reached.
    expect(harness.bunxCalls()).not.toContain('db reset');
  });

  it('resets this checkout’s own stack', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );

    const result = await harness.run(['reset-db', '--yes']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('reset-db complete');
    const calls = harness.bunxCalls();
    expect(calls).toContain('db reset');
    expect(calls).toContain('--remote=');
  });
});

/** Run one command and return what it wrote to stdout. */
async function captureStdout(run: () => Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

/** The per-worktree mutex record a live build leaves behind. */
function writeBuildMutex(registryDir: string): void {
  const mutex = join(registryDir, 'build-slots', 'worktrees', locksModule.worktreeKey(REPO_ROOT));
  mkdirSync(mutex, { recursive: true, mode: 0o700 });
  writeFileSync(join(mutex, 'pid'), `${process.pid}\n`);
  writeFileSync(join(mutex, 'start'), `${locksModule.processStartTime(process.pid)}\n`);
  writeFileSync(join(mutex, 'token'), 'live-build\n');
  writeFileSync(join(mutex, 'worktree'), `${REPO_ROOT}\n`);
}

/**
 * The app-port lease `env:ensure` leaves in the registry.
 *
 * It is the only input that can name this checkout's port while `APP_PORT` and
 * `APP_URL` stay unset, which is the state `serve` reads its contract in.
 */
function writeAppLease(appPort: number): void {
  const stackName = process.env.SUPABASE_STACK ?? '';
  const branch = repoModule.currentBranchRef();
  leaseModule.writeLease(
    leaseModule.newLease({
      projectId: leaseModule.leaseProjectId(stateModule.identityKey(REPO_ROOT, branch, stackName)),
      projectRoot: REPO_ROOT,
      branch,
      stackName,
      appPort,
      shared: false,
      sharedOwner: null,
      mode: 'prod',
    }),
  );
}

describe('env:serve refuses another checkout’s stack and keys', () => {
  it('refuses a foreign SUPABASE_WORKDIR before reading the stack', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    process.env.SUPABASE_WORKDIR = '/tmp/agent-shots/foreign-wt';

    const failure = await serveModule.runServe(parse(['serve'])).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses a stack owned by another checkout without applying its environment', async () => {
    const harness = newHarness();
    harness.setStatusFixture(foreignStackFixture());
    applyHarnessEnv(harness);
    const apply = vi.spyOn(lifecycleModule, 'applyStackEnv');
    const start = vi.spyOn(webModule, 'startWebServer');

    const failure = await serveModule.runServe(parse(['serve'])).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('/tmp/foreign-checkout');
    expect(harness.bunxCalls()).toContain('stack status');
    // The foreign URL/keys never reached this process or a child server.
    expect(apply).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('serves this checkout’s own stack with its keys', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    // A per-file port: `serve` treats the contract port as a candidate, so
    // sharing the 3000-3999 scan with parallel files made this flaky.
    process.env.APP_PORT = String(await firstFreePort(appPortBase()));
    // A current build is recorded for the served environment; the listener
    // facts are injected so no real `next start` runs here.
    vi.spyOn(fingerprintModule, 'computeBuildFingerprint').mockReturnValue('built');
    vi.spyOn(stateModule, 'classifyBuildArtifact').mockReturnValue('current');
    const start = vi.spyOn(webModule, 'startWebServer').mockReturnValue(process.pid);
    vi.spyOn(webModule, 'waitForWeb').mockResolvedValue({ ok: true, reason: 'ready', http: 200 });

    const code = await serveModule.runServe(parse(['serve', '--quiet']));

    expect(code).toBe(0);
    expect(start).toHaveBeenCalledTimes(1);
    const input = start.mock.calls[0]?.[0];
    expect(input?.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://localhost:20041');
    expect(input?.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('sentinel-anon-key-value');
    expect(input?.env.SUPABASE_SERVICE_ROLE_KEY).toBe('sentinel-service-role-value');
  });

  it('reports its own write in --json, not the pre-serve file', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    process.env.APP_PORT = String(await firstFreePort(appPortBase()));
    vi.spyOn(fingerprintModule, 'computeBuildFingerprint').mockReturnValue('built');
    vi.spyOn(stateModule, 'classifyBuildArtifact').mockReturnValue('current');
    // The listener facts are injected. `readWebPid` is the same record the
    // manifest writer derives `serving` from, so the file and the probe agree.
    vi.spyOn(webModule, 'readWebPid').mockReturnValue(process.pid);
    vi.spyOn(webModule, 'stopWebServer').mockReturnValue({ pid: process.pid, stopped: true });
    // The stubbed pid is this checkout's own server, not a foreign one.
    vi.spyOn(webOwnerModule, 'liveServerConflict').mockReturnValue(null);
    vi.spyOn(webModule, 'startWebServer').mockReturnValue(process.pid);
    vi.spyOn(webModule, 'waitForWeb').mockResolvedValue({ ok: true, reason: 'ready', http: 200 });
    vi.spyOn(healthModule, 'probeHttp').mockResolvedValue(0);

    const stdout = await captureStdout(() => serveModule.runServe(parse(['serve', '--json'])));
    // The snapshot is both the command's output and the reconciler: a write that
    // lands only in the `finally` reports the pre-serve file as stale.
    const snapshot = parseJsonObject(stdout);
    expect(objectField(snapshot, 'manifest')).toMatchObject({ agrees: true, differences: [] });
  });

  it('refuses while a build holds this worktree mutex, before reading the stack', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    // A live build owns `.next` and keeps `checkout.lock` free, so the build
    // record and the fingerprint cannot see it; the mutex is the signal.
    writeBuildMutex(harness.registryDir);
    const start = vi.spyOn(webModule, 'startWebServer');

    const failure = await serveModule.runServe(parse(['serve'])).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(`pid ${process.pid}`);
    expect(start).not.toHaveBeenCalled();
    // Refused before the stack was read, so no CLI call was made.
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses when a build takes the mutex while the stack is being read', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    process.env.APP_PORT = String(await firstFreePort(appPortBase()));
    // A current build is recorded, so only the build guard can refuse: without
    // it this command would start a server over the artifact.
    vi.spyOn(fingerprintModule, 'computeBuildFingerprint').mockReturnValue('built');
    vi.spyOn(stateModule, 'classifyBuildArtifact').mockReturnValue('current');
    const start = vi.spyOn(webModule, 'startWebServer').mockReturnValue(process.pid);
    vi.spyOn(webModule, 'waitForWeb').mockResolvedValue({ ok: true, reason: 'ready', http: 200 });

    // The race the early guard cannot see: serve passes it, then blocks on the
    // checkout lock while the build's prelude holds it, and the build takes its
    // mutex moments after releasing that lock — while serve reads the stack.
    const realReadStack = stackModule.readStack;
    const readStack = vi.spyOn(stackModule, 'readStack').mockImplementation((name) => {
      writeBuildMutex(harness.registryDir);
      return realReadStack(name);
    });

    const failure = await serveModule
      .runServe(parse(['serve', '--quiet']))
      .catch((error: unknown) => error);

    expect(readStack).toHaveBeenCalled();
    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(`pid ${process.pid}`);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('env:serve names the port its contract adopted', () => {
  it('blames the leased port, not APP_PORT, when a foreign listener answers', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    const appPort = await firstFreePort(appPortBase());
    // `serve` adopts the lease only while APP_PORT and APP_URL name nothing.
    writeAppLease(appPort);
    // The 200 comes from a listener that is not this checkout's server.
    vi.spyOn(healthModule, 'probeHttp').mockResolvedValue(200);
    const start = vi.spyOn(webModule, 'startWebServer');

    const failure = await serveModule.runServe(parse(['serve'])).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(`http://localhost:${appPort}`);
    // #1362: the source is read before `applyContractEnv` writes APP_PORT/APP_URL,
    // so the refusal can still name the lease. Read afterwards, every refusal
    // says APP_PORT — a lease the operator never set.
    expect(failure.message).toContain('the leased port');
    expect(start).not.toHaveBeenCalled();
  });
});
