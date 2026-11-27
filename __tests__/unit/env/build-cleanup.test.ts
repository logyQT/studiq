import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
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
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';
import { BUN, REPO_ROOT } from '#test/unit/env/support';

// #1518: on macOS, `kill(-pgid)` can answer EPERM in the build cleanup. The cleanup must
// not read that as "the group ended", and the build must always end.

interface Admission {
  admit: boolean;
  cap: number;
  reason: string;
  failed: null;
}

interface HeldSlot {
  slot: number;
  path: string;
  worktree: string;
}

interface UnconfirmedGroup extends Error {
  exitCode: number;
  concernsCheckout(root?: string): boolean;
}

interface LocksModule {
  killProcessGroup(pgid: number, graceMs?: number, reapMs?: number): Promise<boolean>;
  processStartTime(pid: number): string | null;
  UnconfirmedGroupError: new (pgid: number, heldBy?: HeldSlot | null) => UnconfirmedGroup;
  withBuildSlots<T>(
    fn: () => Promise<T>,
    options: { decide: () => Admission; invalidate: () => void; waitMs?: number },
  ): Promise<T>;
}

interface SpawnSeams {
  command: { file: string; args: string[]; oomAdjusted: boolean };
  killGroup?: (pgid: number) => Promise<boolean>;
  timeoutMs?: number;
}

interface BuildOptions {
  app: 'web' | 'admin';
  admission: 'no-slot';
}

type SpawnOutcome = { status: number | null; timedOut: boolean };

interface BuildModule {
  spawnBuild(
    slot: { setProcessGroup(pgid: number): void; heartbeat(): void } | null,
    options: BuildOptions,
    seams: SpawnSeams,
  ): Promise<SpawnOutcome>;
  runProductionBuild(
    envHash: string,
    deps: {
      readWebPid(): number | null;
      spawnBuild(slot: null, options: BuildOptions): Promise<SpawnOutcome>;
      artifactDir: string;
      fingerprint(): string;
    },
    options: BuildOptions,
  ): Promise<unknown>;
}

interface RebuildModule {
  recoverHandover(): { status: string };
  rebuildWithRecovery(
    input: {
      envHash: string;
      appPort: number;
      appUrl: string;
      env: NodeJS.ProcessEnv;
      serve: boolean;
    },
    deps: {
      build(): Promise<unknown>;
      startWeb(): number;
      waitWeb(): Promise<{ ok: boolean; reason: string; http: number }>;
      stopWeb(): { pid: number | null; stopped: boolean };
      stopForReplacement(): { pid: number | null; stopped: boolean };
      readPid(): number | null;
      pidAlive(): boolean;
      artifactDir: string;
      backupDir: string;
    },
  ): Promise<unknown>;
}

const stateDir = mkdtempSync(join(tmpdir(), 'studiq-build-cleanup-state-'));
const registryDir = mkdtempSync(join(tmpdir(), 'studiq-build-cleanup-registry-'));
const savedEnv = {
  STUDIQ_ENV_STATE_DIR: process.env.STUDIQ_ENV_STATE_DIR,
  STUDIQ_DEV_REGISTRY: process.env.STUDIQ_DEV_REGISTRY,
};
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
process.env.STUDIQ_DEV_REGISTRY = registryDir;

const locks = await loadEnvModule<LocksModule>('lib/locks.ts');
const build = await loadEnvModule<BuildModule>('lib/build.ts');
const rebuild = await loadEnvModule<RebuildModule>('lib/rebuild.ts');

const slotPath = join(registryDir, 'build-slots', '1');

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(registryDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(registryDir, 'build-slots'), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function captureStderr(): () => string {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  return () => chunks.join('');
}

/** A group that accepts every signal until SIGKILL, then gives the `after` answers in turn. */
function answersAfterSigkill(...after: Answer[]): Array<string | number | undefined> {
  const signals: Array<string | number | undefined> = [];
  let probes = 0;
  vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    const killed = signals.includes('SIGKILL');
    signals.push(signal);
    if (!killed) return true;
    const answer = after[Math.min(probes++, after.length - 1)];
    if (answer === 'ok') return true;
    throw Object.assign(new Error(`kill ${answer}`), { code: answer });
  });
  return signals;
}

type Answer = 'ok' | 'EPERM' | 'ESRCH' | 'EINVAL';

/**
 * Replaces `process.kill` for process groups (a negative pid). Each call takes the next answer;
 * the last answer repeats. A positive pid goes to the real function.
 */
