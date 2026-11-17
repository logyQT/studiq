import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface BuildSlotHandle {
  number: number;
  token: string;
  setProcessGroup(pgid: number): void;
  heartbeat(): void;
}

interface BuildSlotsStatus {
  busy: number | null;
  cap: number | null;
  stale: number | null;
  waiting: number | null;
  degraded: boolean;
  detail: string | null;
}

interface BuildInProgress {
  pid: number | null;
  start: string | null;
  startedAt: string | null;
  slot: number | null;
}

interface AdmissionDecision {
  admit: boolean;
  cap: number;
  reason: string;
}

interface MemoryReading {
  capacityBytes: number | null;
  freeBytes: number | null;
  hostFallback: boolean;
  detail: string | null;
}

interface LocksModule {
  processStartTime(pid: number): string | null;
  worktreeKey(root?: string): string;
  buildInProgress(worktreeRoot?: string): BuildInProgress | null;
  buildInProgressFailure(build: BuildInProgress): Error & { exitCode: number };
  readBuildSlots(): BuildSlotsStatus | null;
  formatBuildSlots(status: BuildSlotsStatus | null): string;
  withBuildSlots<T>(
    fn: (slot: BuildSlotHandle) => Promise<T>,
    options?: {
      waitMs?: number;
      progressMs?: number;
      backoffMs?: { initial: number; max: number };
      decide?(activeSlots: number): AdmissionDecision;
      probe?(): MemoryReading;
      invalidate?(worktree: string): void;
      now?(): number;
    },
  ): Promise<T>;
}

// `state.ts` captures DEV_DIR at import time; keep the suite off the real `.dev/`.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-slots-state-'));
const savedStateDir = process.env.STUDIQ_ENV_STATE_DIR;
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const locks = await loadEnvModule<LocksModule>('lib/locks.ts');

const savedRegistry = process.env.STUDIQ_DEV_REGISTRY;
const dirs: string[] = [];

afterAll(() => {
  if (savedStateDir === undefined) delete process.env.STUDIQ_ENV_STATE_DIR;
  else process.env.STUDIQ_ENV_STATE_DIR = savedStateDir;
  if (savedRegistry === undefined) delete process.env.STUDIQ_DEV_REGISTRY;
  else process.env.STUDIQ_DEV_REGISTRY = savedRegistry;
  rmSync(stateDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  // A failed assertion must not leave a fixture group behind for the next test.
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      /* the test already killed it, or it exited */
    }
  }
});

function registry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-slots-'));
  dirs.push(dir);
  process.env.STUDIQ_DEV_REGISTRY = dir;
  return dir;
}

function slotsDir(dir: string): string {
  return join(dir, 'build-slots');
}

interface SlotFixture {
  pid: number;
  start?: string | null;
  pgid?: number;
  pgidStart?: string | null;
  token?: string;
  worktree?: string;
}

function writeSlot(dir: string, slot: number, fixture: SlotFixture): string {
  const path = join(slotsDir(dir), String(slot));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(path, 'pid'), `${fixture.pid}\n`);
  writeFileSync(join(path, 'start'), `${fixture.start ?? ''}\n`);
  writeFileSync(join(path, 'pgid'), `${fixture.pgid ?? 0}\n`);
  writeFileSync(join(path, 'pgidStart'), `${fixture.pgidStart ?? ''}\n`);
  writeFileSync(join(path, 'token'), `${fixture.token ?? 'fixture-token'}\n`);
  writeFileSync(join(path, 'worktree'), `${fixture.worktree ?? '/tmp/another-worktree'}\n`);
  writeFileSync(join(path, 'startedAt'), `${new Date().toISOString()}\n`);
  writeFileSync(join(path, 'heartbeat'), `${Date.now()}\n`);
  return path;
}

/** The per-worktree mutex record a live build leaves behind. */
function writeMutex(
  dir: string,
  holder: { pid: number; start: string; startedAt?: string },
): string {
  const mutex = join(slotsDir(dir), 'worktrees', locks.worktreeKey(REPO_ROOT));
  mkdirSync(mutex, { recursive: true, mode: 0o700 });
  writeFileSync(join(mutex, 'pid'), `${holder.pid}\n`);
  writeFileSync(join(mutex, 'start'), `${holder.start}\n`);
  writeFileSync(join(mutex, 'token'), 'mutex-token\n');
  writeFileSync(join(mutex, 'worktree'), `${REPO_ROOT}\n`);
  if (holder.startedAt !== undefined) {
    writeFileSync(join(mutex, 'startedAt'), `${holder.startedAt}\n`);
  }
  return mutex;
}

