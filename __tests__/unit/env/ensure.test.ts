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
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  firstFreePort,
  objectField,
  parseJsonObject,
  REPO_ROOT,
  stackStatusFixture,
  startHttpServer,
  startTcpListener,
  type Harness,
  type HttpServer,
  type TcpListener,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface LeaseModule {
  leaseProjectId(identityKey: string): string;
  newLease(input: Record<string, unknown>): Record<string, unknown>;
  writeLease(lease: Record<string, unknown>): void;
  readLease(dir: string, projectId: string): Record<string, unknown> | null;
  readAppPortClaim(dir: string, port: number): { projectId: string } | null;
}

interface RebuildWebGuard {
  readPid(): number | null;
  stop(): { pid: number | null; stopped: boolean };
  alive(pid: number): boolean;
}

interface WebModule {
  stopWebServerForReplacement(guard?: RebuildWebGuard): { pid: number | null; stopped: boolean };
  startWebServer(options: { appPort: number; appUrl: string; env: NodeJS.ProcessEnv }): number;
  waitForWeb(
    appUrl: string,
    pid: number,
    timeoutSeconds: number,
    appPort: number,
  ): Promise<{ ok: boolean; reason: string; http: number }>;
}

interface EnsureModule {
  startWebReplacement(input: {
    appPort: number;
    appUrl: string;
    env: NodeJS.ProcessEnv;
    webPid: number | null;
    timeoutSeconds?: number;
  }): Promise<{ pid: number; http: number }>;
}

interface ExitModule {
  EnvFailure: new (exitCode: number, message: string) => Error;
}

interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintAfter: string;
}

interface RebuildDeps {
  build(envHash: string): Promise<BuildResult>;
  startWeb(options: { appPort: number; appUrl: string; env: NodeJS.ProcessEnv }): number;
  waitWeb(
    appUrl: string,
    pid: number,
    timeoutSeconds: number,
    appPort: number,
  ): Promise<{ ok: boolean; reason: string; http: number }>;
  stopWeb(): { pid: number | null; stopped: boolean };
  stopForReplacement(): { pid: number | null; stopped: boolean };
  readPid(): number | null;
  artifactDir: string;
  backupDir: string;
}

interface RebuildModule {
  rebuildWithRecovery(
    input: {
      envHash: string;
      appPort: number;
      appUrl: string;
      env: NodeJS.ProcessEnv;
      serve: boolean;
      timeoutSeconds?: number;
    },
    deps: RebuildDeps,
  ): Promise<{
    build: BuildResult;
    webPid: number | null;
    webHttp: number;
    webStarted: boolean;
  }>;
}

const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-ensure-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const leaseModule = await loadEnvModule<LeaseModule>('lib/lease.ts');
const stateModule = await loadEnvModule<{
  identityKey(root: string, branch: string, stack: string): string;
}>('lib/state.ts');
const repoModule = await loadEnvModule<{ currentBranchRef(): string }>('lib/repo.ts');
const webModule = await loadEnvModule<WebModule>('lib/web.ts');
const ensureModule = await loadEnvModule<EnsureModule>('commands/ensure.ts');
const exitModule = await loadEnvModule<ExitModule>('lib/exit.ts');
const rebuildModule = await loadEnvModule<RebuildModule>('lib/rebuild.ts');

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

const harnesses: Harness[] = [];
const closers: Array<{ close(): Promise<void> | void }> = [];

