import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  REPO_ROOT,
  stackStatusFixture,
  stoppedStackFixture,
  type Harness,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface LeaseModule {
  leaseProjectId(identityKey: string): string;
  newLease(input: Record<string, unknown>): Record<string, unknown>;
  writeLease(lease: Record<string, unknown>): void;
  readLease(dir: string, projectId: string): Record<string, unknown> | null;
  claimAppPort(dir: string, port: number, projectId: string): { ok: boolean; holder: unknown };
  readAppPortClaim(dir: string, port: number): { projectId: string } | null;
}

interface StateModule {
  identityKey(root: string, branch: string, stack: string): string;
  writeStackState(state: Record<string, unknown>): void;
  readStackState(): Record<string, unknown> | null;
  removeStackState(): void;
}

interface RepoModule {
  currentBranchRef(): string;
}

/** The injected process facts `down` uses instead of the real web server. */
interface DownWebGuard {
  stop(): { pid: number | null; stopped: boolean };
  alive(pid: number): boolean;
}

interface ParsedDown {
  command: 'down';
  json: boolean;
  passthrough: string[];
  ensure: null;
  down: { all: boolean; stack: string | null };
  build: null;
  yes: boolean;
}

interface DownModule {
  runDown(parsed: ParsedDown, guard?: DownWebGuard): Promise<number>;
  stopWebForDown(guard?: DownWebGuard): { line: string; survivor: number | null };
}

const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-down-web-'));
// `DEV_DIR` is fixed at module load, so the isolated state dir goes first.
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const downModule = await loadEnvModule<DownModule>('commands/down.ts');
const leaseModule = await loadEnvModule<LeaseModule>('lib/lease.ts');
const stateModule = await loadEnvModule<StateModule>('lib/state.ts');
const repoModule = await loadEnvModule<RepoModule>('lib/repo.ts');

/** Env keys the harness controls; every one is restored after the test. */
const HARNESS_ENV_KEYS = [
  'PATH',
  'HOME',
  'STUDIQ_DEV_REGISTRY',
  'SUPABASE_STACK',
  'SUPABASE_SHARED',
  'APP_PORT',
  'FAKE_BUNX_LOG',
  'FAKE_ENGINE_LOG',
  'FAKE_STACK_STATUS_FILE',
  'FAKE_STACK_LIST_FILE',
  'FAKE_SUPA_APP_URL_FILE',
] as const;

const harnesses: Harness[] = [];