function groupAnswers(...answers: Answer[]): Array<string | number | undefined> {
  const signals: Array<string | number | undefined> = [];
  const real = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid > 0) return real(pid, signal);
    const answer = answers[Math.min(signals.length, answers.length - 1)];
    signals.push(signal);
    if (answer === 'ok') return true;
    throw Object.assign(new Error(`kill ${answer}`), { code: answer });
  });
  return signals;
}

describe('killProcessGroup and EPERM (#1518)', () => {
  it('waits for ESRCH after EPERM, then reports that the group ended', async () => {
    const signals = groupAnswers('EPERM', 'EPERM', 'EPERM', 'ESRCH');

    await expect(locks.killProcessGroup(4242, 2_000, 100)).resolves.toBe(true);

    expect(signals).toEqual(['SIGTERM', 0, 0, 0]);
  });

  it('accepts a group that ends only after SIGKILL', async () => {
    // Every answer is EPERM until SIGKILL was sent; the group is gone after it.
    const signals: Array<string | number | undefined> = [];
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      const killed = signals.includes('SIGKILL');
      signals.push(signal);
      throw Object.assign(new Error('kill'), { code: killed ? 'ESRCH' : 'EPERM' });
    });

    await expect(locks.killProcessGroup(4242, 150, 100)).resolves.toBe(true);

    expect(signals).toContain('SIGKILL');
  });

  it('waits after SIGKILL while the system still answers EPERM', async () => {
    answersAfterSigkill('EPERM', 'EPERM', 'EPERM', 'ESRCH');

    await expect(locks.killProcessGroup(4242, 150)).resolves.toBe(true);
  });

  // A known limit, older than #1518: only a lasting EPERM is an error.
  it('reports success when the group still accepts a signal after SIGKILL', async () => {
    const signals = answersAfterSigkill('ok');

    await expect(locks.killProcessGroup(4242, 150, 100)).resolves.toBe(true);

    expect(signals).toContain('SIGKILL');
  });

  it('throws when EPERM stays after SIGKILL, and does not report that the group ended', async () => {
    const signals = groupAnswers('EPERM');

    const result = locks.killProcessGroup(4242, 150, 100);

    await expect(result).rejects.toBeInstanceOf(locks.UnconfirmedGroupError);
    await expect(result).rejects.toThrow('cannot confirm that process group 4242 ended');
    expect(signals).toContain('SIGKILL');
  });

  it('returns false at once when there is no group', async () => {
    const signals = groupAnswers('ESRCH');

    await expect(locks.killProcessGroup(4242, 2_000, 100)).resolves.toBe(false);

    expect(signals).toEqual(['SIGTERM']);
  });

  it('throws another error code as before', async () => {
    groupAnswers('EINVAL');

    await expect(locks.killProcessGroup(4242, 2_000, 100)).rejects.toThrow('kill EINVAL');
  });
});

const admitOne = (): Admission => ({ admit: true, cap: 1, reason: 'memory', failed: null });
const slots = { decide: admitOne, invalidate: () => {} };

const concernsThisCheckout = (heldBy: HeldSlot | null) =>
  new locks.UnconfirmedGroupError(4242, heldBy).concernsCheckout();
const heldBy = (worktree: string): HeldSlot => ({ slot: 1, path: slotPath, worktree });

