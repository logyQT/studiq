import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  firstFreePort,
  objectField,
  parseJsonObject,
  REPO_ROOT,
  stackStatusFixture,
  startHttpServer,
  startTcpListener,
  stoppedStackFixture,
  type Harness,
  type HttpServer,
  type TcpListener,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface EnsureOptions {
  profile: 'api' | 'web';
  capabilityAtoms: string[];
  seed: 'default' | 'seed' | 'no-seed';
  build: boolean;
  serve: boolean;
  forceBuild: boolean;
  runtime: 'native' | 'docker' | null;
  stack: string | null;
  appPort: number | null;
  waitSeconds: number | null;
}

interface ParsedCommand {
  command: string;
  json: boolean;
  passthrough: string[];
  ensure: EnsureOptions | null;
  down: null;
  build: null;
  serve: null;
  dev: {
    capabilityAtoms: string[];
    runtime: 'native' | 'docker' | null;
    stack: string | null;
    waitSeconds: number | null;
  } | null;
  resetDb: null;
  logs: null;
  setup: null;
  verify: null;
  yes: boolean;
  quiet: boolean;
  verbose: boolean;
}

interface RebuildRequest {
  envHash: string;
  appPort: number;
  appUrl: string;
  env: NodeJS.ProcessEnv;
  serve: boolean;
  beforeServe?(): Promise<void> | void;
}

interface RebuildOutcome {
  build: { ok: boolean; timedOut: boolean; output: string; fingerprintAfter: string };
  webPid: number | null;
  webHttp: number;
  webStarted: boolean;
}

interface EnsureDeps {
  rebuild(request: RebuildRequest): Promise<RebuildOutcome>;
}

interface EnsureModule {
  runEnsure(parsed: ParsedCommand, deps?: EnsureDeps, caller?: { keys?: boolean }): Promise<number>;
}

interface DevModule {
  runDev(parsed: ParsedCommand): Promise<number>;
}

interface LeaseModule {
  leaseProjectId(identityKey: string): string;
  newLease(input: Record<string, unknown>): Record<string, unknown>;
  writeLease(lease: Record<string, unknown>): void;
}

// `state.ts` captures DEV_DIR at import time, so point it at a temp dir before
// loading any `scripts/env` module (the suite must never write the real `.dev/`).
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-warm-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const atomsModule = await loadEnvModule<{ parseCommand(argv: string[]): ParsedCommand }>(
  'atoms.ts',
);
const ensureModule = await loadEnvModule<EnsureModule>('commands/ensure.ts');
const devModule = await loadEnvModule<DevModule>('commands/dev.ts');
const leaseModule = await loadEnvModule<LeaseModule>('lib/lease.ts');
const stateModule = await loadEnvModule<{
  identityKey(root: string, branch: string, stack: string): string;
  readBuildState(): { fingerprint: string; envHash: string; builtAt: string } | null;
  buildArtifactPresent(): boolean;
}>('lib/state.ts');
const repoModule = await loadEnvModule<{ currentBranchRef(): string }>('lib/repo.ts');
const webModule = await loadEnvModule<{
  startDevServer(input: {
    appPort: number;
    appUrl: string;
    env: NodeJS.ProcessEnv;
    foreground: boolean;
  }): { pid: number; exit: Promise<number | null> };
}>('lib/web.ts');
const lifecycleModule = await loadEnvModule<{
  applyStackEnv(env: unknown, extras: { appUrl: string; appEnv: string; stackId?: string }): void;
}>('lib/stack-lifecycle.ts');
const fingerprintModule = await loadEnvModule<{
  computeBuildFingerprint(input: { root: string; mode: string; envHash: string }): string;
}>('lib/fingerprint.ts');

/** The values a local stack relays to a child process; never cached. */
const RELAYED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const baselineEnv: NodeJS.ProcessEnv = { ...process.env };
const harnesses: Harness[] = [];
const closers: Array<{ close(): Promise<void> | void }> = [];

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const closer of closers.splice(0).toReversed()) await closer.close();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
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

