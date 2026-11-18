import { spawn, spawnSync } from 'node:child_process';
import {
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
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUN,
  createHarness,
  objectField,
  parseJsonObject,
  REPO_ROOT,
  stackStatusFixture,
  startHttpServer,
  type Harness,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface BuildOptions {
  force: boolean;
  stack: string | null;
}

interface ParsedCommand {
  command: string;
  json: boolean;
  passthrough: string[];
  ensure: null;
  down: null;
  build: BuildOptions | null;
  yes: boolean;
}

interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintBefore?: string;
  fingerprintAfter: string;
  /** True when the tree moved while the build ran: built, but not recordable. */
  fingerprintMoved?: boolean;
  invalidated?: string | null;
}

interface BuildModule {
  runBuild(
    parsed: ParsedCommand,
    deps?: { build(envHash: string): Promise<BuildResult> },
  ): Promise<number>;
}

interface ProductionBuildModule {
  runProductionBuild(
    envHash: string,
    deps: {
      readWebPid(): number | null;
      spawnBuild(slot: unknown): Promise<{
        status: number | null;
        signal?: string | null;
        timedOut: boolean;
        output: string;
        durationMs?: number;
      }>;
      artifactDir?: string;
      /** Test seam: the tree fingerprint, so a test can move the tree mid-build. */
      fingerprint?(input: { root: string; mode: string; envHash: string }): string;
    },
    options?: { app: 'web' | 'admin'; admission: 'slot' | 'no-slot' | 'no-lock' },
  ): Promise<BuildResult>;
  describeBuildVerdict(facts: {
    status: number | null;
    signal: string | null;
    timedOut: boolean;
    artifact: 'missing' | 'fresh' | 'left-over' | null;
    fingerprintBefore: string;
    fingerprintAfter: string;
  }): string[];
}

interface StateModule {
  readBuildState(): Record<string, unknown> | null;
}

interface HandoverRecord {
  artifactDir: string;
  backupPath: string;
  previousPid: number | null;
  /** The process that owns the in-flight rebuild, when another one is running. */
  ownerPid?: number | null;
  phase: 'backed-up' | 'committed';
  at: string;
}

// `state.ts` and `rebuild.ts` capture DEV_DIR at import time.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-build-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
// `runProductionBuild` admits through the registry; keep that off the real one.
const registryDir = mkdtempSync(join(tmpdir(), 'studiq-env-build-registry-'));
process.env.STUDIQ_DEV_REGISTRY = registryDir;

const atomsModule = await loadEnvModule<{ parseCommand(argv: string[]): ParsedCommand }>(
  'atoms.ts',
);
const buildModule = await loadEnvModule<BuildModule>('commands/build.ts');
const productionBuildModule = await loadEnvModule<ProductionBuildModule>('lib/build.ts');
const locksModule = await loadEnvModule<{ worktreeKey(root?: string): string }>('lib/locks.ts');
const stateModule = await loadEnvModule<StateModule>('lib/state.ts');
const fingerprintModule = await loadEnvModule<{
  BUILD_MODE: string;
  computeBuildFingerprint(input: { root: string; mode: string; envHash: string }): string;
}>('lib/fingerprint.ts');

const handoverPath = join(stateDir, 'handover.json');
const baselineEnv: NodeJS.ProcessEnv = { ...process.env };
const harnesses: Harness[] = [];
const caseDirs: string[] = [];

