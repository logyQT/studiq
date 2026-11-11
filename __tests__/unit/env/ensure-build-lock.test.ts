import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appPortBase,
  BUN,
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
  yes: boolean;
}

interface RebuildRequest {
  envHash: string;
  appPort: number;
  appUrl: string;
  env: NodeJS.ProcessEnv;
  serve: boolean;
  /** The fence `ensure` installs immediately before the replacement starts. */
  beforeServe?(): Promise<void> | void;
  timeoutSeconds?: number;
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
  runEnsure(parsed: ParsedCommand, deps?: EnsureDeps): Promise<number>;
}

interface LeaseModule {
  leaseProjectId(identityKey: string): string;
  newLease(input: Record<string, unknown>): Record<string, unknown>;
  writeLease(lease: Record<string, unknown>): void;
  readLease(dir: string, projectId: string): Record<string, unknown> | null;
}

interface StateModule {
  identityKey(root: string, branch: string, stack: string): string;
  readBuildState(): Record<string, unknown> | null;
}

interface RepoModule {
  currentBranchRef(): string;
}

// `state.ts` captures DEV_DIR at import time, so point it at a temp dir before
// loading any `scripts/env` module (the suite must never write the real `.dev/`).
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-build-lock-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const atomsModule = await loadEnvModule<{ parseCommand(argv: string[]): ParsedCommand }>(
  'atoms.ts',
);
const ensureModule = await loadEnvModule<EnsureModule>('commands/ensure.ts');
const leaseModule = await loadEnvModule<LeaseModule>('lib/lease.ts');
const stateModule = await loadEnvModule<StateModule>('lib/state.ts');
const repoModule = await loadEnvModule<RepoModule>('lib/repo.ts');

const baselineEnv: NodeJS.ProcessEnv = { ...process.env };
const harnesses: Harness[] = [];
const closers: Array<{ close(): Promise<void> | void }> = [];

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

afterEach(async () => {
  for (const closer of closers.splice(0).toReversed()) await closer.close();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
  // Restore the process environment the in-process command mutates, so one
  // test's stack values never leak into the next one.
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(baselineEnv)) process.env[key] = value;
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
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
}

function stackName(harness: Harness): string {
  return harness.env.SUPABASE_STACK ?? '';
}

function projectIdFor(harness: Harness): string {
  return leaseModule.leaseProjectId(
    stateModule.identityKey(REPO_ROOT, repoModule.currentBranchRef(), stackName(harness)),
  );
}

function writeLease(harness: Harness, appPort: number): string {
  const branch = repoModule.currentBranchRef();
  const projectId = projectIdFor(harness);
  leaseModule.writeLease({
    ...leaseModule.newLease({
      projectId,
      projectRoot: REPO_ROOT,
      branch,
      stackName: stackName(harness),
      appPort,
      shared: false,
      sharedOwner: null,
      mode: 'dev',
    }),
    ownerPid: process.pid,
  });
  return projectId;
}

/** A running, fully healthy `web` stack so the warm path is taken. */
async function healthyStack(harness: Harness): Promise<HttpServer> {
  const http = await startHttpServer(200);
  const db: TcpListener = await startTcpListener(0, '127.0.0.1');
  closers.push(http, db);
  const fixture = stackStatusFixture({ apiUrl: http.url, apiPort: http.port, mailUrl: http.url });
  fixture.composition = {
    members: [
      { service: 'database' },
      { service: 'rest' },
      { service: 'auth' },
      { service: 'storage' },
      { service: 'mail' },
    ],
  };
  fixture.endpoints = {
    'rest.http': { port: http.port },
    'auth.http': { port: http.port },
    'database.sql': { port: db.port },
    'mail.http': { port: http.port },
    'studio.http': { port: 31136 },
    'pgstat.http': { port: 29285 },
  };
  harness.setStatusFixture(fixture);
  return http;
}

function parse(args: string[]): ParsedCommand {
  return atomsModule.parseCommand(args);
}