describe('a build slot after a cleanup error (#1518)', () => {
  it('keeps the slot when the cleanup cannot confirm that the group ended', async () => {
    const failure = new locks.UnconfirmedGroupError(4242);
    const stderr = captureStderr();

    await expect(locks.withBuildSlots(() => Promise.reject(failure), slots)).rejects.toBe(failure);

    expect(existsSync(slotPath)).toBe(true);
    expect(stderr()).toContain(`build slot 1 stays in use: ${slotPath}`);
  });

  it('knows whether the group can write to the .next of a checkout', () => {
    expect(
      [null, heldBy(REPO_ROOT), heldBy(''), heldBy('/another/checkout')].map(concernsThisCheckout),
    ).toEqual([true, true, true, false]);
  });

  it('releases the slot after another error', async () => {
    await expect(
      locks.withBuildSlots(() => Promise.reject(new Error('compiler')), slots),
    ).rejects.toThrow('compiler');

    expect(existsSync(slotPath)).toBe(false);
  });

  // The real wait before SIGKILL is 10 s, so this test needs a longer limit.
  it('does not admit a new build while the recorded group still answers EPERM', async () => {
    const endedPid = spawnSync(process.execPath, ['-e', '']).pid;
    mkdirSync(slotPath, { recursive: true, mode: 0o700 });
    const record = { pid: endedPid, pgid: endedPid, pgidStart: 'recorded', token: 'old' };
    for (const [field, value] of Object.entries(record)) {
      writeFileSync(join(slotPath, field), String(value));
    }
    groupAnswers('EPERM');
    const admitted = vi.fn(() => Promise.resolve());

    const admission = locks.withBuildSlots(admitted, slots);

    await expect(admission).rejects.toBeInstanceOf(locks.UnconfirmedGroupError);
    await expect(admission).rejects.toThrow(
      `The new build did not start. Build slot 1 stays in use: ${slotPath} (worktree: unknown).`,
    );
    await expect(admission).rejects.toThrow(`awk '$3 == ${endedPid}'`);
    expect(admitted).not.toHaveBeenCalled();
    expect(existsSync(slotPath)).toBe(true);
  }, 20_000);
});

const options = { app: 'admin', admission: 'no-slot' } as const;
const nodeCommand = (script: string) => ({
  file: process.execPath,
  args: ['-e', script],
  oomAdjusted: true,
});
const cleanupError = new Error('cleanup failed');
const failingCleanup = () => Promise.reject(cleanupError);

describe('spawnBuild always ends (#1518)', () => {
  const groups: number[] = [];
  const slot = { setProcessGroup: (pgid: number) => groups.push(pgid), heartbeat: () => {} };

  afterEach(() => {
    for (const pgid of groups.splice(0)) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        /* the group already ended */
      }
    }
  });

  it('resolves when the cleanup succeeds', async () => {
    const outcome = await build.spawnBuild(slot, options, {
      command: nodeCommand(''),
      killGroup: () => Promise.resolve(false),
    });

    expect(outcome).toMatchObject({ status: 0, timedOut: false });
  });

  it('stops the whole group with its default cleanup', async () => {
    // The command ends at once and leaves a child of its own in the same group.
    const leaveAChild = [
      "require('node:child_process')",
      ".spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })",
      '.unref()',
    ].join('');

    await build.spawnBuild(slot, options, { command: nodeCommand(leaveAChild) });

    const [pgid] = groups;
    expect(pgid).toBeGreaterThan(1);
    expect(() => process.kill(-Number(pgid), 0)).toThrow('ESRCH');
  });

  it('lets its process end after a failed cleanup, while the child still runs', () => {
    const script = join(stateDir, 'abandon.ts');
    const buildUrl = pathToFileURL(join(REPO_ROOT, 'scripts', 'env', 'lib', 'build.ts')).href;
    writeFileSync(
      script,
      [
        `const { spawnBuild } = await import(${JSON.stringify(buildUrl)});`,
        'const slot = { setProcessGroup: (id) => console.log(`group ${id}`), heartbeat() {} };',
        "const args = ['-e', 'setTimeout(() => {}, 30_000)'];",
        'await spawnBuild(slot, { app: "admin", admission: "no-slot" }, {',
        '  command: { file: process.execPath, args, oomAdjusted: true },',
        "  killGroup: () => Promise.reject(new Error('cleanup failed')),",
        '  timeoutMs: 200,',
        '}).catch((error) => console.log(`rejected: ${error.message}`));',
      ].join('\n'),
    );

    // Without the release, the pipes of the running child keep this process alive.
    const run = spawnSync(BUN, [script], { encoding: 'utf8', timeout: 10_000 });
    const group = /group (\d+)/.exec(run.stdout)?.[1];
    if (group) groups.push(Number(group));

    expect(run.stdout).toContain('rejected: cleanup failed');
    expect(run.status).toBe(0);
  }, 15_000);

  it('rejects when the cleanup fails after the build ended', async () => {
    await expect(
      build.spawnBuild(slot, options, { command: nodeCommand(''), killGroup: failingCleanup }),
    ).rejects.toBe(cleanupError);
  });

  it('rejects when the cleanup of a build over its time limit fails', async () => {
    // The child stays alive: only the time limit path can end this build.
    await expect(
      build.spawnBuild(slot, options, {
        command: nodeCommand('setTimeout(() => {}, 60_000)'),
        killGroup: failingCleanup,
        timeoutMs: 100,
      }),
    ).rejects.toBe(cleanupError);
  }, 3_000);
});