/**
 * Explicit app ports for the `ensure` runs in this file.
 *
 * Without a lease yet, `resolveLease` treats the contract port as the running
 * stack's port, so an `ensure` that has to fall back to the shared 3000-3999
 * scan trips its own port-conflict guard as soon as another unit file holds
 * 3000. Every run here therefore pins `--app-port`, and the base is derived from
 * the worker pid outside both that scan range and the ephemeral range, so the
 * ports are per-worker and only a genuine foreign holder can take one (which
 * `firstFreePort` checks by binding).
 */
const APP_PORT_BASE = 10_000 + (process.pid % 400) * 20;

async function explicitAppPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    ports.push(await firstFreePort(APP_PORT_BASE, new Set(ports)));
  }
  return ports;
}

function parse(args: string[]): ParsedCommand {
  return atomsModule.parseCommand(args);
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
  for (const name of RELAYED_ENV) delete process.env[name];
}

function clearRelayedEnv(): void {
  for (const name of RELAYED_ENV) delete process.env[name];
}

function writeLeaseFor(harness: Harness, appPort: number): void {
  const branch = repoModule.currentBranchRef();
  const projectId = leaseModule.leaseProjectId(
    stateModule.identityKey(REPO_ROOT, branch, harness.env.SUPABASE_STACK ?? ''),
  );
  leaseModule.writeLease({
    ...leaseModule.newLease({
      projectId,
      projectRoot: REPO_ROOT,
      branch,
      stackName: harness.env.SUPABASE_STACK ?? '',
      appPort,
      shared: false,
      sharedOwner: null,
      mode: 'dev',
    }),
    ownerPid: process.pid,
  });
}

function buildOutcome(): RebuildOutcome {
  return {
    build: { ok: true, timedOut: false, output: '', fingerprintAfter: 'fingerprint-after' },
    webPid: 7001,
    webHttp: 200,
    webStarted: true,
  };
}

/** A stack answering every probe; `api` keeps the probe rounds at three requests. */
async function apiStack(harness: Harness): Promise<void> {
  const http: HttpServer = await startHttpServer(200);
  const db: TcpListener = await startTcpListener(0, '127.0.0.1');
  closers.push(http, db);
  const fixture = stackStatusFixture({ apiUrl: http.url, apiPort: http.port });
  fixture.composition = {
    members: [
      { service: 'database' },
      { service: 'rest' },
      { service: 'auth' },
      { service: 'storage' },
    ],
  };
  fixture.endpoints = {
    'rest.http': { port: http.port },
    'auth.http': { port: http.port },
    'database.sql': { port: db.port },
    'studio.http': { port: 31136 },
    'mail.http': { port: 20503 },
  };
  harness.setStatusFixture(fixture);
}

/**
 * A stack whose HTTP probes can be made to fail for a chosen request window, so
 * a probe round after the warm proof fails deterministically.
 */
interface ProbeServer {
  url: string;
  port: number;
  close(): Promise<void>;
  reset(): void;
  failRange(from: number, to: number): void;
}

async function probeServer(): Promise<ProbeServer> {
  let count = 0;
  let from = Number.POSITIVE_INFINITY;
  let to = 0;
  const server = createServer((_request, response) => {
    count += 1;
    response.statusCode = count >= from && count <= to ? 404 : 200;
    response.end('ok');
  });
  await new Promise<void>((done) => server.listen(0, done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((done) => server.close(() => done())),
    reset: () => {
      count = 0;
      from = Number.POSITIVE_INFINITY;
      to = 0;
    },
    failRange: (start, end) => {
      from = start;
      to = end;
    },
  };
}

interface StackKeys {
  anon: string;
  service: string;
}

/** The `full` profile's own stack (mail included), with distinguishable keys. */
function fullStackFixture(
  http: ProbeServer,
  dbPort: number,
  keys: StackKeys,
): Record<string, unknown> {
  const fixture = stackStatusFixture({ apiUrl: http.url, apiPort: http.port, mailUrl: http.url });
  fixture.composition = {
    members: ['database', 'rest', 'auth', 'storage', 'mail'].map((service) => ({ service })),
  };
  fixture.endpoints = {
    'rest.http': { port: http.port },
    'auth.http': { port: http.port },
    'database.sql': { port: dbPort },
    'mail.http': { port: http.port },
    'studio.http': { port: 31136 },
    'pgmeta.http': { port: 29285 },
  };
  const env = objectField(fixture, 'env');
  env.ANON_KEY = keys.anon;
  env.SERVICE_ROLE_KEY = keys.service;
  return fixture;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`expected '${key}' to be a string`);
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') throw new Error(`expected '${key}' to be a number`);
  return value;
}