afterAll(() => {
  for (const dir of caseDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(registryDir, { recursive: true, force: true });
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(baselineEnv)) process.env[key] = value;
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
  rmSync(join(registryDir, 'build-slots'), { recursive: true, force: true });
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

/** A running local stack so `env:build` can resolve its shared/public values. */
async function runningStack(harness: Harness): Promise<void> {
  const http = await startHttpServer(200);
  harness.track(() => http.close());
  harness.setStatusFixture(stackStatusFixture({ apiUrl: http.url, apiPort: http.port }));
}

function newCase(): { dir: string; artifactDir: string; backupDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-build-case-'));
  caseDirs.push(dir);
  const artifactDir = join(dir, '.next');
  const backupDir = join(dir, 'backups');
  mkdirSync(backupDir, { recursive: true });
  return { dir, artifactDir, backupDir };
}

function writeRecord(record: HandoverRecord): void {
  writeFileSync(handoverPath, `${JSON.stringify(record, null, 2)}\n`);
}

function makeBackup(backupDir: string, name: string): string {
  const backupPath = join(backupDir, name);
  mkdirSync(backupPath, { recursive: true });
  writeFileSync(join(backupPath, 'BUILD_ID'), 'old-build');
  return backupPath;
}

function buildResult(): BuildResult {
  return { ok: true, timedOut: false, output: '', fingerprintAfter: 'fingerprint-after' };
}

function parsedBuild(): ParsedCommand {
  return atomsModule.parseCommand(['build', '--force']);
}

function parsedJson(): ParsedCommand {
  return atomsModule.parseCommand(['build', '--json']);
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

describe('env:build does not hold the checkout lock while it builds', () => {
  it('lets another env process take the checkout lock during the build', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const lockFile = join(stateDir, 'locks', 'checkout.lock');
    // `flock -n` proves the lock is free; the portable fallback has no probe, so
    // the assertion is skipped where `flock` is unavailable.
    const flockAvailable = spawnSync('flock', ['--version'], { timeout: 5_000 }).status === 0;

    let lockFreeDuringBuild: boolean | null = null;
    const code = await buildModule.runBuild(parsedBuild(), {
      build() {
        // A 30-minute slot wait under the checkout lock would block `env:down`
        // for the whole build; the lock must be free here.
        lockFreeDuringBuild = flockAvailable
          ? spawnSync('flock', ['-n', lockFile, 'true'], { timeout: 5_000 }).status === 0
          : null;
        return Promise.resolve(buildResult());
      },
    });

    expect(code).toBe(0);
    if (flockAvailable) expect(lockFreeDuringBuild).toBe(true);
    // The build command is a state change and clears `building` on the way out;
    // `runProductionBuild` (bypassed by the injected build above) sets it.
    const manifest = parseJsonObject(readFileSync(join(stateDir, 'env.json'), 'utf8'));
    expect(manifest.building).toBeNull();
    expect(objectField(manifest, 'next').build).toBe('bun run env:build');
  });

  it('reports its own write in --json, not the pre-build file', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);

    const stdout = await captureStdout(() =>
      buildModule.runBuild(parsedJson(), {
        build() {
          return Promise.resolve(buildResult());
        },
      }),
    );

    // The printed snapshot reconciles the file, so the success path writes
    // before collecting it; the `finally` write lands after the snapshot.
    const snapshot = parseJsonObject(stdout);
    expect(objectField(snapshot, 'manifest')).toMatchObject({ agrees: true, differences: [] });
  });
});

