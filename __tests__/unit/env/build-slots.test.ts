import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

interface AdmissionDecision {
  admit: boolean;
  cap: number;
  reason: string;
}

interface LocksModule {
  processStartTime(pid: number): string | null;
  readBuildSlots(): BuildSlotsStatus | null;
  formatBuildSlots(status: BuildSlotsStatus | null): string;
  withBuildSlots<T>(
    fn: (slot: BuildSlotHandle) => Promise<T>,
    options?: {
      waitMs?: number;
      progressMs?: number;
      backoffMs?: { initial: number; max: number };
      decide?(activeSlots: number): AdmissionDecision;
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
  token?: string;
  worktree?: string;
}

function writeSlot(dir: string, slot: number, fixture: SlotFixture): string {
  const path = join(slotsDir(dir), String(slot));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(path, 'pid'), `${fixture.pid}\n`);
  writeFileSync(join(path, 'start'), `${fixture.start ?? ''}\n`);
  writeFileSync(join(path, 'pgid'), `${fixture.pgid ?? 0}\n`);
  writeFileSync(join(path, 'token'), `${fixture.token ?? 'fixture-token'}\n`);
  writeFileSync(join(path, 'worktree'), `${fixture.worktree ?? '/tmp/another-worktree'}\n`);
  writeFileSync(join(path, 'startedAt'), `${new Date().toISOString()}\n`);
  writeFileSync(join(path, 'heartbeat'), `${Date.now()}\n`);
  return path;
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
  it('reads a process start time that a recycled pid cannot match', () => {
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
    writeSlot(dir, 1, { pid: process.pid, start, pgid: 999_999, token: 'orphan' });
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