function statusCalls(harness: Harness): number {
  return harness
    .bunxCalls()
    .split('\n')
    .filter((line) => line.startsWith('stack status')).length;
}

describe('env:dev always relays the stack environment to HMR', () => {
  it('applies the URL and keys even when a fresh warm record exists', async () => {
    const harness = newHarness();
    const http = await probeServer();
    const db: TcpListener = await startTcpListener(0, '127.0.0.1');
    closers.push(http, db);
    harness.setStatusFixture(
      fullStackFixture(http, db.port, {
        anon: 'sentinel-anon-key-value',
        service: 'sentinel-service-role-value',
      }),
    );
    applyHarnessEnv(harness);
    const [appPort] = await explicitAppPorts(1);
    process.env.APP_PORT = String(appPort);
    // The lease pins the port and keeps it out of the bind probe's way.
    writeLeaseFor(harness, appPort);

    // An authoritative run leaves a warm record behind for the next ensure.
    const setup = parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]);
    setup.ensure.build = false;
    setup.ensure.serve = false;
    const setupDeps: EnsureDeps = {
      rebuild: () => Promise.reject(new Error('the setup run must not build')),
    };
    expect(await ensureModule.runEnsure(setup, setupDeps)).toBe(0);
    expect(existsSync(join(stateDir, 'stack-cache.json'))).toBe(true);
    // Nothing the dev caller needs may survive from that run.
    clearRelayedEnv();

    let app: Server | null = null;
    const dev = vi.spyOn(webModule, 'startDevServer').mockImplementation((input) => {
      app = createServer((_request, response) => {
        response.statusCode = 200;
        response.end('ok');
      });
      app.listen(input.appPort);
      return { pid: process.pid, exit: Promise.resolve(0) };
    });
    closers.push({
      close: () => {
        if (!app) return;
        const server = app;
        app = null;
        server.close();
      },
    });

    const code = await devModule.runDev(parse(['dev', '--json']));

    expect(code).toBe(0);
    expect(dev).toHaveBeenCalledTimes(1);
    // HMR got the values on its own process environment (and the child's).
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(`http://localhost:${http.port}`);
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('sentinel-anon-key-value');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('sentinel-service-role-value');
    expect(dev.mock.calls[0]?.[0].env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(
      'sentinel-anon-key-value',
    );
  });

  it('refuses to start HMR when the stack values never arrived', async () => {
    const harness = newHarness();
    const http = await probeServer();
    const db: TcpListener = await startTcpListener(0, '127.0.0.1');
    closers.push(http, db);
    harness.setStatusFixture(fullStackFixture(http, db.port, { anon: 'anon', service: 'service' }));
    applyHarnessEnv(harness);
    const [appPort] = await explicitAppPorts(1);
    process.env.APP_PORT = String(appPort);
    writeLeaseFor(harness, appPort);

    const setup = parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]);
    setup.ensure.build = false;
    setup.ensure.serve = false;
    const setupDeps: EnsureDeps = {
      rebuild: () => Promise.reject(new Error('the setup run must not build')),
    };
    expect(await ensureModule.runEnsure(setup, setupDeps)).toBe(0);
    clearRelayedEnv();
    // The relay itself is broken: ensure still succeeds, but no value arrives.
    vi.spyOn(lifecycleModule, 'applyStackEnv').mockImplementation(() => undefined);
    const start = vi.spyOn(webModule, 'startDevServer').mockImplementation(() => {
      throw new Error('HMR must not start without the stack environment');
    });

    const failure = await devModule
      .runDev(parse(['dev', '--json']))
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(start).not.toHaveBeenCalled();
  });
});