describe('env:build settles a pending handover before building', () => {
  it('recovers the interrupted build before the build starts', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const { artifactDir, backupDir } = newCase();
    // The interrupted run left an unverified artifact; the previous build is the
    // one recovery must restore before `runBuild` decides anything.
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-pending');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: null,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    let recoveredBeforeBuild = false;
    let builds = 0;
    const code = await buildModule.runBuild(parsedBuild(), {
      build(envHash) {
        builds += 1;
        expect(envHash).toEqual(expect.any(String));
        recoveredBeforeBuild =
          !existsSync(handoverPath) &&
          readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8') === 'old-build';
        return Promise.resolve(buildResult());
      },
    });

    expect(code).toBe(0);
    expect(builds).toBe(1);
    expect(recoveredBeforeBuild).toBe(true);
    expect(existsSync(backupPath)).toBe(false);
    expect(stateModule.readBuildState()).not.toBeNull();
  });

  it('refuses without building when the pending handover cannot be recovered', async () => {
    const harness = newHarness();
    applyHarnessEnv(harness);
    const { dir, backupDir } = newCase();
    // A restore target below a missing parent can never be recreated.
    const artifactDir = join(dir, 'missing-parent', '.next');
    const backupPath = makeBackup(backupDir, 'next-backup-unrestorable');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: null,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    let builds = 0;
    let failure: unknown;
    try {
      await buildModule.runBuild(parsedBuild(), {
        build() {
          builds += 1;
          return Promise.resolve(buildResult());
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(builds).toBe(0);
    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(backupPath);
    // The recovery owns the artifact until it lands: record and backup stay.
    expect(existsSync(handoverPath)).toBe(true);
    expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(stateModule.readBuildState()).toBeNull();
  });

  it('refuses while another process owns the in-flight rebuild', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'served-build');
    const backupPath = makeBackup(backupDir, 'next-backup-owner-busy');
    const owner = spawn(BUN, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const ownerPid = owner.pid;
    if (ownerPid === undefined) throw new Error('the handover owner did not start');
    try {
      writeRecord({
        artifactDir,
        backupPath,
        previousPid: null,
        ownerPid,
        phase: 'backed-up',
        at: '2026-01-01T00:00:00.000Z',
      });

      let builds = 0;
      let failure: unknown;
      try {
        await buildModule.runBuild(parsedBuild(), {
          build() {
            builds += 1;
            return Promise.resolve(buildResult());
          },
        });
      } catch (error) {
        failure = error;
      }

      // The live owner keeps its record, backup and artifact: this build neither
      // builds over nor restores them.
      expect(builds).toBe(0);
      expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
      if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
      expect(failure.message).toContain(`pid ${ownerPid}`);
      expect(existsSync(handoverPath)).toBe(true);
      expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
      expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('served-build');
    } finally {
      owner.kill('SIGKILL');
    }
  });
});

function parsedBuildWith(...flags: string[]): ParsedCommand {
  return atomsModule.parseCommand(['build', '--force', ...flags]);
}

describe('env:build --app and the admission flags', () => {
  it('passes --app admin to the build and records nothing (admin has no fingerprint)', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);

    let seen: unknown = null;
    const code = await buildModule.runBuild(parsedBuildWith('--app', 'admin'), {
      build(_envHash, options) {
        seen = options;
        return Promise.resolve(buildResult());
      },
    });

    expect(code).toBe(0);
    // `snapshot: false` is exact: `apps/admin` has its own `.next/cache` and v1
    // neither stages nor seeds it (ADR-0014, decision 3).
    expect(seen).toEqual({ app: 'admin', admission: 'slot', snapshot: false });
    // `.dev/build.json` describes `apps/web`'s artifact; an admin build must not
    // claim it is current.
    expect(stateModule.readBuildState()).toBeNull();
  });

  it('passes --no-slot through as a slotless admission', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);

    let seen: unknown = null;
    const code = await buildModule.runBuild(parsedBuildWith('--no-slot'), {
      producerReason: () => 'not the primary checkout (a linked worktree never publishes)',
      build(_envHash, options) {
        seen = options;
        return Promise.resolve(buildResult());
      },
    });

    expect(code).toBe(0);
    // The gate is re-read at publish, but staging is skipped up front: a checkout
    // that cannot publish must not pay for the copy.
    expect(seen).toEqual({ app: 'web', admission: 'no-slot', snapshot: false });
  });

  it('records a slot build as current but never a --no-lock one', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const deps = { build: () => Promise.resolve(buildResult()) };

    expect(await buildModule.runBuild(parsedBuild(), deps)).toBe(0);
    expect(stateModule.readBuildState()).not.toBeNull();

    rmSync(join(stateDir, 'build.json'), { force: true });
    expect(await buildModule.runBuild(parsedBuildWith('--no-lock'), deps)).toBe(0);
    // A bypassed artifact is not reported as current by construction.
    expect(stateModule.readBuildState()).toBeNull();
  });

  it('rejects --no-slot together with --no-lock', () => {
    expect(() => atomsModule.parseCommand(['build', '--no-slot', '--no-lock'])).toThrow(
      /conflicts/,
    );
  });

  it('reports no grant when a current artifact means no build ran', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    // `current` also needs the artifact, and this checkout may have none.
    const artifactDir = join(REPO_ROOT, 'apps', 'web', '.next');
    const buildId = join(artifactDir, 'BUILD_ID');
    const createdBuildId = !existsSync(buildId);
    if (createdBuildId) {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(buildId, 'test-build');
    }
    try {
      // Record the fingerprint the command itself will compute, so the second
      // run finds the artifact current and mints nothing.
      let builds = 0;
      const deps = {
        build(envHash: string) {
          builds += 1;
          return Promise.resolve({
            ...buildResult(),
            fingerprintAfter: fingerprintModule.computeBuildFingerprint({
              root: REPO_ROOT,
              mode: fingerprintModule.BUILD_MODE,
              envHash,
            }),
          });
        },
      };
      expect(await buildModule.runBuild(parsedBuild(), deps)).toBe(0);

      const stdout: string[] = [];
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          stdout.push(String(chunk));
          return true;
        });
      try {
        expect(await buildModule.runBuild(parsedJson(), deps)).toBe(0);
      } finally {
        spy.mockRestore();
      }

      expect(builds).toBe(1);
      const payload = parseJsonObject(stdout.join(''));
      expect(objectField(payload, 'buildRun')).toMatchObject({ built: false, grant: null });
    } finally {
      if (createdBuildId) rmSync(buildId, { force: true });
    }
  });

  it('rejects an unknown --app value', () => {
    expect(() => atomsModule.parseCommand(['build', '--app', 'worker'])).toThrow(/web or admin/);
  });
});

