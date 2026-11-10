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
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
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
  fingerprintAfter: string;
}

interface BuildModule {
  runBuild(
    parsed: ParsedCommand,
    deps?: { build(envHash: string): Promise<BuildResult> },
  ): Promise<number>;
}

interface StateModule {
  readBuildState(): Record<string, unknown> | null;
}

interface HandoverRecord {
  artifactDir: string;
  backupPath: string;
  previousPid: number | null;
  phase: 'backed-up' | 'committed';
  at: string;
}

// `state.ts` and `rebuild.ts` capture DEV_DIR at import time.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-build-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const atomsModule = await loadEnvModule<{ parseCommand(argv: string[]): ParsedCommand }>(
  'atoms.ts',
);
const buildModule = await loadEnvModule<BuildModule>('commands/build.ts');
const stateModule = await loadEnvModule<StateModule>('lib/state.ts');

const handoverPath = join(stateDir, 'handover.json');
const baselineEnv: NodeJS.ProcessEnv = { ...process.env };
const harnesses: Harness[] = [];
const caseDirs: string[] = [];

afterAll(() => {
  for (const dir of caseDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
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
});
