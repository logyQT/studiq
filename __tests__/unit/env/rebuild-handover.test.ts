import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

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
  recoverHandover(): void;
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
    warnings?: string[];
  }>;
}

interface HandoverRecord {
  artifactDir: string;
  backupPath: string;
  previousPid: number | null;
  phase: string;
  at: string;
}

const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-handover-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const handoverPath = join(stateDir, 'handover.json');
const caseDirs: string[] = [];

const rebuildModule = await loadEnvModule<RebuildModule>('lib/rebuild.ts');

afterAll(() => {
  for (const dir of caseDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(handoverPath, { force: true });
});

function newCase(): { dir: string; artifactDir: string; backupDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-handover-case-'));
  caseDirs.push(dir);
  const artifactDir = join(dir, '.next');
  const backupDir = join(dir, '.dev');
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(): HandoverRecord {
  const parsed: unknown = JSON.parse(readFileSync(handoverPath, 'utf8'));
  if (
    !isObject(parsed) ||
    typeof parsed.artifactDir !== 'string' ||
    typeof parsed.backupPath !== 'string'
  ) {
    throw new Error('expected a handover record object');
  }
  return {
    artifactDir: parsed.artifactDir,
    backupPath: parsed.backupPath,
    previousPid: typeof parsed.previousPid === 'number' ? parsed.previousPid : null,
    phase: typeof parsed.phase === 'string' ? parsed.phase : '',
    at: typeof parsed.at === 'string' ? parsed.at : '',
  };
}

describe('env rebuild handover recovery', () => {
  it('restores the backup when the interrupted artifact is missing', () => {
    const { artifactDir, backupDir } = newCase();
    const backupPath = makeBackup(backupDir, 'next-backup-restore');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backup',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('drops the stale backup and record when an artifact is already present', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
    const backupPath = makeBackup(backupDir, 'next-backup-stale');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: null,
      phase: 'backup',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('new-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('clears the record when its backup no longer exists', () => {
    const { artifactDir, backupDir } = newCase();
    writeRecord({
      artifactDir,
      backupPath: join(backupDir, 'next-backup-gone'),
      previousPid: 4242,
      phase: 'backup',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(existsSync(handoverPath)).toBe(false);
    expect(existsSync(artifactDir)).toBe(false);
  });

  it('keeps the record and backup path when the restore fails', () => {
    const { dir, backupDir } = newCase();
    const artifactDir = join(dir, 'missing-parent', 'artifact');
    const backupPath = makeBackup(backupDir, 'next-backup-unrestorable');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backup',
      at: '2026-01-01T00:00:00.000Z',
    });

    let failure: unknown;
    try {
      rebuildModule.recoverHandover();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(backupPath);
    expect(existsSync(handoverPath)).toBe(true);
    expect(readRecord().backupPath).toBe(backupPath);
    expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
  });

  it('leaves no record after a successful rebuild', async () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'old-build');
    let recordedDuringBuild = false;
    let recordMode = 0;
    const deps: RebuildDeps = {
      build: () => {
        recordedDuringBuild = existsSync(handoverPath) && readRecord().phase === 'backup';
        recordMode = statSync(handoverPath).mode & 0o777;
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
      stopWeb: () => ({ pid: null, stopped: true }),
      stopForReplacement: () => ({ pid: null, stopped: true }),
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

    expect(result.build.ok).toBe(true);
    // The record is persisted (mode 600) before the build starts.
    expect(recordedDuringBuild).toBe(true);
    expect(recordMode).toBe(0o600);
    expect(existsSync(handoverPath)).toBe(false);
    expect(readdirSync(backupDir)).toEqual([]);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('new-build');
  });
});