describe('env:build reports the cache snapshot step', () => {
  it('passes snapshot:false and names the gate when this checkout cannot publish', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const reason = 'not the primary checkout (a linked worktree never publishes)';
    let seen: unknown = null;
    const deps = {
      producerReason: () => reason,
      build: (_envHash: string, options: unknown) => {
        seen = options;
        return Promise.resolve(buildResult());
      },
    };
    const stderr: string[] = [];
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      expect(await buildModule.runBuild(parsedBuild(), deps)).toBe(0);
    } finally {
      errSpy.mockRestore();
    }

    expect(seen).toEqual({ app: 'web', admission: 'slot', snapshot: false });
    expect(stderr.join('')).toContain(`build: snapshot skipped: ${reason}`);
  });

  it('passes snapshot:true when the checkout is producer-eligible, and reports a copy skip', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    let seen: unknown = null;
    const deps = {
      producerReason: () => null,
      build: (_envHash: string, options: unknown) => {
        seen = options;
        return Promise.resolve({
          ...buildResult(),
          snapshotSkipped: 'staged copy cannot be taken',
        });
      },
    };
    const stderr: string[] = [];
    const stdout: string[] = [];
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    const outSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      });
    try {
      expect(await buildModule.runBuild(parsedBuild(), deps)).toBe(0);
      expect(await buildModule.runBuild(parsedJson(), deps)).toBe(0);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(seen).toEqual({ app: 'web', admission: 'slot', snapshot: true });
    // A build that ran prints its finish line itself; the snapshot verdict is
    // this command's to report, and it must name a reason either way.
    expect(stderr.join('')).toContain('build: snapshot skipped: staged copy cannot be taken');
    const payload = parseJsonObject(stdout.join(''));
    const snapshot = objectField(objectField(payload, 'buildRun'), 'snapshot');
    expect(snapshot['outcome']).toBe('skipped');
    expect(typeof snapshot['reason']).toBe('string');
  });
});

describe('env:build reports a failed build', () => {
  it('throws the exit code and log path after printing the compiler error', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);
    const stderr: string[] = [];
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    // Bun's prebuild lifecycle line arrives right above the compiler error.
    const output =
      '@studiq/web build: Exited with code 0\n' +
      '\u001b[31mError: Expression expected\u001b[0m\n  ./src/x.tsx:36:12\n';

    let failure: unknown;
    try {
      await buildModule.runBuild(parsedBuild(), {
        build() {
          return Promise.resolve({
            ok: false,
            timedOut: false,
            output,
            fingerprintAfter: '',
          });
        },
      });
    } catch (error) {
      failure = error;
    } finally {
      spy.mockRestore();
    }

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toBe('build failed (exit 4); full log: .dev/env.log');
    const text = stderr.join('');
    expect(text).toContain('build: Error: Expression expected');
    expect(text).toContain('build:   ./src/x.tsx:36:12');
    expect(text).not.toContain('\u001b[');
    // A lifecycle exit line must never be re-printed: `code 0` beside a compiler
    // error reads as success.
    expect(text).not.toContain('Exited with code');
  });
});

