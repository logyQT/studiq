import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appPortBase,
  createHarness,
  firstFreePort,
  objectField,
  parseJsonObject,
  REPO_ROOT,
  stackStatusFixture,
  startHttpServer,
  stoppedStackFixture,
  type Harness,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface ParsedCommand {
  command: string;
  json: boolean;
  build: { force: boolean; stack: string | null; app: 'web' | 'admin'; admission: string } | null;
}

interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintAfter: string;
}

interface BuildRecord {
  fingerprint: string;
  envHash: string;
  builtAt: string;
}

interface StateModule {
  readBuildState(): BuildRecord | null;
  writeBuildState(state: BuildRecord): void;
  classifyBuildArtifact(
    expected: { fingerprint: string | null; envHash: string | null },
    artifactDir?: string,
  ): 'current' | 'stale' | 'unrecorded' | 'missing' | null;
  classifyRecordedArtifact(
    artifactDir?: string,
  ): 'current' | 'stale' | 'unrecorded' | 'missing' | null;
}

interface ProductionBuildModule {
  runProductionBuild(
    envHash: string,
    deps: {
      readWebPid(): number | null;
      spawnBuild(slot: unknown): Promise<{
        status: number | null;
        timedOut: boolean;
        output: string;
        durationMs?: number;
      }>;
      artifactDir?: string;
      onInvalidate?(): void;
      slots?: {
        waitMs?: number;
        decide?(activeSlots: number): AdmissionDecision;
      };
    },
    options?: { app: 'web' | 'admin'; admission: 'slot' | 'no-slot' | 'no-lock' },
  ): Promise<BuildResult>;
}

interface BuildCommandModule {
  runBuild(
    parsed: ParsedCommand,
    deps?: { build(envHash: string, options: unknown): Promise<BuildResult> },
  ): Promise<number>;
}

interface StatusModule {
  runStatus(parsed: ParsedCommand): Promise<number>;
}

interface SnapshotModule {
  collectSnapshot(options: {
    artifactDir?: string;
    stack: null;
    skipStackLookup: boolean;
    web: { pid: number | null; http: number };
    supabaseHttp: number;
  }): Promise<{
    build: { present: boolean; fingerprint: string | null; state: string | null; failed: string[] };
  }>;
}

interface ServeModule {
  runServe(parsed: ParsedCommand): Promise<number>;
}

interface WebModule {
  startWebServer(options: unknown): number;
}

interface FingerprintModule {
  computeBuildFingerprint(input: { root: string; mode: string; envHash: string }): string;
}

interface AdmissionDecision {
  admit: boolean;
  cap: number;
  reason: string;
}

interface LocksModule {
  processStartTime(pid: number): string | null;
  withBuildSlots<T>(
    fn: (slot: unknown) => Promise<T>,
    options?: {
      decide?(activeSlots: number): AdmissionDecision;
      invalidate?(worktree: string): void;
      artifactDir?: string;
      waitMs?: number;
    },
  ): Promise<T>;
}

// `state.ts` captures DEV_DIR at import time; keep the suite off the real `.dev/`.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-record-state-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const baselineEnv: NodeJS.ProcessEnv = { ...process.env };

const atomsModule = await loadEnvModule<{ parseCommand(argv: string[]): ParsedCommand }>(
  'atoms.ts',
);
const stateModule = await loadEnvModule<StateModule>('lib/state.ts');
const buildModule = await loadEnvModule<ProductionBuildModule>('lib/build.ts');
const buildCommandModule = await loadEnvModule<BuildCommandModule>('commands/build.ts');
const statusModule = await loadEnvModule<StatusModule>('commands/status.ts');
const snapshotModule = await loadEnvModule<SnapshotModule>('lib/snapshot.ts');
const serveModule = await loadEnvModule<ServeModule>('commands/serve.ts');
const webModule = await loadEnvModule<WebModule>('lib/web.ts');
const fingerprintModule = await loadEnvModule<FingerprintModule>('lib/fingerprint.ts');
const locksModule = await loadEnvModule<LocksModule>('lib/locks.ts');

const dirs: string[] = [];
const harnesses: Harness[] = [];

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const harness of harnesses.splice(0)) void harness.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(baselineEnv)) process.env[key] = value;
});

function parse(argv: string[]): ParsedCommand {
  return atomsModule.parseCommand(argv);
}

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