/** A pid this test owns, in a process group of its own (`detached` = `setsid`). */
const groups: number[] = [];

function spawnGroup(): number {
  const child = spawn('sleep', ['120'], { detached: true, stdio: 'ignore' });
  if (child.pid === undefined) throw new Error('could not spawn the fixture process group');
  child.unref();
  groups.push(child.pid);
  return child.pid;
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was never met');
    await sleep(10);
  }
}

const admitOne = (): AdmissionDecision => ({ admit: true, cap: 1, reason: 'memory' });
const admitThree = (): AdmissionDecision => ({ admit: true, cap: 3, reason: 'memory' });
const refuse = (): AdmissionDecision => ({ admit: false, cap: 1, reason: 'capacity' });

describe('build slots', () => {
  it('reads a start time for a live pid and none for a pid that does not exist', () => {
    const start = locks.processStartTime(process.pid);
    expect(start).not.toBeNull();
    expect(locks.processStartTime(999_999_999)).toBeNull();
  });

  it('reports unknown, never zero, before any build has run', () => {
    registry();
    expect(locks.readBuildSlots()).toBeNull();
    expect(locks.formatBuildSlots(null)).toBe('unknown');
  });

  it('holds one slot for the build, records the cap, and frees it after', async () => {
    const dir = registry();
    let during: BuildSlotsStatus | null = null;
    const value = await locks.withBuildSlots(
      (slot) => {
        during = locks.readBuildSlots();
        expect(slot.number).toBe(1);
        expect(existsSync(join(slotsDir(dir), '1'))).toBe(true);
        return Promise.resolve('built');
      },
      { decide: admitOne, invalidate: () => {} },
    );

    expect(value).toBe('built');
    expect(during).toMatchObject({ busy: 1, stale: 0, waiting: 0 });
    expect(during?.cap).toBeGreaterThanOrEqual(1);
    // The cap is a recorded fact, not a memory reading at read time.
    expect(Number(readFileSync(join(slotsDir(dir), 'capacity'), 'utf8').trim())).toBe(during?.cap);
    expect(existsSync(join(slotsDir(dir), '1'))).toBe(false);
    expect(locks.readBuildSlots()).toMatchObject({ busy: 0, stale: 0, waiting: 0 });
  });

  it('counts only numeric slot directories, and reports stale ones without dropping them', () => {
    const dir = registry();
    const start = locks.processStartTime(process.pid) ?? '';
    writeSlot(dir, 1, { pid: process.pid, start, token: 'live' });
    writeSlot(dir, 2, { pid: 999_999_999, start: '1', token: 'dead' });
    mkdirSync(join(slotsDir(dir), 'worktrees'), { recursive: true });
    mkdirSync(join(slotsDir(dir), 'waiters', 'waiter-a'), { recursive: true });
    writeFileSync(join(slotsDir(dir), 'capacity'), '3\n');
    writeFileSync(
      join(slotsDir(dir), 'memory.json'),
      JSON.stringify({ degraded: true, detail: 'cannot measure memory on linux: missing' }),
    );

    const status = locks.readBuildSlots();
    expect(status).toEqual({
      busy: 1,
      cap: 3,
      stale: 1,
      waiting: 1,
      degraded: true,
      detail: 'cannot measure memory on linux: missing',
    });
    expect(locks.formatBuildSlots(status)).toBe(
      '1/3 busy, 1 stale, 1 waiting (memory gate degraded)',
    );
    // Read-only: the stale record is reported, never reclaimed.
    expect(existsSync(join(slotsDir(dir), '2'))).toBe(true);
  });

  it('reports a slot whose pid was recycled as stale, not busy', () => {
    const dir = registry();
    // A live pid with a different start time is a recycled number: the ADR's
    // liveness rule calls that stale, and status must agree with it.
    writeSlot(dir, 1, { pid: process.pid, start: 'not-this-process', token: 'recycled' });
    writeFileSync(join(slotsDir(dir), 'capacity'), '1\n');

    const status = locks.readBuildSlots();
    expect(status).toMatchObject({ busy: 0, stale: 1 });
    expect(locks.formatBuildSlots(status)).toBe('0/1 busy, 1 stale');
  });

  it('reclaims a dead launcher, kills nothing and invalidates its worktree', async () => {
    const dir = registry();
    const start = locks.processStartTime(process.pid) ?? '';
    writeSlot(dir, 1, { pid: 999_999_999, start, pgid: 0, token: 'dead', worktree: REPO_ROOT });
    const invalidated: string[] = [];

    let ran = false;
    await locks.withBuildSlots(
      () => {
        ran = true;
        return Promise.resolve();
      },
      { decide: admitOne, invalidate: (worktree) => invalidated.push(worktree) },
    );

    expect(ran).toBe(true);
    expect(invalidated).toEqual([REPO_ROOT]);
    expect(existsSync(join(slotsDir(dir), '1'))).toBe(false);
  });

  it('reclaims a slot whose pid was recycled (start time differs)', async () => {
    const dir = registry();
    writeSlot(dir, 1, { pid: process.pid, start: 'not-this-process', pgid: 0, token: 'recycled' });
    const invalidated: string[] = [];

    let ran = false;
    await locks.withBuildSlots(
      () => {
        ran = true;
        return Promise.resolve();
      },
      { decide: admitOne, invalidate: (worktree) => invalidated.push(worktree) },
    );

    expect(ran).toBe(true);
    expect(invalidated).toEqual(['/tmp/another-worktree']);
  });

  it('reclaims a slot whose process group died, without invalidating a live launcher', async () => {
    const dir = registry();
    const start = locks.processStartTime(process.pid) ?? '';
    // A group this test owns and has already killed: a fixed pgid could name a
    // real group on the host, and the reclaim would signal it.
    const pgid = spawnGroup();
    const pgidStart = locks.processStartTime(pgid);
    process.kill(-pgid, 'SIGKILL');
    await waitFor(() => !groupAlive(pgid));
    writeSlot(dir, 1, { pid: process.pid, start, pgid, pgidStart, token: 'orphan' });
    const invalidated: string[] = [];

    let ran = false;
    await locks.withBuildSlots(
      () => {
        ran = true;
        return Promise.resolve();
      },
      { decide: admitOne, invalidate: (worktree) => invalidated.push(worktree) },
    );

    // The slot was reclaimed (otherwise the only slot would still be taken), but
    // a launcher that is still alive keeps its artifact.
    expect(ran).toBe(true);
    expect(invalidated).toEqual([]);
  });

  it('kills the surviving process group of a dead launcher before the slot is freed', async () => {
    const dir = registry();
    // A real group this test owns: the reclaim must be what ends it, and a
    // launcher that is gone is the orphan the ADR says is never admitted over.
    const pgid = spawnGroup();
    const pgidStart = locks.processStartTime(pgid);
    expect(pgidStart).not.toBeNull();
    expect(groupAlive(pgid)).toBe(true);
    writeSlot(dir, 1, {
      pid: 999_999_999,
      start: '1',
      pgid,
      pgidStart,
      token: 'orphan',
      worktree: REPO_ROOT,
    });

    let aliveWhenAdmitted: boolean | null = null;
    await locks.withBuildSlots(
      () => {
        aliveWhenAdmitted = groupAlive(pgid);
        return Promise.resolve();
      },
      { decide: admitOne, invalidate: () => {} },
    );

    // Deleting the kill from the reclaim leaves this true: the group outlives
    // the slot and a new build would run over its `.next`.
    expect(aliveWhenAdmitted).toBe(false);
  });

  it('records the process group with the leader start time the reclaim verifies', async () => {
    const dir = registry();
    const pgid = spawnGroup();
    let recorded: { pgid: string; pgidStart: string } | null = null;

    await locks.withBuildSlots(
      (slot) => {
        slot.setProcessGroup(pgid);
        const path = join(slotsDir(dir), '1');
        recorded = {
          pgid: readFileSync(join(path, 'pgid'), 'utf8').trim(),
          pgidStart: readFileSync(join(path, 'pgidStart'), 'utf8').trim(),
        };
        return Promise.resolve();
      },
      { decide: admitOne, invalidate: () => {} },
    );

    // Without the start time the reclaim could not tell this group from a
    // recycled pgid, and would have to leave a real orphan running.
    expect(recorded).toEqual({ pgid: String(pgid), pgidStart: locks.processStartTime(pgid) });
  });

  it('leaves a recycled process group alone instead of signalling it', async () => {
    const dir = registry();
    // The slot names a group whose leader start time is not the one recorded:
    // the number now belongs to an unrelated process, so it must not be killed.
    const pgid = spawnGroup();
    writeSlot(dir, 1, {
      pid: 999_999_999,
      start: '1',
      pgid,
      pgidStart: 'not-this-group',
      token: 'recycled-pgid',
      worktree: REPO_ROOT,
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await locks.withBuildSlots(() => Promise.resolve(), {
      decide: admitOne,
      invalidate: () => {},
    });

    expect(groupAlive(pgid)).toBe(true);
    expect(stderr.mock.calls.map((call) => String(call[0])).join('')).toContain(
      `not signalling process group ${pgid}`,
    );
  });

  it('never reclaims a live build on heartbeat age alone', async () => {
    const dir = registry();
    const start = locks.processStartTime(process.pid) ?? '';
    const path = writeSlot(dir, 1, { pid: process.pid, start, pgid: 0, token: 'live' });
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(join(path, 'heartbeat'), old, old);
    const invalidated: string[] = [];

    const failure = await locks
      .withBuildSlots(async () => {}, {
        waitMs: 300,
        progressMs: 100,
        backoffMs: { initial: 10, max: 20 },
        decide: refuse,
        invalidate: (worktree) => invalidated.push(worktree),
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 7 });
    expect(invalidated).toEqual([]);
    expect(readFileSync(join(path, 'token'), 'utf8').trim()).toBe('live');
  });

  it('serializes two builds in the same worktree on the mutex', async () => {
    registry();
    let active = 0;
    let maximum = 0;
    const build = (): Promise<void> =>
      locks.withBuildSlots(
        async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await sleep(120);
          active -= 1;
        },
        { decide: admitThree, invalidate: () => {} },
      );

    await Promise.all([build(), build()]);
    expect(maximum).toBe(1);
  });

  it('counts a waiter while it waits and drops it when admitted', async () => {
    const dir = registry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = locks.withBuildSlots(
      async () => {
        await gate;
      },
      { decide: admitThree, invalidate: () => {} },
    );
    await waitFor(() => existsSync(join(slotsDir(dir), '1')));

    const second = locks.withBuildSlots(async () => {}, {
      decide: admitThree,
      invalidate: () => {},
    });
    await waitFor(() => locks.readBuildSlots()?.waiting === 1);
    expect(locks.readBuildSlots()).toMatchObject({ busy: 1, waiting: 1 });

    release();
    await Promise.all([first, second]);
    expect(locks.readBuildSlots()).toMatchObject({ busy: 0, waiting: 0 });
  });

  it('drops the waiter when the mutex wait is abandoned', async () => {
    const dir = registry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = locks.withBuildSlots(
      async () => {
        await gate;
      },
      { decide: admitThree, invalidate: () => {} },
    );
    await waitFor(() => existsSync(join(slotsDir(dir), '1')));

    const failure = await locks
      .withBuildSlots(async () => {}, {
        waitMs: 200,
        progressMs: 100,
        backoffMs: { initial: 10, max: 20 },
        decide: admitThree,
        invalidate: () => {},
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 7 });
    // The abandoned wait leaves no phantom waiter behind.
    expect(locks.readBuildSlots()).toMatchObject({ busy: 1, waiting: 0 });

    release();
    await first;
  });

  it('drops a waiter whose owner is gone and keeps a live one', async () => {
    const dir = registry();
    const waiters = join(slotsDir(dir), 'waiters');
    mkdirSync(join(waiters, 'dead-waiter'), { recursive: true });
    writeFileSync(join(waiters, 'dead-waiter', 'pid'), '999999999\n');
    writeFileSync(join(waiters, 'dead-waiter', 'token'), 'dead\n');
    mkdirSync(join(waiters, 'live-waiter'), { recursive: true });
    writeFileSync(join(waiters, 'live-waiter', 'pid'), `${process.pid}\n`);
    writeFileSync(join(waiters, 'live-waiter', 'token'), 'live\n');
    expect(locks.readBuildSlots()).toMatchObject({ waiting: 2 });

    await locks.withBuildSlots(() => Promise.resolve(), {
      decide: admitOne,
      invalidate: () => {},
    });

    expect(existsSync(join(waiters, 'dead-waiter'))).toBe(false);
    expect(existsSync(join(waiters, 'live-waiter'))).toBe(true);
    expect(locks.readBuildSlots()).toMatchObject({ waiting: 1 });
  });

  it('exits 7 naming the holders when the slot budget runs out', async () => {
    const dir = registry();
    const start = locks.processStartTime(process.pid) ?? '';
    writeSlot(dir, 1, { pid: process.pid, start, pgid: 0, token: 'holder' });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const failure = await locks
      .withBuildSlots(async () => {}, {
        waitMs: 300,
        progressMs: 100,
        backoffMs: { initial: 10, max: 20 },
        decide: refuse,
        invalidate: () => {},
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 7 });
    if (!(failure instanceof Error)) throw new Error('expected an EnvFailure');
    expect(failure.message).toContain(`pid ${process.pid}`);
    expect(failure.message).toContain('slot 1');

    const lines = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(lines).toContain('build: waiting for a slot (1/1 busy, 1 waiting)');
    expect(lines).toMatch(/elapsed, \d+:\d\d left/);
  });
});

describe('admission warnings', () => {
  const GIB = 1024 ** 3;

  it('names the capacity test, not free memory, when capacity is what failed', async () => {
    registry();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // 8.0 − (1 × 3.9 + 0.0) = 4.1 < 4.5 fails, while 14.0 GB of free memory
    // clears the floor: only the capacity test failed, so only it may be named.
    await locks.withBuildSlots(() => Promise.resolve(), {
      invalidate: () => {},
      probe: () => ({
        capacityBytes: 8 * GIB,
        freeBytes: 14 * GIB,
        hostFallback: false,
        detail: null,
      }),
    });

    const lines = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(lines).toContain(
      'warning: build: admitting one build under memory pressure (capacity 8.0 GB − ' +
        '(1 × 3.9 GB + reserve 0.0 GB) = 4.1 GB < MIN_FREE 4.5 GB)',
    );
    expect(lines).not.toContain('free 14.0 GB < MIN_FREE');
  });

  it('names free memory when the free test is what failed', async () => {
    registry();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await locks.withBuildSlots(() => Promise.resolve(), {
      invalidate: () => {},
      probe: () => ({
        capacityBytes: 19.5 * GIB,
        freeBytes: 3.2 * GIB,
        hostFallback: false,
        detail: null,
      }),
    });

    const lines = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(lines).toContain(
      'warning: build: admitting one build under memory pressure (free 3.2 GB < ' +
        'MIN_FREE 4.5 GB, stack reserve 0.0 GB)',
    );
    expect(lines).not.toContain('capacity 19.5 GB −');
  });
});

describe('build in progress', () => {
  it('names the live build that holds this worktree mutex, with its slot', () => {
    const dir = registry();
    const start = locks.processStartTime(process.pid) ?? '';
    writeSlot(dir, 1, { pid: process.pid, start, token: 'live' });
    writeMutex(dir, { pid: process.pid, start, startedAt: '2026-11-17T18:53:45.000Z' });

    expect(locks.buildInProgress()).toEqual({
      pid: process.pid,
      start,
      startedAt: '2026-11-17T18:53:45.000Z',
      slot: 1,
    });
  });

  it('reports no build for a mutex whose holder is gone or whose pid was recycled', () => {
    const dir = registry();
    const mutex = writeMutex(dir, { pid: process.pid, start: 'not-this-process' });
    expect(locks.buildInProgress()).toBeNull();

    writeFileSync(join(mutex, 'pid'), '999999999\n');
    writeFileSync(join(mutex, 'start'), '1\n');
    expect(locks.buildInProgress()).toBeNull();

    // A mutex that has not named its owner yet is a build taking it, not a free
    // one, until the no-owner grace expires.
    writeFileSync(join(mutex, 'pid'), '0\n');
    expect(locks.buildInProgress()).toMatchObject({ pid: null });
  });

  it('refuses with the build’s pid, start time and slot', () => {
    const failure = locks.buildInProgressFailure({
      pid: 4242,
      start: '99',
      startedAt: '2026-11-17T18:53:45.000Z',
      slot: 2,
    });

    expect(failure).toMatchObject({ name: 'EnvFailure', exitCode: 6 });
    expect(failure.message).toContain('pid 4242');
    expect(failure.message).toContain('started 2026-11-17T18:53:45.000Z');
    expect(failure.message).toContain('slot 2');
  });
});
