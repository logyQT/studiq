import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { EXIT_CONFLICT, EXIT_TIMEOUT, EnvFailure } from './exit';
import { writeStderrLine } from './output';
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

/** The 5 s a directory lock with no owner record is trusted before takeover. */
const DIR_LOCK_NO_OWNER_GRACE_MS = 5_000;

/** The directory's identity: a released or replaced lock changes it. */
export interface DirLockIdentity {
  dev: number;
  ino: number;
  mtimeMs: number;
}

function dirLockIdentity(path: string): DirLockIdentity | null {
  try {
    const stat = lstatSync(path);
    return { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function readOwnerField(path: string, name: string): string | null {
  try {
    return readFileSync(join(path, name), 'utf8').trim();
  } catch {
    return null;
  }
}

/** The holder identity a directory lock records (`pid` and a random `token`). */
export interface DirLockOwner {
  pid: number;
  /** Holder identity written with the pid; '' when the holder left no token. */
  token: string;
}

function readDirLockOwner(path: string): DirLockOwner {
  return {
    pid: Number(readOwnerField(path, 'pid') ?? '') || 0,
    token: readOwnerField(path, 'token') ?? '',
  };
}

/**
 * Remove a held directory only while it still belongs to this holder.
 *
 * A stale takeover replaces the directory with its own (new inode, new token),
 * so the previous holder's release must compare the token *and* the inode and
 * leave a successor's lock alone. `force` keeps a dir that a takeover already
 * removed from becoming an error.
 */
function releaseDirMutex(path: string, token: string): void {
  const observed = dirLockIdentity(path);
  if (!observed) return;
  if (readDirLockOwner(path).token !== token) return;
  const current = dirLockIdentity(path);
  if (!current || current.dev !== observed.dev || current.ino !== observed.ino) return;
  rmSync(path, { recursive: true, force: true });
}

/**
 * Take over a directory lock whose recorded owner is provably gone.
 *
 * A "re-read the identity, then `rmSync(path, { recursive: true })`" sequence
 * still has a takeover race: a successor can replace the directory between the
 * check and the recursive delete, and the delete then removes the successor's
 * lock. The takeover therefore *moves* whatever sits at `path` to a unique
 * tombstone (an atomic `rename` within the same directory) and inspects the
 * object it actually moved: only a tombstone that still matches the observed
 * stale owner (same dev/inode, pid and token) is removed. Anything else — a
 * successor installed in the window — is renamed back and left alone.
 *
 * Residual limitation on hosts without `flock`: if a successor appears at
 * `path` after a *different* object was moved aside, the rename back cannot
 * overwrite it (a non-empty directory is never replaced), so that successor's
 * lock stays in the tombstone and this process retries/fails closed. Nothing a
 * successor still owns is ever deleted; only `flock` makes the whole sequence
 * race-free, which is why it stays the preferred path.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function takeoverStaleDirLock(
  path: string,
  observed: DirLockIdentity,
  owner: DirLockOwner,
): boolean {
  const tombstone = `${path}.tombstone-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    // The rename is the observation: it moves exactly the object that is at
    // `path` now, so the verification below cannot describe another directory.
    renameSync(path, tombstone);
  } catch (error) {
    // A successor released or replaced it first (or the parent is gone): the
    // retry loop re-observes. Only a missing path is an expected outcome.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
  const moved = dirLockIdentity(tombstone);
  const movedOwner = readDirLockOwner(tombstone);
  if (
    moved === null ||
    moved.dev !== observed.dev ||
    moved.ino !== observed.ino ||
    movedOwner.pid !== owner.pid ||
    movedOwner.token !== owner.token
  ) {
    // A successor got moved instead of the stale lock: put it back untouched.
    // If the name is already taken again, its lock stays in the tombstone and
    // is never deleted.
    try {
      renameSync(tombstone, path);
    } catch {
      writeStderrLine(
        `warning: could not restore the directory lock at ${path} after a takeover race; left it at ${tombstone}`,
      );
    }
    return false;
  }
  rmSync(tombstone, { recursive: true, force: true });
  return true;
}

/**
 * The fallback for hosts without `flock`: `mkdir` is the acquisition primitive
 * and the directory holds the holder's pid and a random token. The token makes
 * release and stale takeover identity-checked, so a holder that was presumed
 * stale can never delete the lock a successor now owns.
 */
async function dirMutex(path: string, waitSeconds: number): Promise<Mutex> {
  const deadline = Date.now() + waitSeconds * 1000;
  const token = randomBytes(12).toString('hex');
  for (;;) {
    try {
      mkdirSync(path, { mode: 0o700 });
      try {
        writeFileSync(join(path, 'pid'), `${process.pid}\n`, { mode: 0o600 });
        writeFileSync(join(path, 'token'), `${token}\n`, { mode: 0o600 });
      } catch (error) {
        // A lock that cannot name its owner would never be taken over.
        rmSync(path, { recursive: true, force: true });
        throw error;
      }
      return {
        async release() {
          releaseDirMutex(path, token);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const observed = dirLockIdentity(path);
      if (!observed) continue;
      const owner = readDirLockOwner(path);
      const stale =
        (owner.pid > 0 && !pidAlive(owner.pid)) ||
        (owner.pid === 0 && Date.now() - observed.mtimeMs > DIR_LOCK_NO_OWNER_GRACE_MS);
      if (stale) {
        // Move the observed object aside and verify what was actually moved: a
        // successor that replaced the directory in the window is never deleted
        // (see `takeoverStaleDirLock`).
        takeoverStaleDirLock(path, observed, owner);
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
