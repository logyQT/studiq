import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface LocksModule {
  pidAlive(pid: number): boolean;
  ensureRegistryDir(): string;
  withCheckoutLock<T>(fn: () => Promise<T> | T): Promise<T>;
  withBuildLock<T>(fn: () => Promise<T> | T): Promise<T>;
}

// `state.ts` captures DEV_DIR at import time; point it at a temp dir before
// loading any scripts/env module so the suite never writes the real `.dev/`.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-locks-state-'));
const savedStateDir = process.env.STUDIQ_ENV_STATE_DIR;
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const locks = await loadEnvModule<LocksModule>('lib/locks.ts');
const dirs: string[] = [];

afterAll(() => {
  if (savedStateDir === undefined) delete process.env.STUDIQ_ENV_STATE_DIR;
  else process.env.STUDIQ_ENV_STATE_DIR = savedStateDir;
  rmSync(stateDir, { recursive: true, force: true });
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-locks-'));
  dirs.push(dir);
  process.env.STUDIQ_DEV_REGISTRY = dir;
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serializes(acquire: (fn: () => Promise<void>) => Promise<void>): Promise<number> {
  let active = 0;
  let maximum = 0;
  await Promise.all(
    Array.from({ length: 4 }, () =>
      acquire(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await sleep(60);
        active -= 1;
      }),
    ),
  );
  return maximum;
}

/**
 * Hide every executable so `hasFlock()` fails and the portable directory
 * mutex is used (stock macOS has no `flock`).
 */
async function withoutPath<T>(fn: () => Promise<T>): Promise<T> {
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    return await fn();
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
}

describe('lock primitives', () => {
  const savedRegistry = process.env.STUDIQ_DEV_REGISTRY;

  afterEach(() => {
    if (savedRegistry === undefined) delete process.env.STUDIQ_DEV_REGISTRY;
    else process.env.STUDIQ_DEV_REGISTRY = savedRegistry;
  });

  it('treats only ESRCH as dead (a live pid is never reclaimed)', () => {
    expect(locks.pidAlive(process.pid)).toBe(true);
    expect(locks.pidAlive(999_999_999)).toBe(false);
    expect(locks.pidAlive(0)).toBe(false);
  });

  it('creates the registry with private permissions', () => {
    const dir = registry();
    chmodSync(dir, 0o755);
    expect(locks.ensureRegistryDir()).toBe(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('serializes ensure/down/serve and lease decisions per checkout', async () => {
    registry();
    expect(await serializes((fn) => locks.withCheckoutLock(fn))).toBe(1);
  });

  it('serializes the cross-worktree build lock', async () => {
    registry();
    expect(await serializes((fn) => locks.withBuildLock(fn))).toBe(1);
  });

  it('releases the lock when the callback throws', async () => {
    registry();
    await expect(
      locks.withCheckoutLock(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const value = await locks.withCheckoutLock(() => 'free');
    expect(value).toBe('free');
  });

  it('falls back to the directory mutex when flock is unavailable', async () => {
    const dir = registry();
    await withoutPath(async () => {
      expect(await serializes((fn) => locks.withBuildLock(fn))).toBe(1);
    });
    expect(existsSync(join(dir, 'build.lock.d'))).toBe(false);
  });

  it('takes over a directory lock left by a dead pid', async () => {
    const dir = registry();
    const lockDir = join(dir, 'build.lock.d');
    mkdirSync(lockDir, { mode: 0o700 });
    writeFileSync(join(lockDir, 'pid'), '999999999\n');

    let ran = false;
    await withoutPath(async () => {
      await locks.withBuildLock(() => {
        ran = true;
      });
    });
    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });

  it('takes over a directory lock with a missing pid after the grace period', async () => {
    const dir = registry();
    const lockDir = join(dir, 'build.lock.d');
    mkdirSync(lockDir, { mode: 0o700 });
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockDir, old, old);

    let ran = false;
    await withoutPath(async () => {
      await locks.withBuildLock(() => {
        ran = true;
      });
    });
    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });
});