describe('env:ensure drops the warm evidence when it restarts the stack', () => {
  it('re-reads, re-applies and re-checks the build after a failed probe', async () => {
    const harness = newHarness();
    const http = await probeServer();
    const db: TcpListener = await startTcpListener(0, '127.0.0.1');
    closers.push(http, db);
    harness.setStatusFixture(
      fullStackFixture(http, db.port, { anon: 'stale-anon', service: 'stale-service' }),
    );
    applyHarnessEnv(harness);
    const [appPort] = await explicitAppPorts(1);
    process.env.APP_PORT = String(appPort);

    // Authoritative run: writes the warm record used by the next ensure.
    const setup = parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]);
    setup.ensure.build = false;
    setup.ensure.serve = false;
    const setupDeps: EnsureDeps = {
      rebuild: () => Promise.reject(new Error('the setup run must not build')),
    };
    expect(await ensureModule.runEnsure(setup, setupDeps)).toBe(0);
    const cachedEnvHash = textField(
      parseJsonObject(readFileSync(join(stateDir, 'stack-cache.json'), 'utf8')),
      'envHash',
    );

    // The stack comes back with different keys: any relayed value proves the
    // fresh read, while the warm record still points at the old endpoints.
    harness.setStatusFixture(
      fullStackFixture(http, db.port, { anon: 'fresh-anon', service: 'fresh-service' }),
    );
    // The warm probe round answers; the next one (the re-check after the warm
    // proof) fails, which is exactly the restart race.
    http.reset();
    http.failRange(5, 8);
    // A current build is recorded for the warm observation only: after the
    // restart the hash differs, so the rebuild must run against the new stack.
    vi.spyOn(fingerprintModule, 'computeBuildFingerprint').mockImplementation(
      (input) => `fp-${input.envHash}`,
    );
    vi.spyOn(stateModule, 'readBuildState').mockReturnValue({
      fingerprint: `fp-${cachedEnvHash}`,
      envHash: cachedEnvHash,
      builtAt: '',
    });
    vi.spyOn(stateModule, 'buildArtifactPresent').mockReturnValue(true);
    clearRelayedEnv();

    const rebuilds: RebuildRequest[] = [];
    const deps: EnsureDeps = {
      rebuild: (request) => {
        rebuilds.push(request);
        return Promise.resolve(buildOutcome());
      },
    };
    const run = parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]);
    run.ensure.build = true;
    run.ensure.serve = false;

    expect(await ensureModule.runEnsure(run, deps)).toBe(0);

    // The build recheck was not skipped and ran against the restarted stack.
    expect(rebuilds).toHaveLength(1);
    expect(rebuilds[0]?.envHash).not.toBe(cachedEnvHash);
    // The restarted stack's values were relayed instead of the stale ones.
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(`http://localhost:${http.port}`);
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('fresh-anon');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('fresh-service');
  });
});