/** A running local stack so the build commands can resolve their public values. */
async function runningStack(harness: Harness): Promise<void> {
  const http = await startHttpServer(200);
  harness.track(() => http.close());
  harness.setStatusFixture(stackStatusFixture({ apiUrl: http.url, apiPort: http.port }));
}

/**
 * A `git` first on `PATH` that records its arguments and then runs the real one.
 *
 * It is transparent, so anything that does call git still works — which is the
 * point: the log says whether a code path ran `git` at all, not whether it
 * succeeded. Restore before the assertions so a failure cannot leak the shim
 * into another test.
 */
function installGitShim(): { calls(): string[]; restore(): void } {
  const realGit = (process.env.PATH ?? '')
    .split(':')
    .filter(Boolean)
    .map((dir) => join(dir, 'git'))
    .find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (realGit === undefined) throw new Error('no git on PATH to wrap');
  const shimDir = mkdtempSync(join(tmpdir(), 'studiq-env-git-shim-'));
  dirs.push(shimDir);
  const log = join(shimDir, 'calls.log');
  // The log path is baked into the shim: a second env key would have to be
  // declared in `.env.schema` for a test-only scratch file.
  writeFileSync(
    join(shimDir, 'git'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${log}"\nexec ${realGit} "$@"\n`,
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${originalPath ?? ''}`;
  return {
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
    restore: () => {
      process.env.PATH = originalPath;
    },
  };
}

/** A temporary `apps/web/.next` with a `BUILD_ID`, as a build leaves it. */
function newArtifact(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-artifact-'));
  dirs.push(dir);
  const artifact = join(dir, '.next');
  mkdirSync(artifact, { recursive: true });
  writeFileSync(join(artifact, 'BUILD_ID'), 'built');
  return artifact;
}

/** The `.next.failed-*` siblings a failed build leaves beside the artifact. */
function failedSiblings(artifact: string): string[] {
  return readdirSync(dirname(artifact)).filter((name) =>
    name.startsWith(`${basename(artifact)}.failed-`),
  );
}

function writeRecord(overrides: Partial<BuildRecord> = {}): void {
  stateModule.writeBuildState({
    fingerprint: 'fingerprint',
    envHash: 'env-hash',
    builtAt: new Date().toISOString(),
    ...overrides,
  });
}

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

function succeed(): Promise<{
  status: number;
  timedOut: boolean;
  output: string;
  durationMs: number;
}> {
  return Promise.resolve({ status: 0, timedOut: false, output: '', durationMs: 1 });
}

function buildResult(): BuildResult {
  return { ok: true, timedOut: false, output: '', fingerprintAfter: 'fingerprint-after' };
}

const admitOne = (): AdmissionDecision => ({ admit: true, cap: 1, reason: 'memory' });

function registry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-record-registry-'));
  dirs.push(dir);
  process.env.STUDIQ_DEV_REGISTRY = dir;
  return dir;
}

function writeSlot(
  registryDir: string,
  slot: number,
  fixture: { pid: number; start: string; worktree: string },
): void {
  const path = join(registryDir, 'build-slots', String(slot));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(path, 'pid'), `${fixture.pid}\n`);
  writeFileSync(join(path, 'start'), `${fixture.start}\n`);
  writeFileSync(join(path, 'pgid'), '0\n');
  writeFileSync(join(path, 'pgidStart'), '\n');
  writeFileSync(join(path, 'token'), 'fixture-token\n');
  writeFileSync(join(path, 'worktree'), `${fixture.worktree}\n`);
  writeFileSync(join(path, 'startedAt'), `${new Date().toISOString()}\n`);
  writeFileSync(join(path, 'heartbeat'), `${Date.now()}\n`);
}

describe('every wrapper build deletes the record before it spawns', () => {
  for (const admission of ['slot', 'no-slot', 'no-lock'] as const) {
    it(`deletes .dev/build.json before a ${admission} build starts`, async () => {
      registry();
      writeRecord();
      let recordAtSpawn: BuildRecord | null | 'never-spawned' = 'never-spawned';

      await buildModule.runProductionBuild(
        'env-hash',
        {
          readWebPid: () => null,
          spawnBuild: () => {
            recordAtSpawn = stateModule.readBuildState();
            return succeed();
          },
          artifactDir: newArtifact(),
        },
        { app: 'web', admission },
      );

      // The previous run's "current" claim is gone by the time the build can
      // write `.next`: an interrupted or failed build cannot inherit it.
      expect(recordAtSpawn).toBeNull();
    });
  }

  it('leaves the record alone when no build runs', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    vi.spyOn(stateModule, 'classifyBuildArtifact').mockReturnValue('current');
    writeRecord({ fingerprint: 'fingerprint' });

    const code = await buildCommandModule.runBuild(parse(['build']), {
      build: () => Promise.reject(new Error('a current artifact must not build')),
    });

    expect(code).toBe(0);
    expect(stateModule.readBuildState()).toMatchObject({ fingerprint: 'fingerprint' });
  });
});

describe('only a successful fingerprinted build writes the record back', () => {
  it('records a slot build and a --no-slot build, never a --no-lock one', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const deps = { build: () => Promise.resolve(buildResult()) };

    expect(await buildCommandModule.runBuild(parse(['build', '--force']), deps)).toBe(0);
    expect(stateModule.readBuildState()).toMatchObject({ fingerprint: 'fingerprint-after' });

    rmSync(join(stateDir, 'build.json'), { force: true });
    expect(await buildCommandModule.runBuild(parse(['build', '--force', '--no-slot']), deps)).toBe(
      0,
    );
    expect(stateModule.readBuildState()).toMatchObject({ fingerprint: 'fingerprint-after' });

    rmSync(join(stateDir, 'build.json'), { force: true });
    const stdout = await captureStdout(() =>
      buildCommandModule.runBuild(parse(['build', '--force', '--no-lock', '--json']), deps),
    );
    // A bypassed artifact is unrecorded by construction, so nothing may report
    // a `builtAt` for it either.
    expect(stateModule.readBuildState()).toBeNull();
    expect(objectField(parseJsonObject(stdout), 'buildRun')).toMatchObject({
      admission: 'no-lock',
      built: true,
      builtAt: null,
    });
  });
});

describe('a failed build never writes the record', () => {
  it('leaves .dev/build.json absent and throws the build’s exit code', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);

    const failure = await buildCommandModule
      .runBuild(parse(['build', '--force']), {
        build: () =>
          Promise.resolve({
            ok: false,
            timedOut: false,
            output: 'Error: boom',
            fingerprintAfter: 'after-the-failure',
          }),
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    // A record written before the failure is thrown away would describe an
    // artifact the failed run never produced — and would keep describing it if
    // the move-aside also failed.
    expect(stateModule.readBuildState()).toBeNull();
  });
});

describe('a failed build is never current', () => {
  it('moves .next aside and removes the record on a nonzero exit', async () => {
    registry();
    const artifact = newArtifact();
    writeRecord();

    const result = await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () =>
          Promise.resolve({ status: 1, timedOut: false, output: 'Error: boom', durationMs: 5 }),
        artifactDir: artifact,
      },
      { app: 'web', admission: 'no-slot' },
    );

    expect(result.ok).toBe(false);
    expect(stateModule.readBuildState()).toBeNull();
    // The half-written tree is not where a serve path looks for it any more.
    expect(existsSync(artifact)).toBe(false);
    const failed = failedSiblings(artifact);
    expect(failed).toHaveLength(1);
    expect(readFileSync(join(dirname(artifact), failed[0] ?? '', 'BUILD_ID'), 'utf8')).toBe(
      'built',
    );
  });

  it('does the same on a timed-out build', async () => {
    registry();
    const artifact = newArtifact();
    writeRecord();

    const result = await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () =>
          Promise.resolve({ status: null, timedOut: true, output: '', durationMs: 5 }),
        artifactDir: artifact,
      },
      { app: 'web', admission: 'no-slot' },
    );

    expect(result.timedOut).toBe(true);
    expect(stateModule.readBuildState()).toBeNull();
    expect(existsSync(artifact)).toBe(false);
    expect(failedSiblings(artifact)).toHaveLength(1);
  });

  it('clears the failed artifact when a later build succeeds', async () => {
    registry();
    const artifact = newArtifact();

    await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () =>
          Promise.resolve({ status: 1, timedOut: false, output: 'Error: boom', durationMs: 5 }),
        artifactDir: artifact,
      },
      { app: 'web', admission: 'no-slot' },
    );
    expect(failedSiblings(artifact)).toHaveLength(1);

    // A real success rewrites `.next`, so the fake spawn leaves a fresh BUILD_ID
    // behind and the record's period of evidence is over.
    const rebuilt = await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () => {
          mkdirSync(artifact, { recursive: true });
          writeFileSync(join(artifact, 'BUILD_ID'), 'rebuilt');
          return succeed();
        },
        artifactDir: artifact,
      },
      { app: 'web', admission: 'no-slot' },
    );

    expect(rebuilt.ok).toBe(true);
    expect(failedSiblings(artifact)).toHaveLength(0);
  });

  it('keeps one failed artifact, not one per attempt', async () => {
    registry();
    const artifact = newArtifact();
    const older = `${artifact}.failed-2020-01-01T00-00-00-000Z`;
    mkdirSync(older, { recursive: true });

    await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () =>
          Promise.resolve({ status: 1, timedOut: false, output: 'Error: boom', durationMs: 5 }),
        artifactDir: artifact,
      },
      { app: 'web', admission: 'no-slot' },
    );

    expect(existsSync(older)).toBe(false);
    expect(failedSiblings(artifact)).toHaveLength(1);
  });

  it('leaves an admin build’s artifact and the web record alone', async () => {
    registry();
    const webArtifact = newArtifact();
    writeRecord();

    const result = await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () =>
          Promise.resolve({ status: 1, timedOut: false, output: 'Error: boom', durationMs: 5 }),
        artifactDir: webArtifact,
      },
      { app: 'admin', admission: 'no-slot' },
    );

    expect(result.ok).toBe(false);
    // `apps/admin` has no record and no fingerprint; its failure must not
    // invalidate the web artifact the record describes.
    expect(stateModule.readBuildState()).not.toBeNull();
    expect(existsSync(join(webArtifact, 'BUILD_ID'))).toBe(true);
    expect(failedSiblings(webArtifact)).toHaveLength(0);
  });
});

describe('the invalidation happens before the slot is released', () => {
  it('has moved the artifact aside and still holds its slot when the hook runs', async () => {
    const dir = registry();
    const artifact = newArtifact();
    writeRecord();
    let slotAtInvalidation: boolean | null = null;
    let corpsesAtInvalidation: number | null = null;

    const result = await buildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () =>
          Promise.resolve({ status: 1, timedOut: false, output: 'Error: boom', durationMs: 5 }),
        artifactDir: artifact,
        onInvalidate: () => {
          slotAtInvalidation = existsSync(join(dir, 'build-slots', '1'));
          corpsesAtInvalidation = failedSiblings(artifact).length;
        },
      },
      { app: 'web', admission: 'slot' },
    );

    expect(result.ok).toBe(false);
    // Both facts are required: the slot must still be held (releasing it first
    // would admit the next build over an artifact that is still there) and the
    // move-aside must already have happened (a hook that only proves the slot
    // is held would pass with the invalidation deferred past the release).
    expect(slotAtInvalidation).toBe(true);
    expect(corpsesAtInvalidation).toBe(1);
    expect(existsSync(join(dir, 'build-slots', '1'))).toBe(false);
  });
});

describe('a build that is never admitted leaves the record alone', () => {
  it('keeps the previous claim when the slot wait expires (exit 7)', async () => {
    const dir = registry();
    const artifact = newArtifact();
    writeRecord();
    // A live slot, so this build cannot be admitted inside a zero-length wait.
    writeSlot(dir, 1, {
      pid: process.pid,
      start: locksModule.processStartTime(process.pid) ?? '',
      worktree: REPO_ROOT,
    });
    let spawned = false;

    const failure = await buildModule
      .runProductionBuild(
        'env-hash',
        {
          readWebPid: () => null,
          spawnBuild: () => {
            spawned = true;
            return succeed();
          },
          artifactDir: artifact,
          slots: { waitMs: 0, decide: () => ({ admit: true, cap: 1, reason: 'memory' }) },
        },
        { app: 'web', admission: 'slot' },
      )
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 7 });
    expect(spawned).toBe(false);
    // Nothing touched `.next`, so the previous artifact's claim is still true.
    expect(stateModule.readBuildState()).toMatchObject({ fingerprint: 'fingerprint' });
    expect(existsSync(join(artifact, 'BUILD_ID'))).toBe(true);
  });
});

describe('the reclaim invalidates before the slot is reused', () => {
  it('moves this checkout’s artifact aside and drops the record', async () => {
    const dir = registry();
    const artifact = newArtifact();
    writeRecord();
    writeSlot(dir, 1, { pid: 999_999_999, start: 'gone', worktree: REPO_ROOT });

    let artifactAtAdmission: boolean | null = null;
    let recordAtAdmission: BuildRecord | null = null;
    await locksModule.withBuildSlots(
      () => {
        artifactAtAdmission = existsSync(artifact);
        recordAtAdmission = stateModule.readBuildState();
        return Promise.resolve();
      },
      { decide: admitOne, artifactDir: artifact },
    );

    expect(artifactAtAdmission).toBe(false);
    expect(recordAtAdmission).toBeNull();
    expect(failedSiblings(artifact)).toHaveLength(1);
    expect(existsSync(join(dir, 'build-slots', '1'))).toBe(false);
  });

  it('leaves a foreign worktree’s artifact to that checkout', async () => {
    const dir = registry();
    const artifact = newArtifact();
    writeRecord();
    writeSlot(dir, 1, { pid: 999_999_999, start: 'gone', worktree: '/tmp/another-worktree' });

    await locksModule.withBuildSlots(() => Promise.resolve(), {
      decide: admitOne,
      artifactDir: artifact,
    });

    // Writing into another checkout from here would be worse than the stale
    // artifact: its own next build invalidates it (ADR-0014, decision 5).
    expect(existsSync(join(artifact, 'BUILD_ID'))).toBe(true);
    expect(failedSiblings(artifact)).toHaveLength(0);
  });
});

/** An artifact whose `BUILD_ID` is older than `builtAt`, as a real build leaves it. */
function artifactWithBuiltAt(builtAt: Date): string {
  const artifact = newArtifact();
  const buildId = join(artifact, 'BUILD_ID');
  utimesSync(buildId, new Date(builtAt.getTime() - 1_000), new Date(builtAt.getTime() - 1_000));
  return artifact;
}

describe('the artifact state needs a record, a fingerprint and a fresh BUILD_ID', () => {
  it('is missing without a BUILD_ID', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studiq-env-artifact-'));
    dirs.push(dir);
    expect(
      stateModule.classifyBuildArtifact(
        { fingerprint: 'fingerprint', envHash: 'env-hash' },
        join(dir, '.next'),
      ),
    ).toBe('missing');
  });

  it('is unrecorded when no record exists', () => {
    const artifact = newArtifact();
    expect(
      stateModule.classifyBuildArtifact(
        { fingerprint: 'fingerprint', envHash: 'env-hash' },
        artifact,
      ),
    ).toBe('unrecorded');
  });

  it('is current when the record, the fingerprint and the mtime agree', () => {
    const artifact = artifactWithBuiltAt(new Date());
    writeRecord();
    expect(
      stateModule.classifyBuildArtifact(
        { fingerprint: 'fingerprint', envHash: 'env-hash' },
        artifact,
      ),
    ).toBe('current');
  });

  it('is unrecorded when a raw next build moved BUILD_ID past the record', () => {
    const builtAt = new Date(Date.now() - 60_000);
    const artifact = newArtifact();
    writeRecord({ builtAt: builtAt.toISOString() });
    // The tree still matches the record, so only the mtime can catch this.
    expect(
      stateModule.classifyBuildArtifact(
        { fingerprint: 'fingerprint', envHash: 'env-hash' },
        artifact,
      ),
    ).toBe('unrecorded');
  });

  it('is unrecorded when the record carries no builtAt', () => {
    const artifact = artifactWithBuiltAt(new Date());
    writeRecord({ builtAt: '' });
    expect(
      stateModule.classifyBuildArtifact(
        { fingerprint: 'fingerprint', envHash: 'env-hash' },
        artifact,
      ),
    ).toBe('unrecorded');
  });

  it('is stale when the tree moved past the record', () => {
    const artifact = artifactWithBuiltAt(new Date());
    writeRecord();
    expect(
      stateModule.classifyBuildArtifact({ fingerprint: 'other', envHash: 'env-hash' }, artifact),
    ).toBe('stale');
  });

  it('is stale when the inlined environment changed', () => {
    const artifact = artifactWithBuiltAt(new Date());
    writeRecord();
    expect(
      stateModule.classifyBuildArtifact({ fingerprint: 'fingerprint', envHash: 'other' }, artifact),
    ).toBe('stale');
  });

  it('is unknown when the fingerprint could not be computed', () => {
    const artifact = artifactWithBuiltAt(new Date());
    writeRecord();
    expect(
      stateModule.classifyBuildArtifact({ fingerprint: null, envHash: 'env-hash' }, artifact),
    ).toBeNull();
  });
});

describe('status and serve report the record, not just the fingerprint', () => {
  it('reports current, stale, unrecorded and missing distinctly', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    applyHarnessEnv(harness);

    for (const state of ['current', 'stale', 'unrecorded', 'missing'] as const) {
      // The one classifier status (and the manifest) call, so the four reported
      // answers are the shipped vocabulary and not a second decision.
      vi.spyOn(stateModule, 'classifyRecordedArtifact').mockReturnValue(state);
      const json = await captureStdout(() => statusModule.runStatus(parse(['status', '--json'])));
      expect(objectField(parseJsonObject(json), 'build').state).toBe(state);
      const text = await captureStdout(() => statusModule.runStatus(parse(['status'])));
      expect(text).toContain(`build       ${state}`);
    }
  });

  it('reports stale when the tree moved past the record', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    applyHarnessEnv(harness);
    const artifact = newArtifact();
    // A record whose fingerprint cannot describe this tree, with a `builtAt`
    // after the artifact: only the fingerprint comparison can call it stale.
    writeRecord({ fingerprint: 'recorded-from-another-tree' });

    const snapshot = await snapshotModule.collectSnapshot({
      artifactDir: artifact,
      stack: null,
      skipStackLookup: true,
      web: { pid: null, http: 0 },
      supabaseHttp: 0,
    });

    expect(snapshot.build.present).toBe(true);
    expect(snapshot.build.state).toBe('stale');
    expect(snapshot.build.fingerprint).toBe('recorded-from-another-tree');
  });

  it('answers missing and unrecorded without running git at all', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    applyHarnessEnv(harness);
    const artifact = newArtifact();
    // The headline `unrecorded`: a wrapper build's record, then a raw
    // `next build` that moved `BUILD_ID` past it. The fingerprint cannot help —
    // the tree still matches — so the mtime rule has to decide it for free.
    writeRecord({ builtAt: new Date(Date.now() - 60_000).toISOString() });
    const missingArtifact = join(dirname(artifact), '.next-missing');

    const shim = installGitShim();
    let unrecorded: Awaited<ReturnType<SnapshotModule['collectSnapshot']>>;
    let missing: Awaited<ReturnType<SnapshotModule['collectSnapshot']>>;
    try {
      unrecorded = await snapshotModule.collectSnapshot({
        artifactDir: artifact,
        stack: null,
        skipStackLookup: true,
        web: { pid: null, http: 0 },
        supabaseHttp: 0,
      });
      missing = await snapshotModule.collectSnapshot({
        artifactDir: missingArtifact,
        stack: null,
        skipStackLookup: true,
        web: { pid: null, http: 0 },
        supabaseHttp: 0,
      });
    } finally {
      shim.restore();
    }

    expect(unrecorded.build.state).toBe('unrecorded');
    expect(missing.build.state).toBe('missing');
    // The shim is live: `currentCommit` ran through it, so an empty list below
    // means the fingerprint's commands never ran rather than that the shim was
    // bypassed.
    expect(shim.calls().some((line) => line.includes('--short HEAD'))).toBe(true);
    // `currentCommit` still runs git; the fingerprint's two commands must not.
    const fingerprinted = shim
      .calls()
      .filter((line) => line.includes('HEAD^{tree}') || line.includes('--porcelain'));
    expect(fingerprinted).toEqual([]);
  });

  it('refuses to serve an unrecorded artifact and names the state', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    applyHarnessEnv(harness);
    process.env.APP_PORT = String(await firstFreePort(appPortBase()));
    vi.spyOn(fingerprintModule, 'computeBuildFingerprint').mockReturnValue('fingerprint');
    vi.spyOn(stateModule, 'classifyBuildArtifact').mockReturnValue('unrecorded');
    const start = vi.spyOn(webModule, 'startWebServer');

    const failure = await serveModule.runServe(parse(['serve'])).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('unrecorded');
    expect(failure.message).toContain('env:build');
    expect(start).not.toHaveBeenCalled();
  });

  it('rebuilds an unrecorded artifact instead of trusting it', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    vi.spyOn(stateModule, 'classifyBuildArtifact').mockReturnValue('unrecorded');
    let builds = 0;

    const stdout = await captureStdout(() =>
      buildCommandModule.runBuild(parse(['build', '--json']), {
        build: () => {
          builds += 1;
          return Promise.resolve(buildResult());
        },
      }),
    );

    expect(builds).toBe(1);
    expect(objectField(parseJsonObject(stdout), 'buildRun')).toMatchObject({ built: true });
  });
});
