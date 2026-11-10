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

/**
 * Registry state is trusted only when it is a real directory owned by the
 * current user. The same guard covers the registry root and the shared
 * `claims/` subdirectory, so a precreated symlink can never redirect a claim.
 */
function trustRegistryDir(dir: string): string {
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

export function ensureRegistryDir(): string {
  return trustRegistryDir(resolveRegistryDir());
}

/**
 * A private subdirectory of the shared registry (for example `claims/`). The
 * parent is validated first: a symlinked or foreign registry root must never be
 * joined into, or the subdirectory guard would validate the wrong path.
 */
export function ensureRegistrySubdir(name: string, parent = resolveRegistryDir()): string {
  return trustRegistryDir(join(trustRegistryDir(parent), name));
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

/**
 * Acquire one mutex at `file`, honouring `flock` and falling back to the
 * portable directory mutex. A wait timeout is reported as the caller's code and
 * message instead of the generic lock timeout.
 */
async function acquireMutex(
  file: string,
  waitSeconds: number,
  timeoutCode: number,
  message: string,
): Promise<Mutex> {
  try {
    return (await flockMutex(file, waitSeconds)) ?? (await dirMutex(`${file}.d`, waitSeconds));
  } catch (error) {
    if (error instanceof EnvFailure && error.exitCode === EXIT_TIMEOUT) {
      throw new EnvFailure(timeoutCode, message);
    }
    throw error;
  }
}

async function withLockAt<T>(
  file: string,
  waitSeconds: number,
  timeoutCode: number,
  message: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const mutex = await acquireMutex(file, waitSeconds, timeoutCode, message);
  try {
    return await fn();
  } finally {
    await mutex.release();
  }
}

/**
 * A held checkout lock that its owner can deliberately release and re-acquire.
 *
 * `ensure` needs this around a production build: the build takes minutes, and
 * holding the checkout-wide lock for it would block every other env command
 * (`down` included). The lock is released only while the build runs and is
 * always taken back before anything is served or reported.
 */
export interface CheckoutLock {
  /** Release the lock. A no-op when it is already free. */
  release(): Promise<void>;
  /** Take the lock back after a deliberate release. A no-op while held. */
  acquire(): Promise<void>;
}

const CHECKOUT_LOCK_WAIT_SECONDS = 180;
const CHECKOUT_LOCK_BUSY = 'another env process is using this checkout; retry after it finishes';

function checkoutLockFile(): string {
  ensureDevDir();
  const locksDir = join(DEV_DIR, 'locks');
  mkdirSync(locksDir, { recursive: true, mode: 0o700 });
  chmodSync(locksDir, 0o700);
  return join(locksDir, 'checkout.lock');
}

/**
 * `.dev/locks/checkout.lock` is per checkout and covers ensure/down/serve and
 * every app-port lease read/write; while it is held the lease is authoritative.
 */
export async function acquireCheckoutLock(): Promise<CheckoutLock> {
  const file = checkoutLockFile();
  let mutex: Mutex | null = await acquireMutex(
    file,
    CHECKOUT_LOCK_WAIT_SECONDS,
    EXIT_CONFLICT,
    CHECKOUT_LOCK_BUSY,
  );
  return {
    async release() {
      const held = mutex;
      if (!held) return;
      mutex = null;
      await held.release();
    },
    async acquire() {
      if (mutex) return;
      mutex = await acquireMutex(
        file,
        CHECKOUT_LOCK_WAIT_SECONDS,
        EXIT_CONFLICT,
        CHECKOUT_LOCK_BUSY,
      );
    },
  };
}

export async function withCheckoutLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const lock = await acquireCheckoutLock();
  try {
    return await fn();
  } finally {
    await lock.release();
  }
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

/**
 * Registry-wide mutex for app-port claim recovery. A stale claim is removed and
 * re-claimed as one unit: without this, two recoverers can both observe the
 * dead holder, one re-claims, and the other's pending unlink deletes the new
 * claim. Initial `wx` acquisition never takes it, so a claim is still atomic on
 * its own. The portable directory fallback covers hosts without `flock`.
 */
export function withClaimsLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const dir = ensureRegistrySubdir('locks');
  return withLockAt(
    join(dir, 'claims.lock'),
    30,
    EXIT_CONFLICT,
    'timed out waiting for the app-port claims lock',
    fn,
  );
}