describe('runProductionBuild refuses a server that appeared while it queued', () => {
  it('re-reads the server under the worktree mutex, before spawning', async () => {
    let mutexAtCheck: boolean | null = null;
    let spawned = 0;

    const failure = await productionBuildModule
      .runProductionBuild('env-hash', {
        readWebPid: () => {
          mutexAtCheck = existsSync(
            join(registryDir, 'build-slots', 'worktrees', locksModule.worktreeKey(REPO_ROOT)),
          );
          return 4242;
        },
        spawnBuild: () => {
          spawned += 1;
          return Promise.resolve({ status: 0, timedOut: false, output: '', durationMs: 1 });
        },
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain('pid 4242');
    // The check runs inside `withBuildSlots`: the mutex is already held when it
    // reads, which is what makes a server started during the slot wait visible.
    expect(mutexAtCheck).toBe(true);
    expect(spawned).toBe(0);
    // The refused build released its slot on the way out.
    expect(existsSync(join(registryDir, 'build-slots', '1'))).toBe(false);
  });
});

/** The `.next.failed-*` directories a build left beside its artifact. */
function failedArtifacts(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('.next.failed-'));
}

/** A finished build's output: the route table is the last thing Next prints. */
const COMPLETE_BUILD_OUTPUT = '✓ Compiled successfully in 25.7s\n\nRoute (app)\n┌ ○ /\n';

interface SpawnOutcome {
  status: number | null;
  signal?: string | null;
  timedOut: boolean;
  output: string;
}

/**
 * One production build against a temporary artifact directory, with the tree
 * moving between the two fingerprint reads when `fingerprints` differ.
 */
async function runOneBuild(
  artifactDir: string,
  spawnFake: () => Promise<SpawnOutcome>,
  fingerprints: string[] = ['fingerprint-before', 'fingerprint-after'],
): Promise<{ result: BuildResult; stderr: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  let reads = 0;
  try {
    const result = await productionBuildModule.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        artifactDir,
        // The tree moves between the two reads, exactly like a commit, an editor
        // or a neighbouring process landing mid-build.
        fingerprint: () => fingerprints[Math.min(reads++, fingerprints.length - 1)] ?? '',
        spawnBuild: () => spawnFake().then((outcome) => ({ ...outcome, durationMs: 1 })),
      },
      { app: 'web', admission: 'no-slot' },
    );
    return { result, stderr: chunks.join('') };
  } finally {
    spy.mockRestore();
  }
}

/**
 * #1365: `env:ensure` exited 4 on a build whose own output was a clean success,
 * because the *tree* moved while the build ran and the fingerprint comparison
 * was part of `ok`. The build is the build; the fingerprint is evidence about
 * recording it.
 */