const artifactRoot = join(stateDir, 'artifact');
const artifactDir = join(artifactRoot, '.next');

function writeArtifact(buildId: string): void {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'BUILD_ID'), buildId);
}

/** A whole production build whose spawn is the real `spawnBuild` with these seams. */
function productionBuild(app: 'web' | 'admin', seams: SpawnSeams): Promise<unknown> {
  return build.runProductionBuild(
    'env-hash',
    {
      readWebPid: () => null,
      spawnBuild: (slot, buildOptions) => build.spawnBuild(slot, buildOptions, seams),
      artifactDir,
      fingerprint: () => 'fingerprint',
    },
    { app, admission: 'no-slot' },
  );
}

const compilerError = "console.log('error TS2322: not assignable'); process.exitCode = 1";

describe('the build result after a cleanup error (#1518)', () => {
  beforeEach(() => {
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(join(stateDir, 'env.log'), { force: true });
  });

  it('keeps the compiler output and the exit code of a failed build', async () => {
    const stderr = captureStderr();

    const result = productionBuild('admin', {
      command: nodeCommand(compilerError),
      killGroup: failingCleanup,
    });

    await expect(result).rejects.toBe(cleanupError);
    expect(stderr()).toContain('error TS2322: not assignable');
    expect(stderr()).toContain('the build command ended with exit code 1');
    const log = readFileSync(join(stateDir, 'env.log'), 'utf8');
    expect(log).toContain('error TS2322: not assignable');
    expect(log).toContain('the build command ended with exit code 1');
  });

  it('says where it moved the artifact of a web build that had ended well', async () => {
    writeArtifact('new-build');
    const stderr = captureStderr();

    await expect(
      productionBuild('web', { command: nodeCommand(''), killGroup: failingCleanup }),
    ).rejects.toBe(cleanupError);

    expect(stderr()).toContain('the build command ended with exit code 0');
    expect(stderr()).toMatch(/moved the artifact aside to \S*\.next\.failed-/);
    expect(existsSync(artifactDir)).toBe(false);
  });

  it('keeps the output of a build over its time limit', async () => {
    const stderr = captureStderr();

    await expect(
      productionBuild('admin', {
        command: nodeCommand("console.log('still compiling'); setTimeout(() => {}, 5_000)"),
        killGroup: failingCleanup,
        timeoutMs: 1_000,
      }),
    ).rejects.toBe(cleanupError);

    expect(stderr()).toContain('still compiling');
    // The message gives the limit of this build, not the production default (#1525).
    expect(stderr()).toContain("build: exceeded 1 s; killing the build's process group");
    expect(stderr()).toContain('the build command did not end in the time limit');
  });
});

/** An `env:ensure` rebuild over a served build, with a build that this test supplies. */
function ensureRebuild(failingBuild: () => Promise<unknown>) {
  const backupDir = join(artifactRoot, '.dev');
  writeArtifact('old-build');
  const startWeb = vi.fn(() => 5151);
  const result = rebuild.rebuildWithRecovery(
    { envHash: 'h', appPort: 3999, appUrl: 'http://localhost:3999', env: {}, serve: true },
    {
      build: failingBuild,
      startWeb,
      waitWeb: () => Promise.resolve({ ok: true, reason: '', http: 200 }),
      stopWeb: () => ({ pid: null, stopped: true }),
      stopForReplacement: () => ({ pid: 4242, stopped: true }),
      readPid: () => 4242,
      pidAlive: () => false,
      artifactDir,
      backupDir,
    },
  );
  const backups = () =>
    existsSync(backupDir)
      ? readdirSync(backupDir).map((name) =>
          readFileSync(join(backupDir, name, 'BUILD_ID'), 'utf8'),
        )
      : [];
  return { result, startWeb, backups };
}

const servedBuild = () =>
  existsSync(artifactDir) ? readFileSync(join(artifactDir, 'BUILD_ID'), 'utf8') : null;