afterEach(async () => {
  stateModule.removeStackState();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/**
 * Run `down` in this process under the harness contract. The command body is
 * spawned-tested elsewhere; this file injects the web stop result, which no
 * real process can produce (a killed PID is always gone) without waiting on
 * the stop timeout.
 */
async function withHarness<T>(
  harness: Harness,
  extra: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  const saved = new Map(HARNESS_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries({ ...harness.env, ...extra })) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function downCommand(all = false): ParsedDown {
  return {
    command: 'down',
    json: false,
    passthrough: [],
    ensure: null,
    down: { all, stack: null },
    build: null,
    yes: true,
  };
}

/** The lease, its app-port claim and the stack attribution `down` must keep. */
function seedRecords(harness: Harness, appPort: number): string {
  const branch = repoModule.currentBranchRef();
  const stackName = harness.env.SUPABASE_STACK ?? '';
  const projectId = leaseModule.leaseProjectId(
    stateModule.identityKey(REPO_ROOT, branch, stackName),
  );
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
  const claim = leaseModule.claimAppPort(harness.registryDir, appPort, projectId);
  if (!claim.ok) throw new Error('could not seed the app-port claim');
  stateModule.writeStackState({
    stackName,
    profile: 'web',
    cold: false,
    updatedAt: new Date().toISOString(),
  });
  return projectId;
}

function expectRecordsKept(harness: Harness, projectId: string, appPort: number): void {
  expect(leaseModule.readLease(harness.registryDir, projectId)?.appPort).toBe(appPort);
  expect(leaseModule.readAppPortClaim(harness.registryDir, appPort)?.projectId).toBe(projectId);
  expect(stateModule.readStackState()).not.toBeNull();
}

function expectRecordsReleased(harness: Harness, projectId: string, appPort: number): void {
  expect(leaseModule.readLease(harness.registryDir, projectId)).toBeNull();
  expect(leaseModule.readAppPortClaim(harness.registryDir, appPort)).toBeNull();
  expect(stateModule.readStackState()).toBeNull();
}

/** A stop that declined and left `pid` alive. */
function survivingWeb(pid: number): DownWebGuard {
  return { stop: () => ({ pid, stopped: false }), alive: (candidate) => candidate === pid };
}

/** A stop that really removed `pid`. */
function stoppedWeb(pid: number): DownWebGuard {
  return { stop: () => ({ pid, stopped: true }), alive: () => false };
}

async function failureOf(run: () => Promise<number>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`expected an Error, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected the command to fail');
}

describe('env:down reports a web survivor before any terminal state', () => {
  it('refuses the shared-mode release and keeps every record', async () => {
    const harness = newHarness();

    await withHarness(harness, { SUPABASE_SHARED: '1', APP_PORT: '3999' }, async () => {
      const projectId = seedRecords(harness, 3999);

      const failure = await failureOf(() => downModule.runDown(downCommand(), survivingWeb(4242)));

      expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
      expect(failure.message).toContain('4242');
      expect(failure.message).toContain('kept the app-port lease and stack records');
      expectRecordsKept(harness, projectId, 3999);
      // Shared `down` never touches the foreign stack.
      expect(harness.bunxCalls()).toBe('');
    });
  });

  it('refuses the confirmed-absence release and keeps every record', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    harness.setListFixture({ stacks: [] });

    await withHarness(harness, { SUPABASE_SHARED: '0', APP_PORT: '3999' }, async () => {
      const projectId = seedRecords(harness, 3999);

      const failure = await failureOf(() => downModule.runDown(downCommand(), survivingWeb(4242)));

      expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
      expect(failure.message).toContain('4242');
      expectRecordsKept(harness, projectId, 3999);
    });
  });

  it('refuses the release after `down --all` shut the stack down', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    harness.setListFixture({ stacks: [] });

    await withHarness(harness, { SUPABASE_SHARED: '0', APP_PORT: '3999' }, async () => {
      const projectId = seedRecords(harness, 3999);

      const failure = await failureOf(() =>
        downModule.runDown(downCommand(true), survivingWeb(4242)),
      );

      expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
      expect(failure.message).toContain('4242');
      // The stack itself is down; only the records and the exit code hold back.
      expect(harness.bunxCalls()).toContain('stack stop --output-format json');
      expectRecordsKept(harness, projectId, 3999);
    });
  });

  it('keeps the lease over a live stack and reports the survivor without cleanup', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    harness.setListFixture({ stacks: [] });

    await withHarness(harness, { SUPABASE_SHARED: '0', APP_PORT: '3999' }, async () => {
      const projectId = seedRecords(harness, 3999);

      const status = await downModule.runDown(downCommand(), survivingWeb(4242));

      // Plain `down` over a running stack keeps the lease regardless, so the
      // survivor only changes what is reported, not what is cleaned up.
      expect(status).toBe(0);
      expectRecordsKept(harness, projectId, 3999);
      // The stack is still running: `down` must not have stopped it.
      expect(harness.bunxCalls()).not.toContain('stack stop');
    });
  });
});

describe('env:down still releases over a proved stop', () => {
  it('releases the shared-mode lease and attribution after a stopped web server', async () => {
    const harness = newHarness();

    await withHarness(harness, { SUPABASE_SHARED: '1', APP_PORT: '3999' }, async () => {
      const projectId = seedRecords(harness, 3999);

      const status = await downModule.runDown(downCommand(), stoppedWeb(5151));

      expect(status).toBe(0);
      expectRecordsReleased(harness, projectId, 3999);
    });
  });

  it('releases the lease and attribution when the stack is confirmed absent', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    harness.setListFixture({ stacks: [] });

    await withHarness(harness, { SUPABASE_SHARED: '0', APP_PORT: '3999' }, async () => {
      const projectId = seedRecords(harness, 3999);

      const status = await downModule.runDown(downCommand(), stoppedWeb(5151));

      expect(status).toBe(0);
      expectRecordsReleased(harness, projectId, 3999);
    });
  });
});

describe('env:down web stop outcome', () => {
  it('reports a survivor and its PID, and nothing for a clean stop', () => {
    expect(downModule.stopWebForDown(survivingWeb(4242))).toEqual({
      line: 'Web pid 4242 could not be stopped; leaving it.',
      survivor: 4242,
    });
    expect(downModule.stopWebForDown(stoppedWeb(5151))).toEqual({
      line: "Stopped this checkout's web server (pid 5151)",
      survivor: null,
    });
    expect(
      downModule.stopWebForDown({ stop: () => ({ pid: null, stopped: false }), alive: () => true }),
    ).toEqual({ line: 'Web server is not running in this checkout.', survivor: null });
  });
});
