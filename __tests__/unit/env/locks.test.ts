import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface StartLockOptions {
  key: string;
  projectRoot: string;
  branch: string;
  stackName: string;
  waitSeconds: number;
}

interface StartLock {
  file: string;
  release(): void;
}

interface LocksModule {
  pidAlive(pid: number): boolean;
  acquireStartLock(options: StartLockOptions): Promise<StartLock>;
  withRegistryLeaseLock<T>(fn: () => Promise<T>): Promise<T>;
}

const locks = await loadEnvModule<LocksModule>('lib/locks.ts');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-locks-'));
  dirs.push(dir);
  process.env.STUDIQ_DEV_REGISTRY = dir;
  return dir;
}

function options(key: string, waitSeconds = 2): StartLockOptions {
  return {
    key,
    projectRoot: '/checkout',
    branch: 'refs/heads/feat/x',
    stackName: '',
    waitSeconds,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  it('takes over a dead start-lock holder under the mutex', async () => {
    const dir = registry();
    const lockDir = join(dir, 'locks');
    mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    const key = 'dead-holder';
    writeFileSync(
      join(lockDir, `start-${key}.lock`),
      `${JSON.stringify({
        pid: 999_999_999,
        token: 'dead',
        projectRoot: '/checkout',
        branch: 'refs/heads/feat/x',
        stackName: '',
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })}\n`,
      { mode: 0o600 },
    );

    const lock = await locks.acquireStartLock(options(key));
    const content: unknown = JSON.parse(readFileSync(lock.file, 'utf8'));
    expect(content).toMatchObject({ pid: process.pid });
    lock.release();
    expect(existsSync(lock.file)).toBe(false);
  });

  it('recovers from an empty/partial lock without wedging', async () => {
    const dir = registry();
    const lockDir = join(dir, 'locks');
    mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(lockDir, 'start-partial.lock'), '{"pid":', { mode: 0o600 });

    const lock = await locks.acquireStartLock(options('partial'));
    expect(JSON.parse(readFileSync(lock.file, 'utf8'))).toMatchObject({ pid: process.pid });
    lock.release();
    expect(existsSync(lock.file)).toBe(false);
  });

  it('publishes complete lock content and never reaps a live holder', async () => {
    registry();
    const first = await locks.acquireStartLock(options('complete'));
    const published = readFileSync(first.file, 'utf8');
    const parsed: unknown = JSON.parse(published);
    expect(parsed).toBeTruthy();

    let secondAcquired = false;
    const secondPromise = (async () => {
      const lock = await locks.acquireStartLock(options('complete', 2));
      secondAcquired = true;
      lock.release();
    })();

    await sleep(250);
    expect(secondAcquired).toBe(false);
    expect(readFileSync(first.file, 'utf8')).toBe(published);
    first.release();
    await secondPromise;
    expect(secondAcquired).toBe(true);
  });

  it('lets only one waiter acquire the start lock after a release', async () => {
    registry();
    const first = await locks.acquireStartLock(options('one-waiter'));
    let secondAcquired = false;
    const secondPromise = (async () => {
      const lock = await locks.acquireStartLock(options('one-waiter', 3));
      secondAcquired = true;
      lock.release();
    })();

    await sleep(250);
    expect(secondAcquired).toBe(false);
    first.release();
    await secondPromise;
    expect(secondAcquired).toBe(true);
  });

  it('serializes registry lease decisions', async () => {
    registry();
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        locks.withRegistryLeaseLock(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await sleep(60);
          active -= 1;
        }),
      ),
    );
    expect(maximum).toBe(1);
  });
});