describe('env:ensure after a cleanup error (#1518)', () => {
  beforeEach(() => {
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(join(stateDir, 'handover.json'), { force: true });
  });

  it('does not restore or serve while a process can write to .next', async () => {
    const { result, startWeb, backups } = ensureRebuild(() =>
      Promise.reject(new locks.UnconfirmedGroupError(4242)),
    );

    await expect(result).rejects.toMatchObject({ exitCode: 6 });
    await expect(result).rejects.toThrow(
      /the previous build was not restored and no web server was started; the previous web server stays stopped; the previous build is kept at /,
    );
    expect(startWeb).not.toHaveBeenCalled();
    expect(backups()).toEqual(['old-build']);
    // The next command must not restore the backup on its own.
    expect(rebuild.recoverHandover()).toEqual({ status: 'none' });
    expect(servedBuild()).toBeNull();
  });

  it('restores and serves when the stuck group belongs to another checkout', async () => {
    const elsewhere = { slot: 1, path: slotPath, worktree: '/another/checkout' };
    const { result, startWeb } = ensureRebuild(() =>
      Promise.reject(new locks.UnconfirmedGroupError(4242, elsewhere)),
    );

    await expect(result).rejects.toThrow(
      'restored the previous build; previous web server restarted',
    );
    expect(startWeb).toHaveBeenCalledOnce();
    expect(servedBuild()).toBe('old-build');
  });
});

/**
 * The parent starts a child that leads its own group and ends at once. The parent collects
 * the child only after it reads a line, so the test decides how long the zombie stays.
 */
const ZOMBIE_PARENT = [
  'import subprocess, sys',
  'child = subprocess.Popen(["/usr/bin/true"], start_new_session=True)',
  'print(child.pid, flush=True)',
  'sys.stdin.readline()',
  'child.wait()',
  'print("collected", flush=True)',
  'sys.stdin.readline()',
].join('\n');

describe.skipIf(process.platform !== 'darwin')('a real zombie group on macOS (#1518)', () => {
  let parent: ChildProcess | undefined;

  afterEach(() => {
    parent?.kill('SIGKILL');
    parent = undefined;
  });

  async function zombieGroup(): Promise<{ pgid: number; collect: () => void }> {
    const started = spawn('/usr/bin/python3', ['-I', '-c', ZOMBIE_PARENT], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    parent = started;
    const lines = createInterface({ input: started.stdout })[Symbol.asyncIterator]();
    const pgid = Number((await lines.next()).value);
    await vi.waitFor(() => {
      const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pgid)], { encoding: 'utf8' });
      expect(state.stdout.trim()).toMatch(/^Z/);
    });
    return { pgid, collect: () => started.stdin.write('\n') };
  }

  it('gets EPERM from the system, and succeeds after the parent collects the zombie', async () => {
    const { pgid, collect } = await zombieGroup();
    expect(() => process.kill(-pgid, 0)).toThrow('EPERM');
    let settled = false;

    const result = locks.killProcessGroup(pgid, 4_000, 500).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    collect();

    await expect(result).resolves.toBe(true);
  });

  it('keeps the compiler output when a real EPERM stays', async () => {
    const { pgid } = await zombieGroup();
    const stderr = captureStderr();

    const result = productionBuild('admin', {
      command: nodeCommand(compilerError),
      killGroup: () => locks.killProcessGroup(pgid, 300, 200),
    });

    await expect(result).rejects.toBeInstanceOf(locks.UnconfirmedGroupError);
    expect(stderr()).toContain('error TS2322: not assignable');
  });

  // The real path: the slot of this checkout records a real zombie group, and the
  // reclaim waits the full 10 s before SIGKILL.
  it('blocks env:ensure and names the slot while a real zombie holds it', async () => {
    const { pgid } = await zombieGroup();
    mkdirSync(slotPath, { recursive: true, mode: 0o700 });
    const record = {
      pid: spawnSync(process.execPath, ['-e', '']).pid,
      pgid,
      pgidStart: locks.processStartTime(pgid),
      worktree: REPO_ROOT,
      token: 'old',
    };
    for (const [field, value] of Object.entries(record)) {
      writeFileSync(join(slotPath, field), String(value));
    }

    const { result, startWeb } = ensureRebuild(() =>
      locks.withBuildSlots(() => Promise.resolve({ ok: true }), slots),
    );

    await expect(result).rejects.toThrow(`The new build did not start. Build slot 1 stays in use`);
    await expect(result).rejects.toThrow('no web server was started');
    expect(startWeb).not.toHaveBeenCalled();
    expect(existsSync(slotPath)).toBe(true);
  }, 25_000);

  it('throws while no parent collects the zombie', async () => {
    const { pgid } = await zombieGroup();

    await expect(locks.killProcessGroup(pgid, 300, 200)).rejects.toBeInstanceOf(
      locks.UnconfirmedGroupError,
    );
  });
});