describe('env:ensure only trusts warm evidence that still matches the stack', () => {
  it('allows a new --app-port once the vanished stack is proven absent', async () => {
    const harness = newHarness();
    await apiStack(harness);
    const [leasePort, changedPort] = await explicitAppPorts(2);
    // The case only proves anything if the requested port really differs from
    // the one the lease holds.
    expect(changedPort).not.toBe(leasePort);
    const first = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(leasePort)],
      // There is no lease yet, so the contract port is what the running stack is
      // assumed to use: it must be the port we request, not the global default.
      { APP_PORT: String(leasePort) },
    );
    expect(first.status, first.stderr).toBe(0);
    // The stack dies after the observation: status no longer reports endpoints
    // while the cached endpoints still answer, so the warm proof passes.
    harness.setStatusFixture(stoppedStackFixture());

    const result = await harness.run([
      'ensure',
      '--profile',
      'api',
      '--no-seed',
      '--app-port',
      String(changedPort),
    ]);

    expect(result.stderr).not.toContain('differs from the running stack');
    // The port change was accepted and the cold start re-read the stack.
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('stack started without endpoints');
    expect(harness.bunxCalls()).toContain('stack start');
  });

  it('keeps the port conflict when the stack is still running', async () => {
    const harness = newHarness();
    await apiStack(harness);
    const [leasePort, changedPort] = await explicitAppPorts(2);
    expect(changedPort).not.toBe(leasePort);
    const first = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(leasePort)],
      // There is no lease yet, so the contract port is what the running stack is
      // assumed to use: it must be the port we request, not the global default.
      { APP_PORT: String(leasePort) },
    );
    expect(first.status, first.stderr).toBe(0);

    const result = await harness.run([
      'ensure',
      '--profile',
      'api',
      '--no-seed',
      '--app-port',
      String(changedPort),
    ]);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('differs from the running stack');
    expect(harness.bunxCalls()).not.toContain('stack start');
  });

  it('keeps the port conflict when stack absence cannot be established', async () => {
    const harness = newHarness();
    await apiStack(harness);
    const [leasePort, changedPort] = await explicitAppPorts(2);
    expect(changedPort).not.toBe(leasePort);
    const first = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(leasePort)],
      // There is no lease yet, so the contract port is what the running stack is
      // assumed to use: it must be the port we request, not the global default.
      { APP_PORT: String(leasePort) },
    );
    expect(first.status, first.stderr).toBe(0);
    // The CLI answers with no JSON at all: that proves nothing about the stack.
    harness.setRawStatus('');

    const result = await harness.run([
      'ensure',
      '--profile',
      'api',
      '--no-seed',
      '--app-port',
      String(changedPort),
    ]);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('differs from the running stack');
    expect(harness.bunxCalls()).not.toContain('stack start');
  });
});

describe('env:ensure re-anchors the warm record only on an authoritative read', () => {
  it('does not extend the heartbeat on a warm run but does on a cold one', async () => {
    const harness = newHarness();
    await apiStack(harness);
    const [appPort] = await explicitAppPorts(1);
    const portArgs = ['--app-port', String(appPort)];
    const first = await harness.run(['ensure', '--profile', 'api', '--no-seed', ...portArgs], {
      // No lease exists yet, so the running stack's assumed port is the contract
      // port: pin it to the explicit port instead of the global default.
      APP_PORT: String(appPort),
    });
    expect(first.status, first.stderr).toBe(0);
    const cachePath = join(harness.stateDir, 'stack-cache.json');
    const authoritative = statusCalls(harness);
    expect(authoritative).toBe(1);

    // Age the record inside its TTL, exactly like a warm run would find it.
    const record = parseJsonObject(readFileSync(cachePath, 'utf8'));
    const heartbeatAt = Date.now() - 60_000;
    writeFileSync(cachePath, `${JSON.stringify({ ...record, heartbeatAt }, null, 2)}\n`);

    const warm = await harness.run(['ensure', '--profile', 'api', '--no-seed', ...portArgs]);
    expect(warm.status, warm.stderr).toBe(0);
    // It really took the warm path: no second `stack status`.
    expect(statusCalls(harness)).toBe(authoritative);
    expect(numberField(parseJsonObject(readFileSync(cachePath, 'utf8')), 'heartbeatAt')).toBe(
      heartbeatAt,
    );

    // An authoritative run re-anchors the record.
    rmSync(cachePath);
    const cold = await harness.run(['ensure', '--profile', 'api', '--no-seed', ...portArgs]);
    expect(cold.status, cold.stderr).toBe(0);
    expect(statusCalls(harness)).toBeGreaterThan(authoritative);
    expect(
      numberField(parseJsonObject(readFileSync(cachePath, 'utf8')), 'heartbeatAt'),
    ).toBeGreaterThan(heartbeatAt);
  });
});
