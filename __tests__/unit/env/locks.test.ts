import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { BUN } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Shorter than the enclosing test timeout, so a hung child fails the assertion
// with its own message while `finally` still gets to kill the process groups.
const CHILD_DEADLINE_MS = 20_000;

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

  it('never removes a successor directory when a presumed-stale holder releases', async () => {
    const dir = registry();
    const lockDir = join(dir, 'build.lock.d');

    await withoutPath(async () => {
      await locks.withBuildLock(() => {
        // A successor took the lock over: the directory it now owns has a new
        // inode and its own token. The previous holder's release must not
        // delete it.
        rmSync(lockDir, { recursive: true, force: true });
        mkdirSync(lockDir, { mode: 0o700 });
        writeFileSync(join(lockDir, 'pid'), `${process.pid}\n`);
        writeFileSync(join(lockDir, 'token'), 'successor-token\n');
      });
    });

    expect(existsSync(lockDir)).toBe(true);
    expect(readFileSync(join(lockDir, 'token'), 'utf8').trim()).toBe('successor-token');
  });

  it('keeps several concurrent processes mutually exclusive through the fallback', async () => {
    // The portable fallback is the only mutex on hosts without `flock`; the
    // whole point is that no two processes are ever inside at once, so run the
    // real acquisition in separate processes, with `flock` forced to fail.
    const dir = registry();
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'flock'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    chmodSync(join(binDir, 'flock'), 0o755);
    const markers = join(dir, 'markers');
    mkdirSync(markers);
    const done = join(dir, 'done');
    mkdirSync(done);

    const childScript = join(dir, 'hold.ts');
    writeFileSync(
      childScript,
      [
        `const { withBuildLock } = await import(${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'scripts/env/lib/locks.ts')).href)});`,
        `const fs = await import('node:fs');`,
        `const [dir, id, go, rounds, log] = process.argv.slice(2);`,
        `const markers = ${JSON.stringify(markers)};`,
        `while (!fs.existsSync(go)) await new Promise((done) => setTimeout(done, 2));`,
        `const violations = [];`,
        `for (let round = 0; round < Number(rounds); round += 1) {`,
        `  await withBuildLock(async () => {`,
        `    const marker = markers + '/' + id + '-' + round + '.busy';`,
        `    fs.writeFileSync(marker, '');`,
        // Hold long enough that an overlapping holder is provably observed.
        `    await new Promise((done) => setTimeout(done, 15));`,
        `    const live = fs.readdirSync(markers);`,
        `    if (live.length !== 1) violations.push(id + '-' + round + ': ' + live.join(','));`,
        `    fs.rmSync(marker, { force: true });`,
        `    fs.appendFileSync(log, id + '-' + round + '\\n');`,
        `  });`,
        `}`,
        `fs.writeFileSync(${JSON.stringify(done)} + '/' + id + '.json', JSON.stringify(violations));`,
        '',
      ].join('\n'),
    );

    const ids = ['a', 'b', 'c', 'd'];
    const rounds = 3;
    const go = join(dir, 'go');
    const sectionLog = join(dir, 'sections.log');
    const children = ids.map((id) => {
      const child = spawn(BUN, [childScript, dir, id, go, String(rounds), sectionLog], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          STUDIQ_DEV_REGISTRY: dir,
        },
        detached: true,
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      const closed = new Promise<{ code: number | null; stderr: string }>((resolve) => {
        child.on('error', () => resolve({ code: null, stderr }));
        child.on('close', (code) => resolve({ code, stderr }));
      });
      return { child, closed };
    });
    writeFileSync(go, 'go\n');
    // A child that never exits must not burn the whole test timeout and leave
    // this cleanup racing the harness: expire first, then let `finally` kill
    // every child process group.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`lock stress children did not exit within ${CHILD_DEADLINE_MS} ms`)),
          CHILD_DEADLINE_MS,
        );
      });
      const results = await Promise.race([
        Promise.all(children.map((entry) => entry.closed)),
        deadline,
      ]);
      for (const result of results) expect(result.code, result.stderr).toBe(0);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      for (const entry of children) {
        if (entry.child.exitCode !== null) continue;
        try {
          if (entry.child.pid !== undefined) process.kill(-entry.child.pid, 'SIGKILL');
          else entry.child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }

    for (const id of ids) {
      const parsed: unknown = JSON.parse(readFileSync(join(done, `${id}.json`), 'utf8'));
      expect(parsed).toEqual([]);
    }
    // Every critical section ran exactly once, and none was lost.
    const sections = readFileSync(sectionLog, 'utf8').split('\n').filter(Boolean);
    expect(sections).toHaveLength(ids.length * rounds);
    expect(new Set(sections).size).toBe(ids.length * rounds);
    expect(existsSync(join(dir, 'build.lock.d'))).toBe(false);
    // Four real `bun` children under CI load need more than the 5 s default.
  }, 60_000);
});
