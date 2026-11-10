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
  pidAlive?(pid: number): boolean;
  removeBackup?(backup: string): void;
  artifactDir: string;
  backupDir: string;
}

interface HandoverRecovery {
  status: 'none' | 'settled' | 'in-flight' | 'serving' | 'kept';
  ownerPid?: number;
  pid?: number;
}

interface RebuildModule {
  recoverHandover(deps?: {
    readPid(): number | null;
    pidAlive?(pid: number): boolean;
  }): HandoverRecovery;
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

interface StateModule {
  writeBuildState(state: { fingerprint: string; envHash: string; builtAt: string }): void;
  readBuildState(): Record<string, unknown> | null;
}

interface HandoverRecord {
  artifactDir: string;
  backupPath: string;
  previousPid: number | null;
  /** The process that owns the in-flight handover (the build). */
  ownerPid?: number | null;
  phase: 'backed-up' | 'committed';
  at: string;
}

const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-handover-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;

const handoverPath = join(stateDir, 'handover.json');
const buildStatePath = join(stateDir, 'build.json');
const caseDirs: string[] = [];

const rebuildModule = await loadEnvModule<RebuildModule>('lib/rebuild.ts');
const stateModule = await loadEnvModule<StateModule>('lib/state.ts');

afterAll(() => {
  for (const dir of caseDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(handoverPath, { force: true });
  rmSync(buildStatePath, { recursive: true, force: true });
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
    ownerPid: typeof parsed.ownerPid === 'number' ? parsed.ownerPid : null,
    phase: parsed.phase === 'committed' ? 'committed' : 'backed-up',
    at: typeof parsed.at === 'string' ? parsed.at : '',
  };
}

describe('env rebuild handover recovery', () => {
  it('restores the previous build over an unverified artifact', () => {
    const { artifactDir, backupDir } = newCase();
    // The interrupted run built `.next` but never committed the handover, so its
    // artifact is unverified and the previous build is the one to keep.
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-uncommitted');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('drops the backup of a committed handover and keeps the new artifact', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
    const backupPath = makeBackup(backupDir, 'next-backup-committed');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: null,
      phase: 'committed',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('new-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('restores the backup when the interrupted artifact is missing', () => {
    const { artifactDir, backupDir } = newCase();
    const backupPath = makeBackup(backupDir, 'next-backup-restore');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('clears the record when its backup no longer exists', () => {
    const { artifactDir, backupDir } = newCase();
    writeRecord({
      artifactDir,
      backupPath: join(backupDir, 'next-backup-gone'),
      previousPid: 4242,
      phase: 'committed',
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
      phase: 'backed-up',
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

  it('defers restoring an uncommitted handover while the replacement is alive', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    writeFileSync(join(artifactDir, 'marker'), 'served-by-replacement');
    const backupPath = makeBackup(backupDir, 'next-backup-live');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    // The replacement server still owns the unverified `.next`: nothing may be
    // removed, renamed or forgotten until it stops.
    rebuildModule.recoverHandover({
      readPid: () => 9001,
      pidAlive: (pid) => pid === 9001,
    });

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('unverified-build');
    expect(readFileSync(join(artifactDir, 'marker'), 'utf8')).toBe('served-by-replacement');
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(handoverPath)).toBe(true);
    expect(readRecord().phase).toBe('backed-up');
  });

  it('restores an uncommitted handover once the replacement is dead', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-dead');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    // A PID record can outlive its process; only a proven-dead replacement lets
    // the previous build take the artifact back.
    rebuildModule.recoverHandover({ readPid: () => 9001, pidAlive: () => false });

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('writes the committed phase before discarding and leaves no record after a successful rebuild', async () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'old-build');
    let recordedDuringBuild = false;
    let ownerPidDuringBuild = 0;
    let recordMode = 0;
    let phaseAtDiscard = '';
    const deps: RebuildDeps = {
      build: () => {
        recordedDuringBuild = existsSync(handoverPath) && readRecord().phase === 'backed-up';
        ownerPidDuringBuild = readRecord().ownerPid ?? 0;
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
      // The backup is only discarded once the handover is committed.
      removeBackup: (backup) => {
        phaseAtDiscard = existsSync(handoverPath) ? readRecord().phase : 'missing';
        rmSync(backup, { recursive: true, force: true });
      },
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
    // The record is persisted (mode 600) as unverified before the build starts,
    // and it names the process that owns the in-flight handover.
    expect(recordedDuringBuild).toBe(true);
    expect(ownerPidDuringBuild).toBe(process.pid);
    expect(recordMode).toBe(0o600);
    expect(phaseAtDiscard).toBe('committed');
    expect(existsSync(handoverPath)).toBe(false);
    expect(readdirSync(backupDir)).toEqual([]);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('new-build');
  });

  it('commits only after the health check and restores when it fails', async () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'old-build');
    let phaseDuringWait = '';
    const deps: RebuildDeps = {
      build: () => {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
        return Promise.resolve({ ok: true, timedOut: false, output: '', fingerprintAfter: 'new' });
      },
      startWeb: () => 7001,
      waitWeb: () => {
        // The replacement build is in place but has not been verified yet.
        phaseDuringWait = readRecord().phase;
        return Promise.resolve({ ok: false, reason: 'timeout', http: 0 });
      },
      stopWeb: () => ({ pid: 7001, stopped: true }),
      stopForReplacement: () => ({ pid: null, stopped: true }),
      readPid: () => 7001,
      pidAlive: () => false,
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

    expect(phaseDuringWait).toBe('backed-up');
    // The rollback restores the backup instead of discarding it, so the
    // previous build is back in place and the record is spent.
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(readdirSync(backupDir)).toEqual([]);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('reports an in-flight rebuild instead of touching the artifact it owns', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'in-flight-build');
    const backupPath = makeBackup(backupDir, 'next-backup-in-flight');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      ownerPid: 91002,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    const recovery = rebuildModule.recoverHandover({
      readPid: () => null,
      pidAlive: (pid) => pid === 91002,
    });

    // The caller must refuse: the live owner still owns `.next` even though the
    // record was written before the artifact was moved (no backup yet).
    expect(recovery).toEqual({ status: 'in-flight', ownerPid: 91002 });
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('in-flight-build');
    expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(handoverPath)).toBe(true);
  });

  it('takes ownership of the handover before stopping the server and moving the artifact', async () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'old-build');
    let claimAtStop = '';
    const deps: RebuildDeps = {
      build: () => {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'BUILD_ID'), 'new-build');
        return Promise.resolve({ ok: true, timedOut: false, output: '', fingerprintAfter: 'new' });
      },
      startWeb: () => {
        throw new Error('a --no-serve rebuild must not start the web server');
      },
      waitWeb: () => Promise.reject(new Error('a --no-serve rebuild must not wait for web')),
      stopWeb: () => ({ pid: null, stopped: true }),
      stopForReplacement: () => {
        // A second ensure can only be kept away from this server if the record
        // already names this rebuild before the stop.
        claimAtStop = existsSync(handoverPath)
          ? `${readRecord().ownerPid}:${readRecord().phase}`
          : 'missing';
        return { pid: 7001, stopped: true };
      },
      readPid: () => 7001,
      pidAlive: () => false,
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
    expect(claimAtStop).toBe(`${process.pid}:backed-up`);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('refuses a handover owned by another live rebuild before stopping or backing up', async () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'served-build');
    const backupPath = makeBackup(backupDir, 'next-backup-owner-busy');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 7001,
      ownerPid: 91003,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });
    let stops = 0;
    let builds = 0;
    const deps: RebuildDeps = {
      build: () => {
        builds += 1;
        return Promise.resolve({ ok: true, timedOut: false, output: '', fingerprintAfter: 'new' });
      },
      startWeb: () => {
        throw new Error('a refused rebuild must not start the web server');
      },
      waitWeb: () => Promise.reject(new Error('a refused rebuild must not wait for web')),
      stopWeb: () => ({ pid: null, stopped: true }),
      stopForReplacement: () => {
        stops += 1;
        return { pid: 7001, stopped: true };
      },
      readPid: () => 7001,
      pidAlive: (pid) => pid === 91003,
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
          serve: false,
        },
        deps,
      ),
    ).rejects.toMatchObject({ name: 'EnvFailure', exitCode: 6 });

    // The refusal precedes every mutation: the server still runs and the
    // in-flight rebuild keeps its record, backup and artifact.
    expect(stops).toBe(0);
    expect(builds).toBe(0);
    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('served-build');
    expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(handoverPath)).toBe(true);
  });

  it('defers a handover whose owning build process is still alive', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-owner-live');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: null,
      ownerPid: 91001,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    // `checkout.lock` is free while that process builds, so only its liveness
    // keeps another recovery away from `.next` and the backup.
    rebuildModule.recoverHandover({ readPid: () => null, pidAlive: (pid) => pid === 91001 });

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('unverified-build');
    expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(handoverPath)).toBe(true);
    expect(readRecord().phase).toBe('backed-up');
  });

  it('restores once the owning build process is dead', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-owner-dead');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: null,
      ownerPid: 91001,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover({ readPid: () => null, pidAlive: () => false });

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
  });

  it('invalidates the recorded build state when it restores the previous build', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-state');
    // The interrupted run recorded its own build as current.
    stateModule.writeBuildState({
      fingerprint: 'interrupted-fingerprint',
      envHash: 'interrupted-env-hash',
      builtAt: '2026-01-01T00:00:00.000Z',
    });
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });

    rebuildModule.recoverHandover();

    expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('old-build');
    expect(stateModule.readBuildState()).toBeNull();
    expect(existsSync(buildStatePath)).toBe(false);
    expect(existsSync(handoverPath)).toBe(false);
    expect(existsSync(backupPath)).toBe(false);
  });

  it('keeps the record and backup when the build-state invalidation fails', () => {
    const { artifactDir, backupDir } = newCase();
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'BUILD_ID'), 'unverified-build');
    const backupPath = makeBackup(backupDir, 'next-backup-state-failure');
    writeRecord({
      artifactDir,
      backupPath,
      previousPid: 4242,
      phase: 'backed-up',
      at: '2026-01-01T00:00:00.000Z',
    });
    // A directory where `build.json` should be makes the invalidation fail.
    mkdirSync(buildStatePath);

    try {
      let failure: unknown;
      try {
        rebuildModule.recoverHandover();
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 4 });
      if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
      expect(failure.message).toContain(backupPath);
      // Nothing was restored and nothing was forgotten.
      expect(readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8')).toBe('unverified-build');
      expect(readFileSync(join(backupPath, 'BUILD_ID'), 'utf8')).toBe('old-build');
      expect(existsSync(handoverPath)).toBe(true);
      expect(readRecord().backupPath).toBe(backupPath);
    } finally {
      rmSync(buildStatePath, { recursive: true, force: true });
    }
  });
});