describe('a build whose tree moved while it ran', () => {
  it('is built and kept, and says it is not recorded as current', async () => {
    const { dir, artifactDir } = newCase();
    const { result, stderr } = await runOneBuild(artifactDir, () => {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, 'BUILD_ID'), 'fresh-build');
      return Promise.resolve({
        status: 0,
        signal: null,
        timedOut: false,
        output: COMPLETE_BUILD_OUTPUT,
      });
    });

    expect(result.ok).toBe(true);
    // The evidence the caller must not record: the artifact is real, but the
    // tree it would be recorded for is not the tree it was built from.
    expect(result.fingerprintMoved).toBe(true);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('fresh-build');
    expect(failedArtifacts(dir)).toEqual([]);
    expect(result.invalidated ?? null).toBeNull();
    expect(stderr).toContain('is NOT recorded as current');
  });

  it('still fails — and moves the artifact aside — when the build itself failed', async () => {
    const { dir, artifactDir } = newCase();
    // A previous artifact: a failed build leaves its `BUILD_ID` untouched.
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'previous-build');

    const { result } = await runOneBuild(artifactDir, () =>
      Promise.resolve({
        status: 1,
        signal: null,
        timedOut: false,
        output: 'Failed to compile.\n\n./src/x.tsx:36:12\nError: Expression expected',
      }),
    );

    expect(result.ok).toBe(false);
    expect(existsSync(artifactDir)).toBe(false);
    expect(result.invalidated).not.toBeNull();
    expect(failedArtifacts(dir)).toHaveLength(1);
    // #1316: nothing claims a failed build as current.
    expect(stateModule.readBuildState()).toBeNull();
  });

  it('keeps a build whose process was signalled after it printed its route table', async () => {
    const { dir, artifactDir } = newCase();
    const { result, stderr } = await runOneBuild(artifactDir, () => {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, 'BUILD_ID'), 'fresh-build');
      return Promise.resolve({
        status: null,
        signal: 'SIGKILL',
        timedOut: false,
        output: COMPLETE_BUILD_OUTPUT,
      });
    }, ['fingerprint-stable', 'fingerprint-stable']);

    expect(result.ok).toBe(true);
    expect(result.fingerprintMoved).toBe(false);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('fresh-build');
    expect(failedArtifacts(dir)).toEqual([]);
    // The anomalous exit is named rather than swallowed.
    expect(stderr).toContain('signal SIGKILL');
  });

  it('does not read a failed build over an old BUILD_ID as complete', async () => {
    const { dir, artifactDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    const buildId = join(artifactDir, 'BUILD_ID');
    writeFileSync(buildId, 'previous-build');
    // Old enough that it cannot be this build's own write.
    utimesSync(buildId, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

    const { result, stderr } = await runOneBuild(
      artifactDir,
      () =>
        Promise.resolve({
          status: null,
          signal: 'SIGKILL',
          timedOut: false,
          output: COMPLETE_BUILD_OUTPUT,
        }),
      ['fingerprint-stable', 'fingerprint-stable'],
    );

    expect(result.ok).toBe(false);
    expect(existsSync(artifactDir)).toBe(false);
    expect(failedArtifacts(dir)).toHaveLength(1);
    // The verdict names the stale file instead of letting "BUILD_ID present"
    // read as a finished build.
    expect(stderr).toContain('was written before this build');
  });
});

describe('describeBuildVerdict', () => {
  it('names every condition that failed, with the evidence it was judged on', () => {
    expect(
      productionBuildModule.describeBuildVerdict({
        status: 1,
        signal: null,
        timedOut: false,
        artifact: 'missing',
        fingerprintBefore: 'aaaaaaaa1111',
        fingerprintAfter: 'bbbbbbbb2222',
      }),
    ).toEqual([
      'exit 1; expected a clean exit 0',
      'apps/web/.next/BUILD_ID is missing: the build never wrote it',
      'tree fingerprint moved (aaaaaaaa… → bbbbbbbb…)',
    ]);
  });

  it('names a timeout and an unreadable fingerprint', () => {
    expect(
      productionBuildModule.describeBuildVerdict({
        status: null,
        signal: 'SIGKILL',
        timedOut: true,
        artifact: 'fresh',
        fingerprintBefore: 'aaaaaaaa1111',
        fingerprintAfter: '',
      }),
    ).toEqual([
      'no exit status (signal SIGKILL); the build exceeded its budget and was killed',
      'apps/web/.next/BUILD_ID is present and this build wrote it',
      'tree fingerprint unreadable after the build (before aaaaaaaa…)',
    ]);
  });

  it('makes no artifact or fingerprint claim for apps/admin', () => {
    expect(
      productionBuildModule.describeBuildVerdict({
        status: 2,
        signal: null,
        timedOut: false,
        artifact: null,
        fingerprintBefore: '',
        fingerprintAfter: '',
      }),
    ).toEqual(['exit 2; expected a clean exit 0']);
  });
});

describe('env:build records nothing for a build whose tree moved', () => {
  it('exits 0 and writes no record', async () => {
    const harness = newHarness();
    await runningStack(harness);
    applyHarnessEnv(harness);

    const code = await buildModule.runBuild(parsedBuild(), {
      producerReason: () => 'not the primary checkout (a linked worktree never publishes)',
      build: () => Promise.resolve({ ...buildResult(), fingerprintMoved: true }),
    });

    expect(code).toBe(0);
    expect(stateModule.readBuildState()).toBeNull();
  });
});