function buildOutcome(overrides: Partial<RebuildOutcome> = {}): RebuildOutcome {
  return {
    build: { ok: true, timedOut: false, output: '', fingerprintAfter: 'fingerprint-after' },
    webPid: 7001,
    webHttp: 200,
    webStarted: true,
    ...overrides,
  };
}

async function failureOf(run: Promise<number>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error('expected the ensure to fail');
}

describe('env:ensure releases the checkout lock for the build', () => {
  it('lets a concurrent env:down take the checkout lock during the build', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    applyHarnessEnv(harness);
    const appPort = await firstAppPort();
    writeLease(harness, appPort);

    let downStatus: number | null = null;
    const deps: EnsureDeps = {
      async rebuild() {
        // A real `down` in another process: it only gets here while the build
        // runs, so a held checkout lock would block it for the whole build.
        const down = await harness.run(['down', '--all', '--yes']);
        downStatus = down.status;
        return buildOutcome();
      },
    };

    const failure = await failureOf(
      ensureModule.runEnsure(
        parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]),
        deps,
      ),
    );

    expect(downStatus).toBe(0);
    // The down removed the lease under the build: the lock is back, the change
    // is detected, and the environment is never reported ready.
    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('lease');
  });

  it('refuses to serve when a concurrent env:down released the lease during the build', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    applyHarnessEnv(harness);
    const appPort = await firstAppPort();
    writeLease(harness, appPort);

    let downStatus: number | null = null;
    let fenced = false;
    const deps: EnsureDeps = {
      async rebuild(request) {
        if (!request.beforeServe) throw new Error('ensure did not install the serve fence');
        // A real `down` in another process releases the lease and stops the
        // stack while the build runs; the fence runs immediately before the
        // replacement would be started.
        const down = await harness.run(['down', '--all', '--yes']);
        downStatus = down.status;
        await request.beforeServe();
        fenced = true;
        return buildOutcome();
      },
    };

    const failure = await failureOf(
      ensureModule.runEnsure(
        parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]),
        deps,
      ),
    );

    expect(downStatus).toBe(0);
    // The fence refused before the build could be reported as served.
    expect(fenced).toBe(false);
    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('lease');
    // The down's release stands: ensure published no lease over it.
    expect(leaseModule.readLease(harness.registryDir, projectIdFor(harness))).toBeNull();
  });

  it('holds the checkout lock from the serve fence through the replacement start', async () => {
    const harness = newHarness();
    const app = await healthyStack(harness);
    applyHarnessEnv(harness);
    writeLease(harness, app.port);
    const lockFile = join(stateDir, 'locks', 'checkout.lock');
    // `flock -n` proves the lock is held by someone else; the portable fallback
    // (no flock) has no equivalent probe, so the assertion is skipped there.
    const flockAvailable = spawnSync('flock', ['--version'], { timeout: 5_000 }).status === 0;

    let lockHeldInFence: boolean | null = null;
    const deps: EnsureDeps = {
      async rebuild(request) {
        if (!request.beforeServe) throw new Error('ensure did not install the serve fence');
        await request.beforeServe();
        lockHeldInFence = flockAvailable
          ? spawnSync('flock', ['-n', lockFile, 'true'], { timeout: 5_000 }).status !== 0
          : null;
        return buildOutcome();
      },
    };

    const code = await ensureModule.runEnsure(
      parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(app.port)]),
      deps,
    );

    expect(code).toBe(0);
    if (flockAvailable) expect(lockHeldInFence).toBe(true);
  });

  it('detects a lease that moved during the build when the lock is re-acquired', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    applyHarnessEnv(harness);
    const appPort = await firstAppPort();
    const projectId = writeLease(harness, appPort);
    const moved = appPort + 1;

    const deps: EnsureDeps = {
      rebuild() {
        writeLease(harness, moved);
        return Promise.resolve(buildOutcome());
      },
    };

    const failure = await failureOf(
      ensureModule.runEnsure(
        parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]),
        deps,
      ),
    );

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(`moved to ${moved}`);
    // A build for an environment that no longer holds must not be recorded as current.
    expect(stateModule.readBuildState()).toBeNull();
    expect(leaseModule.readLease(harness.registryDir, projectId)?.appPort).toBe(moved);
  });

  it('detects a stack that stopped during the build instead of serving it', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    applyHarnessEnv(harness);
    const appPort = await firstAppPort();
    writeLease(harness, appPort);

    const deps: EnsureDeps = {
      rebuild() {
        harness.setStatusFixture(stoppedStackFixture());
        return Promise.resolve(buildOutcome());
      },
    };

    const failure = await failureOf(
      ensureModule.runEnsure(
        parse(['ensure', '--profile', 'web', '--no-seed', '--app-port', String(appPort)]),
        deps,
      ),
    );

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('stopped during the build');
    expect(stateModule.readBuildState()).toBeNull();
  });

  it('serves a clean build once the lock is re-acquired and the environment still matches', async () => {
    const harness = newHarness();
    const app = await healthyStack(harness);
    applyHarnessEnv(harness);
    writeLease(harness, app.port);

    let builds = 0;
    const deps: EnsureDeps = {
      rebuild() {
        builds += 1;
        return Promise.resolve(buildOutcome());
      },
    };
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const code = await ensureModule.runEnsure(
        parse([
          'ensure',
          '--profile',
          'web',
          '--no-seed',
          '--app-port',
          String(app.port),
          '--json',
        ]),
        deps,
      );

      expect(code).toBe(0);
      const emitted = stdout.mock.calls.map((call) => String(call[0])).join('');
      const snapshot = parseJsonObject(emitted);
      expect(snapshot.ready).toBe(true);
      expect(objectField(snapshot, 'web').http).toBe(200);
      expect(builds).toBe(1);
      expect(stateModule.readBuildState()).not.toBeNull();
      expect(leaseModule.readLease(harness.registryDir, projectIdFor(harness))?.appPort).toBe(
        app.port,
      );
    } finally {
      stdout.mockRestore();
    }
  });
});

