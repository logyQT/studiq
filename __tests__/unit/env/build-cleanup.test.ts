import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

// #1518: on macOS, `kill(-pgid)` can answer EPERM in the build cleanup. The cleanup must
// not read that as "the group ended", and the build must always end.

interface Admission {
  admit: boolean;
  cap: number;
  reason: string;
  failed: null;
}

interface LocksModule {
  killProcessGroup(pgid: number, graceMs?: number, reapMs?: number): Promise<boolean>;
  UnconfirmedGroupError: new (pgid: number) => Error;
  withBuildSlots<T>(
    fn: () => Promise<T>,
    options: { decide: () => Admission; invalidate: () => void; waitMs?: number },
  ): Promise<T>;
}

interface SpawnSeams {
  command: { file: string; args: string[]; oomAdjusted: boolean };
  killGroup: (pgid: number) => Promise<boolean>;
  timeoutMs?: number;
}

interface BuildModule {
  spawnBuild(
    slot: { setProcessGroup(pgid: number): void; heartbeat(): void } | null,
    options: { app: 'admin'; admission: 'no-slot' },
    seams: SpawnSeams,
  ): Promise<{ status: number | null; timedOut: boolean }>;
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

describe('a build slot after a cleanup error (#1518)', () => {
  it('keeps the slot when the cleanup cannot confirm that the group ended', async () => {
    const failure = new locks.UnconfirmedGroupError(4242);

    await expect(locks.withBuildSlots(() => Promise.reject(failure), slots)).rejects.toBe(failure);

    expect(existsSync(slotPath)).toBe(true);
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

    await expect(locks.withBuildSlots(admitted, slots)).rejects.toBeInstanceOf(
      locks.UnconfirmedGroupError,
    );

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

  it('throws while no parent collects the zombie', async () => {
    const { pgid } = await zombieGroup();

    await expect(locks.killProcessGroup(pgid, 300, 200)).rejects.toBeInstanceOf(
      locks.UnconfirmedGroupError,
    );
  });
});
