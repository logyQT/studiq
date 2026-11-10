import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  firstFreePort,
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
  readBuildState(): { fingerprint: string; envHash: string; builtAt: string } | null;
  buildArtifactPresent(): boolean;
}>('lib/state.ts');
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
}>('lib/web.ts');

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
    process.env.APP_PORT = String(await firstFreePort(3900));
    // A current build is recorded for the served environment; the listener
    // facts are injected so no real `next start` runs here.
    vi.spyOn(fingerprintModule, 'computeBuildFingerprint').mockReturnValue('built');
    vi.spyOn(stateModule, 'readBuildState').mockReturnValue({
      fingerprint: 'built',
      envHash: 'env-hash',
      builtAt: '',
    });
    vi.spyOn(stateModule, 'buildArtifactPresent').mockReturnValue(true);
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
});