/** First free app port on this file's own base, claimed by the lease before `ensure`. */
function firstAppPort(): Promise<number> {
  return firstFreePort(appPortBase());
}

describe('env:ensure refuses a concurrent rebuild of the same artifact', () => {
  it('refuses before stopping the server or backing up .next', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    applyHarnessEnv(harness);
    const appPort = await firstAppPort();
    writeLease(harness, appPort);

    // Another process owns an in-flight rebuild: `checkout.lock` is free for it,
    // so only its handover record can keep a second ensure off the artifact.
    const owner = spawn(BUN, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const ownerPid = owner.pid;
    if (ownerPid === undefined) throw new Error('the handover owner did not start');
    try {
      const backup = join(stateDir, 'next-backup-in-flight');
      mkdirSync(backup, { recursive: true });
      writeFileSync(join(backup, 'BUILD_ID'), 'previous-build');
      writeFileSync(
        join(stateDir, 'handover.json'),
        `${JSON.stringify({
          artifactDir: join(REPO_ROOT, 'apps', 'web', '.next'),
          backupPath: backup,
          previousPid: 7001,
          ownerPid,
          phase: 'backed-up',
          at: new Date().toISOString(),
        })}\n`,
      );

      let rebuilds = 0;
      const failure = await failureOf(
        ensureModule.runEnsure(
          parse([
            'ensure',
            '--profile',
            'web',
            '--no-seed',
            '--force-build',
            '--app-port',
            String(appPort),
          ]),
          {
            rebuild() {
              rebuilds += 1;
              return Promise.resolve(buildOutcome());
            },
          },
        ),
      );

      // No rebuild ran, so this ensure never stopped the owner's server or moved
      // the artifact it is responsible for.
      expect(rebuilds).toBe(0);
      expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
      if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
      expect(failure.message).toContain(`pid ${ownerPid}`);
      expect(failure.message).toContain('rebuilding apps/web/.next');
      expect(existsSync(join(stateDir, 'handover.json'))).toBe(true);
      expect(readFileSync(join(backup, 'BUILD_ID'), 'utf8')).toBe('previous-build');
    } finally {
      owner.kill('SIGKILL');
    }
  });
});