afterEach(async () => {
  for (const closer of closers.splice(0).toReversed()) await closer.close();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/** Write this checkout's lease for the harness's stack name. */
function writeLease(harness: Harness, appPort: number, stackName: string): string {
  const branch = repoModule.currentBranchRef();
  const projectId = leaseModule.leaseProjectId(
    stateModule.identityKey(REPO_ROOT, branch, stackName),
  );
  const saved = process.env.STUDIQ_DEV_REGISTRY;
  process.env.STUDIQ_DEV_REGISTRY = harness.registryDir;
  try {
    leaseModule.writeLease({
      ...leaseModule.newLease({
        projectId,
        projectRoot: REPO_ROOT,
        branch,
        stackName,
        appPort,
        shared: false,
        sharedOwner: null,
        mode: 'dev',
      }),
      ownerPid: process.pid,
    });
  } finally {
    if (saved === undefined) delete process.env.STUDIQ_DEV_REGISTRY;
    else process.env.STUDIQ_DEV_REGISTRY = saved;
  }
  return projectId;
}

/** Temp artifact/backup pair for a rebuild-recovery test. */
function recoveryPaths(harness: Harness): { artifactDir: string; backupDir: string } {
  const artifactDir = join(harness.dir, 'artifact');
  const backupDir = join(harness.dir, 'backups');
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(artifactDir, 'BUILD_ID'), 'old-build');
  return { artifactDir, backupDir };
}

function harnessStackName(harness: Harness): string {
  return harness.env.SUPABASE_STACK ?? '';
}

function projectIdFor(harness: Harness): string {
  return leaseModule.leaseProjectId(
    stateModule.identityKey(REPO_ROOT, repoModule.currentBranchRef(), harnessStackName(harness)),
  );
}

function liveStackFixture(harness: Harness): Record<string, unknown> {
  return {
    stacks: [
      {
        id: 'fixture-stack-id',
        name: harnessStackName(harness),
        project_root: REPO_ROOT,
        branch_context: repoModule.currentBranchRef(),
        runtime: 'native',
        owner: 'reachable',
      },
    ],
  };
}

/** A running, fully healthy `api` stack so ensure takes the warm path. */
async function healthyStack(harness: Harness): Promise<void> {
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
    'mail.smtp': { port: 20395 },
    'mail.pop3': { port: 29709 },
    'pgmeta.http': { port: 29285 },
  };
  harness.setStatusFixture(fixture);
}

describe('env:ensure workdir and stack ownership', () => {
  it('refuses a foreign SUPABASE_WORKDIR before any stack discovery', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );

    const result = await harness.run(['ensure', '--profile', 'api', '--no-seed'], {
      SUPABASE_WORKDIR: '/tmp/foreign-checkout',
    });

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('SUPABASE_WORKDIR');
    expect(result.stderr).toContain(REPO_ROOT);
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses a running stack whose project_root is another checkout', async () => {
    const harness = newHarness();
    const fixture = stackStatusFixture({
      apiUrl: 'http://127.0.0.1:20041',
      apiPort: 20041,
    });
    fixture.identity = {
      id: 'foreign-fixture-id',
      name: 'default',
      project_root: '/tmp/foreign-checkout',
      branch_context: 'refs/heads/other',
    };
    harness.setStatusFixture(fixture);

    const result = await harness.run(['ensure', '--profile', 'api', '--no-seed']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('/tmp/foreign-checkout');
    expect(result.stderr).toContain(REPO_ROOT);
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack status');
    expect(calls).not.toContain('stack start');
    expect(calls).not.toContain('stack stop');
    expect(result.stderr).not.toContain('sentinel-anon-key-value');
  });
});

