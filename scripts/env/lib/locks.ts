import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { EXIT_CONFLICT, EXIT_TIMEOUT, EnvFailure } from './exit';
import { resolveRegistryDir } from './registry';
import { DEV_DIR, ensureDevDir } from './state';

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function ensureRegistryDir(): string {
  const dir = resolveRegistryDir();
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new EnvFailure(EXIT_CONFLICT, `registry path ${dir} is a symlink; refusing to use it`);
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory()) {
    throw new EnvFailure(EXIT_CONFLICT, `registry path ${dir} is not a directory`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && lstatSync(dir).uid !== uid) {
    throw new EnvFailure(EXIT_CONFLICT, `registry directory ${dir} is not owned by this user`);
  }
  chmodSync(dir, 0o700);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Mutex {
  release(): Promise<void>;
}

function hasFlock(): boolean {
  return spawnSync('flock', ['--version'], { timeout: 5_000 }).status === 0;
}

async function flockMutex(path: string, waitSeconds: number): Promise<Mutex | null> {
  if (!hasFlock()) return null;
  return new Promise((resolve, reject) => {
    const child = spawn(
      'flock',
      ['-w', String(waitSeconds), path, 'sh', '-c', 'printf ready; read _'],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let ready = false;
    const timer = setTimeout(
      () => {
        if (ready) return;
        child.kill('SIGKILL');
        reject(new EnvFailure(EXIT_TIMEOUT, `timed out waiting for ${path}`));
      },
      (waitSeconds + 5) * 1000,
    );
    timer.unref?.();
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (ready || !String(chunk).includes('ready')) return;
      ready = true;
      clearTimeout(timer);
      resolve({
        async release() {
          child.stdin?.write('\n');
          await new Promise<void>((done) => {
            if (child.exitCode !== null) return done();
            child.once('close', () => done());
          });
        },
      });
    });
    child.on('error', () => {
      if (ready) return;
      clearTimeout(timer);
      reject(new EnvFailure(EXIT_CONFLICT, `cannot run flock for ${path}`));
    });
    child.on('close', () => {
      if (ready) return;
      clearTimeout(timer);
      reject(new EnvFailure(EXIT_TIMEOUT, `timed out waiting for ${path}`));
    });
  });
}

async function dirMutex(path: string, waitSeconds: number): Promise<Mutex> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(join(path, 'pid'), `${process.pid}\n`, { mode: 0o600 });
      return {
        async release() {
          rmSync(path, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let observed;
      try {
        observed = lstatSync(path);
      } catch {
        continue;
      }
      let owner = 0;
      try {
        owner = Number(readFileSync(join(path, 'pid'), 'utf8').trim());
      } catch {
        /* missing pid: grace period below */
      }
      const stale =
        (owner && !pidAlive(owner)) || (!owner && Date.now() - observed.mtimeMs > 5_000);
      if (stale) {
        try {
          const current = lstatSync(path);
          if (current.dev === observed.dev && current.ino === observed.ino) {
            rmSync(path, { recursive: true, force: true });
          }
        } catch {
          /* gone */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new EnvFailure(EXIT_TIMEOUT, `timed out waiting for ${path}`);
      }
      await sleep(50);
    }
  }
}

async function withLockAt<T>(
  file: string,
  waitSeconds: number,
  timeoutCode: number,
  message: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  let mutex: Mutex;
  try {
    mutex = (await flockMutex(file, waitSeconds)) ?? (await dirMutex(`${file}.d`, waitSeconds));
  } catch (error) {
    if (error instanceof EnvFailure && error.exitCode === EXIT_TIMEOUT) {
      throw new EnvFailure(timeoutCode, message);
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await mutex.release();
  }
}

export function withCheckoutLock<T>(fn: () => Promise<T> | T): Promise<T> {
  // `.dev/locks/checkout.lock` is per checkout and covers ensure/down/serve and
  // every app-port lease read/write; while it is held the lease is authoritative.
  ensureDevDir();
  const locksDir = join(DEV_DIR, 'locks');
  mkdirSync(locksDir, { recursive: true, mode: 0o700 });
  chmodSync(locksDir, 0o700);
  return withLockAt(
    join(locksDir, 'checkout.lock'),
    180,
    EXIT_CONFLICT,
    'another env process is using this checkout; retry after it finishes',
    fn,
  );
}

function withLock<T>(
  name: string,
  waitSeconds: number,
  timeoutCode: number,
  message: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  return withLockAt(join(ensureRegistryDir(), name), waitSeconds, timeoutCode, message, fn);
}

export function withBuildLock<T>(fn: () => Promise<T> | T): Promise<T> {
  return withLock(
    'build.lock',
    1800,
    EXIT_TIMEOUT,
    'timed out waiting for the cross-worktree build lock',
    fn,
  );
}
