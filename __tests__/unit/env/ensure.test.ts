import { afterEach, describe, expect, it } from 'vitest';
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
  rebuildWithWebStopped<T>(build: () => Promise<T>, guard?: RebuildWebGuard): Promise<T>;
}

const leaseModule = await loadEnvModule<LeaseModule>('lib/lease.ts');
const stateModule = await loadEnvModule<{
  identityKey(root: string, branch: string, stack: string): string;
}>('lib/state.ts');
const repoModule = await loadEnvModule<{ currentBranchRef(): string }>('lib/repo.ts');
const webModule = await loadEnvModule<WebModule>('lib/web.ts');

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

describe('env:ensure rebuild stops the server first', () => {
  it('aborts without building when the stopped server is still alive', async () => {
    let built = false;
    const guard: RebuildWebGuard = {
      readPid: () => 4242,
      stop: () => ({ pid: 4242, stopped: false }),
      alive: (pid) => pid === 4242,
    };

    const error: unknown = await webModule
      .rebuildWithWebStopped(() => {
        built = true;
        return Promise.resolve('built');
      }, guard)
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    expect(error instanceof Error ? error.message : '').toContain('still running after stop');
    expect(built).toBe(false);
  });

  it('builds once the stop really removed the server', async () => {
    let pid: number | null = 4242;
    const guard: RebuildWebGuard = {
      readPid: () => pid,
      stop: () => {
        pid = null;
        return { pid: 4242, stopped: true };
      },
      alive: () => false,
    };

    await expect(
      webModule.rebuildWithWebStopped(() => Promise.resolve('built'), guard),
    ).resolves.toBe('built');
  });

  it('builds without stopping when no server is recorded', async () => {
    let stops = 0;
    const guard: RebuildWebGuard = {
      readPid: () => null,
      stop: () => {
        stops += 1;
        return { pid: null, stopped: false };
      },
      alive: () => false,
    };

    await expect(
      webModule.rebuildWithWebStopped(() => Promise.resolve('built'), guard),
    ).resolves.toBe('built');
    expect(stops).toBe(0);
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