describe('env:ensure never starts a replacement over a surviving server', () => {
  it('aborts the replacement start when the stop leaves the old server alive', async () => {
    const stop = vi.spyOn(webModule, 'stopWebServerForReplacement').mockImplementation(() => {
      throw new exitModule.EnvFailure(
        6,
        'web server (pid 4242) is still running after stop; refusing to start a replacement.',
      );
    });
    const start = vi.spyOn(webModule, 'startWebServer').mockImplementation(() => {
      throw new Error('startWebServer must not run while the previous server survives');
    });

    try {
      await expect(
        ensureModule.startWebReplacement({
          appPort: 3999,
          appUrl: 'http://localhost:3999',
          env: process.env,
          webPid: 4242,
        }),
      ).rejects.toMatchObject({ name: 'EnvFailure', exitCode: 6 });
      expect(start).not.toHaveBeenCalled();
    } finally {
      stop.mockRestore();
      start.mockRestore();
    }
  });

  it('starts the replacement once the stop really removed the server', async () => {
    const stop = vi
      .spyOn(webModule, 'stopWebServerForReplacement')
      .mockReturnValue({ pid: 4242, stopped: true });
    const start = vi.spyOn(webModule, 'startWebServer').mockReturnValue(5151);
    const wait = vi
      .spyOn(webModule, 'waitForWeb')
      .mockResolvedValue({ ok: true, reason: 'ready', http: 200 });

    try {
      await expect(
        ensureModule.startWebReplacement({
          appPort: 3999,
          appUrl: 'http://localhost:3999',
          env: process.env,
          webPid: 4242,
        }),
      ).resolves.toEqual({ pid: 5151, http: 200 });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
      expect(wait).toHaveBeenCalledTimes(1);
    } finally {
      stop.mockRestore();
      start.mockRestore();
      wait.mockRestore();
    }
  });

  it('starts the replacement once the stop really removed the server (guard)', () => {
    let pid: number | null = 4242;
    const guard: RebuildWebGuard = {
      readPid: () => pid,
      stop: () => {
        pid = null;
        return { pid: 4242, stopped: true };
      },
      alive: () => false,
    };

    expect(webModule.stopWebServerForReplacement(guard)).toEqual({ pid: 4242, stopped: true });
  });

  it('starts without stopping when no server is recorded', () => {
    let stops = 0;
    const guard: RebuildWebGuard = {
      readPid: () => null,
      stop: () => {
        stops += 1;
        return { pid: null, stopped: false };
      },
      alive: () => false,
    };

    expect(webModule.stopWebServerForReplacement(guard)).toEqual({ pid: null, stopped: false });
    expect(stops).toBe(0);
  });

  it('throws exit 6 when the real check sees a live server survive the stop', () => {
    // The shipped function itself runs here (no `vi.spyOn` as in the test
    // above); only the process facts are injected, and the PID is this live
    // test process, so the declined stop genuinely leaves a survivor behind.
    const pid = process.pid;
    const guard: RebuildWebGuard = {
      readPid: () => pid,
      stop: () => ({ pid, stopped: false }),
      alive: (candidate) => candidate === pid,
    };

    let thrown: unknown;
    try {
      webModule.stopWebServerForReplacement(guard);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
  });
});

describe('env:ensure rebuilds recoverably', () => {
  it('restores the previous build and restarts the previous server when the build fails', async () => {
    const harness = newHarness();
    const { artifactDir, backupDir } = recoveryPaths(harness);
    let pid: number | null = 4242;
    const starts: number[] = [];
    const deps: RebuildDeps = {
      build: () => {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'partial'), 'new');
        return Promise.resolve({
          ok: false,
          timedOut: false,
          output: 'boom',
          fingerprintAfter: 'new',
        });
      },
      startWeb: () => {
        const next = 5151 + starts.length;
        starts.push(next);
        pid = next;
        return next;
      },
      waitWeb: () => Promise.resolve({ ok: true, reason: 'ready', http: 200 }),
      stopWeb: () => ({ pid: null, stopped: true }),
      stopForReplacement: () => {
        pid = null;
        return { pid: 4242, stopped: true };
      },
      readPid: () => pid,
      artifactDir,
      backupDir,
    };

    await expect(
      rebuildModule.rebuildWithRecovery(
        {
          envHash: 'env-hash',
          appPort: 3999,
          appUrl: 'http://localhost:3999',
          env: process.env,
          serve: true,
        },
        deps,
      ),
    ).rejects.toMatchObject({ name: 'EnvFailure', exitCode: 4 });

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(join(artifactDir, 'partial'))).toBe(false);
    expect(readdirSync(backupDir)).toEqual([]);
    expect(starts).toHaveLength(1);
  });

  it('restores the previous build and restarts when the new server fails its health wait', async () => {
    const harness = newHarness();
    const { artifactDir, backupDir } = recoveryPaths(harness);
    let pid: number | null = 4242;
    const starts: number[] = [];
    const deps: RebuildDeps = {
      build: () => {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
        return Promise.resolve({
          ok: true,
          timedOut: false,
          output: '',
          fingerprintAfter: 'new',
        });
      },
      startWeb: () => {
        const next = starts.length === 0 ? 7001 : 7002;
        starts.push(next);
        pid = next;
        return next;
      },
      waitWeb: (_appUrl, id) =>
        Promise.resolve(
          id === 7001
            ? { ok: false, reason: 'timeout', http: 0 }
            : { ok: true, reason: 'ready', http: 200 },
        ),
      stopWeb: () => {
        pid = null;
        return { pid: 7001, stopped: true };
      },
      stopForReplacement: () => {
        pid = null;
        return { pid: 4242, stopped: true };
      },
      readPid: () => pid,
      artifactDir,
      backupDir,
    };

    await expect(
      rebuildModule.rebuildWithRecovery(
        {
          envHash: 'env-hash',
          appPort: 3999,
          appUrl: 'http://localhost:3999',
          env: process.env,
          serve: true,
        },
        deps,
      ),
    ).rejects.toMatchObject({ name: 'EnvFailure', exitCode: 4 });

    expect(starts).toEqual([7001, 7002]);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(readdirSync(backupDir)).toEqual([]);
  });

  it('restores the previous build when the build throws instead of returning', async () => {
    const harness = newHarness();
    const { artifactDir, backupDir } = recoveryPaths(harness);
    let pid: number | null = 4242;
    const starts: number[] = [];
    const boom = new Error('build exploded');
    const deps: RebuildDeps = {
      build: () => Promise.reject(boom),
      startWeb: () => {
        const next = 8101 + starts.length;
        starts.push(next);
        pid = next;
        return next;
      },
      waitWeb: () => Promise.resolve({ ok: true, reason: 'ready', http: 200 }),
      stopWeb: () => {
        pid = null;
        return { pid: null, stopped: true };
      },
      stopForReplacement: () => {
        pid = null;
        return { pid: 4242, stopped: true };
      },
      readPid: () => pid,
      artifactDir,
      backupDir,
    };

    let failure: unknown;
    try {
      await rebuildModule.rebuildWithRecovery(
        {
          envHash: 'env-hash',
          appPort: 3999,
          appUrl: 'http://localhost:3999',
          env: process.env,
          serve: true,
        },
        deps,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.cause).toBe(boom);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(readdirSync(backupDir)).toEqual([]);
    expect(starts).toHaveLength(1);
  });

  it('keeps the backup and reports its path when restoring a thrown build fails', async () => {
    const harness = newHarness();
    const { artifactDir, backupDir } = recoveryPaths(harness);
    const unreachable = join(harness.dir, 'missing-parent', 'artifact');
    let pid: number | null = 4242;
    let starts = 0;
    const boom = new Error('build exploded');
    const deps: RebuildDeps = {
      build: () => {
        // Move the restore target away so the backup cannot be renamed back.
        deps.artifactDir = unreachable;
        return Promise.reject(boom);
      },
      startWeb: () => {
        starts += 1;
        pid = 8101;
        return 8101;
      },
      waitWeb: () => Promise.resolve({ ok: true, reason: 'ready', http: 200 }),
      stopWeb: () => ({ pid: null, stopped: true }),
      stopForReplacement: () => {
        pid = null;
        return { pid: 4242, stopped: true };
      },
      readPid: () => pid,
      artifactDir,
      backupDir,
    };

    let failure: unknown;
    try {
      await rebuildModule.rebuildWithRecovery(
        {
          envHash: 'env-hash',
          appPort: 3999,
          appUrl: 'http://localhost:3999',
          env: process.env,
          serve: true,
        },
        deps,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.cause).toBe(boom);
    const backups = readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    const kept = join(backupDir, backups[0]);
    expect(failure.message).toContain(kept);
    expect(readFileSync(join(kept, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(starts).toBe(0);
  });

  it('discards the backup when a successful build is not served', async () => {
    const harness = newHarness();
    const { artifactDir, backupDir } = recoveryPaths(harness);
    const deps: RebuildDeps = {
      build: () => {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
        return Promise.resolve({
          ok: true,
          timedOut: false,
          output: '',
          fingerprintAfter: 'new',
        });
      },
      startWeb: () => {
        throw new Error('a --no-serve rebuild must not start the web server');
      },
      waitWeb: () => Promise.reject(new Error('a --no-serve rebuild must not wait for web')),
      stopWeb: () => ({ pid: null, stopped: false }),
      stopForReplacement: () => ({ pid: null, stopped: false }),
      readPid: () => null,
      artifactDir,
      backupDir,
    };

    const result = await rebuildModule.rebuildWithRecovery(
      {
        envHash: 'env-hash',
        appPort: 3999,
        appUrl: 'http://localhost:3999',
        env: process.env,
        serve: false,
      },
      deps,
    );

    expect(result).toMatchObject({ webPid: null, webHttp: 0, webStarted: false });
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('new-build');
    expect(readdirSync(backupDir)).toEqual([]);
  });

  it('is safe when a --no-serve build had no previous artifact to back up', async () => {
    const harness = newHarness();
    const artifactDir = join(harness.dir, 'artifact');
    const backupDir = join(harness.dir, 'backups');
    mkdirSync(artifactDir, { recursive: true });
    mkdirSync(backupDir, { recursive: true });
    const deps: RebuildDeps = {
      build: () => {
        writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
        return Promise.resolve({
          ok: true,
          timedOut: false,
          output: '',
          fingerprintAfter: 'new',
        });
      },
      startWeb: () => {
        throw new Error('a --no-serve rebuild must not start the web server');
      },
      waitWeb: () => Promise.reject(new Error('a --no-serve rebuild must not wait for web')),
      stopWeb: () => ({ pid: null, stopped: false }),
      stopForReplacement: () => ({ pid: null, stopped: false }),
      readPid: () => null,
      artifactDir,
      backupDir,
    };

    const result = await rebuildModule.rebuildWithRecovery(
      {
        envHash: 'env-hash',
        appPort: 3999,
        appUrl: 'http://localhost:3999',
        env: process.env,
        serve: false,
      },
      deps,
    );

    expect(result.webStarted).toBe(false);
    expect(readdirSync(backupDir)).toEqual([]);
  });
});

describe('env:ensure keeps a live stack on its derived APP_URL port', () => {
  it('refuses a different --app-port while a stack is running', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    const stackName = harnessStackName(harness);
    const projectId = writeLease(harness, 3999, stackName);

    const result = await harness.run([
      'ensure',
      '--profile',
      'api',
      '--no-seed',
      '--app-port',
      '3998',
    ]);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('differs from the running stack');
    expect(result.stderr).toContain('env:down --all');
    const calls = harness.bunxCalls();
    expect(calls).not.toContain('stack start');
    expect(calls).not.toContain('stack stop');
    expect(leaseModule.readLease(harness.registryDir, projectId)?.appPort).toBe(3999);
  });

  it('accepts the same --app-port on a healthy running stack', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    const stackName = harnessStackName(harness);
    writeLease(harness, 3999, stackName);

    const result = await harness.run([
      'ensure',
      '--profile',
      'api',
      '--no-seed',
      '--app-port',
      '3999',
      '--json',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(objectField(parseJsonObject(result.stdout), 'ports').app).toBe(3999);
  });

  it('still allows a different --app-port when APP_URL is explicit', async () => {
    const harness = newHarness();
    await healthyStack(harness);
    const stackName = harnessStackName(harness);
    writeLease(harness, 3999, stackName);
    const appPort = await firstFreePort(3900, new Set([3999]));

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort), '--json'],
      {
        APP_URL: `http://localhost:${appPort}`,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(objectField(parseJsonObject(result.stdout), 'ports').app).toBe(appPort);
  });
});

describe('env:ensure releases a failed start only when the stack is gone', () => {
  it('keeps the lease and claim when the failed start cannot stop the stack', async () => {
    const harness = newHarness();
    harness.setListFixture(liveStackFixture(harness));
    const appPort = await firstFreePort(3900);

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      // Both the start and the follow-up stop fail, and the list still shows a
      // reachable stack for this checkout: the port may still be in use.
      { FAKE_SUPA_EXIT: '1' },
    );

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('keeping app port');
    expect(result.stderr).toContain(String(appPort));
    const projectId = projectIdFor(harness);
    expect(leaseModule.readLease(harness.registryDir, projectId)?.appPort).toBe(appPort);
    expect(leaseModule.readAppPortClaim(harness.registryDir, appPort)?.projectId).toBe(projectId);
  });

  it('releases the lease and claim when the list proves the stack is absent', async () => {
    const harness = newHarness();
    // No list fixture: the fake `stack list` reports no stacks at all, so the
    // failed stop is forgiven like `down` does.
    const appPort = await firstFreePort(3900);

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      { FAKE_SUPA_EXIT: '1' },
    );

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('failed to start stack');
    expect(result.stderr).not.toContain('keeping app port');
    const projectId = projectIdFor(harness);
    expect(leaseModule.readLease(harness.registryDir, projectId)).toBeNull();
    expect(leaseModule.readAppPortClaim(harness.registryDir, appPort)).toBeNull();
  });
});
