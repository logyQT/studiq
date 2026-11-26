import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import {
  decideAdmission,
  formatGb,
  minFreeBytes,
  probeMemory,
  readStackReserve,
  slotCap,
  stackReserveBytes,
  SLOT_RSS_BYTES,
  type AdmissionDecision,
  type AdmissionFailure,
  type MemoryReading,
} from './admission';
import { atomicWriteFile } from './atomic-file';
import { EXIT_CONFLICT, EXIT_QUEUED, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from './exit';
import type { BuildSlotsStatus } from './json';
import { writeStderrLine } from './output';
import { resolveRegistryDir } from './registry';
import { REPO_ROOT, canon } from './repo';
import { buildArtifactDir, DEV_DIR, ensureDevDir, invalidateBuildArtifact } from './state';

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
  /**
   * Process start time, when the record carries one. A recycled pid then fails
   * the identity check instead of keeping a dead holder's directory alive.
   */
  start?: string | null;
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
    movedOwner.token !== owner.token ||
    (owner.start != null && readOwnerField(tombstone, 'start') !== owner.start)
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
 * Record this attempt as the directory lock's owner.
 *
 * `true` means the directory now names its owner. `false` means the directory
 * vanished before it could be named (`ENOENT`): ownership is lost, and a
 * successor may already hold the path, so the caller retries without removing
 * anything. Any other failure removes the directory only while it is still the
 * object this attempt created (same dev and inode), then rethrows; a successor
 * installed in the meantime is never deleted.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function writeDirLockOwner(path: string, token: string, owned: DirLockIdentity): boolean {
  try {
    writeFileSync(join(path, 'pid'), `${process.pid}\n`, { mode: 0o600 });
    writeFileSync(join(path, 'token'), `${token}\n`, { mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    // A lock that cannot name its owner would never be taken over, but only
    // the directory this attempt created may be cleaned up.
    const current = dirLockIdentity(path);
    if (current && current.dev === owned.dev && current.ino === owned.ino) {
      rmSync(path, { recursive: true, force: true });
    }
    throw error;
  }
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
      // Capture the identity immediately: it is what proves (on a later write
      // failure) that the directory being removed is still ours.
      const owned = dirLockIdentity(path);
      if (!owned || !writeDirLockOwner(path, token, owned)) continue;
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

/**
 * Run `fn` while the checkout lock is free, then take it back.
 *
 * A production build takes minutes and the lock is checkout-wide, so holding it
 * for the build would block every other env command (`down` included) — and now
 * also for a slot wait that may last 30 minutes. The caller's own record (the
 * rebuild handover, or the build slot's per-worktree mutex) keeps ownership of
 * the artifact while the lock is free. The failure from `fn` is the useful
 * report, so a re-acquire failure never masks it.
 */
export async function withReleasedCheckoutLock<T>(
  lock: CheckoutLock,
  fn: () => Promise<T>,
  emptyResult: string,
): Promise<T> {
  await lock.release();
  let result: T | null = null;
  let failure: unknown;
  let failed = false;
  try {
    result = await fn();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await lock.acquire();
  } catch (error) {
    if (!failed) throw error;
  }
  if (failed) throw failure;
  if (result === null) throw new EnvFailure(EXIT_START_FAILED, emptyResult);
  return result;
}

/** One invocation may wait this long for a slot, and separately build this long. */
const SLOT_WAIT_MS = 30 * 60 * 1000;
const SLOT_PROGRESS_MS = 30_000;
const SLOT_BACKOFF_INITIAL_MS = 2_000;
const SLOT_BACKOFF_MAX_MS = 10_000;
/** A slot directory that has not named its owner yet is trusted this long. */
const SLOT_NO_OWNER_GRACE_MS = 5_000;
/** SIGTERM → SIGKILL grace before a process group is declared dead. */
const KILL_GRACE_MS = 10_000;
/** The time that the system gets to remove a group after SIGKILL. */
const REAP_GRACE_MS = 1_000;
const SLOTS_DIR = 'build-slots';

/**
 * A process's start time: the half of an identity that a pid alone cannot carry.
 *
 * Linux reads field 22 of `/proc/<pid>/stat` (clock ticks since boot). The comm
 * field may contain spaces and parentheses, so the fields are read after the
 * last `)`, where field 3 starts. Elsewhere `ps -o lstart=` answers the same
 * question in text form.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function processStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      const start = fields[19];
      return start === undefined || start === '' ? null : start;
    } catch {
      return null;
    }
  }
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  const value = (result.stdout ?? '').trim();
  return result.status === 0 && value !== '' ? value : null;
}

function groupAlive(pgid: number): boolean {
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Cleanup cannot confirm that a process group ended. Its build slot must stay in use.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export class UnconfirmedGroupError extends EnvFailure {
  /** `heldBy` is the stale slot that records the group. Null means a build of this process. */
  constructor(
    readonly pgid: number,
    readonly heldBy: HeldSlot | null = null,
  ) {
    super(
      EXIT_CONFLICT,
      `cannot confirm that process group ${pgid} ended: the system still answers EPERM after SIGKILL. A build process can possibly still write to .next.${heldBy === null ? '' : heldSlotSteps(pgid, heldBy)}`,
    );
  }

  /** True when the group can write to the `.next` of `root`. An unknown owner counts as true. */
  concernsCheckout(root: string = REPO_ROOT): boolean {
    const owner = this.heldBy?.worktree ?? '';
    return owner === '' || canon(owner) === canon(root);
  }
}

interface HeldSlot {
  slot: number;
  path: string;
  worktree: string;
}

function heldSlotSteps(pgid: number, held: HeldSlot): string {
  return ` The new build did not start. Build slot ${held.slot} stays in use: ${held.path} (worktree: ${held.worktree || 'unknown'}). To examine the group, run: ps -axo pid,ppid,pgid,stat,command | awk '$3 == ${pgid}'. A process with state Z ends when its parent collects it or when the parent ends. Delete the slot directory only after you confirm that no process of this group can write to .next.`;
}

function groupDenied(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Waits until the system answers ESRCH for the group, for at most `graceMs`. */
async function groupGone(pgid: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!groupAlive(pgid)) return true;
    await sleep(100);
  }
  return !groupAlive(pgid);
}

/**
 * SIGTERM the group, wait out the grace, then SIGKILL.
 *
 * `false` means there was no group to signal. Callers release a slot only after
 * this returns, so a new build is never admitted over an orphan still writing
 * `.next`.
 *
 * EPERM does not show that the group ended. macOS answers EPERM, not ESRCH, for a
 * group that has only processes that ended and that no parent collected yet. Thus
 * this function waits for ESRCH. If the answer is still EPERM after SIGKILL, it
 * throws `UnconfirmedGroupError`.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export async function killProcessGroup(
  pgid: number,
  graceMs = KILL_GRACE_MS,
  reapMs = REAP_GRACE_MS,
): Promise<boolean> {
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ESRCH') return false;
    if (code !== 'EPERM') throw error;
  }
  if (await groupGone(pgid, graceMs)) return true;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    /* the group exited, or the check below reports that it did not */
  }
  if (await groupGone(pgid, reapMs)) return true;
  if (groupDenied(pgid)) throw new UnconfirmedGroupError(pgid);
  return true;
}

export interface SlotRecord {
  slot: number;
  path: string;
  pid: number;
  start: string | null;
  pgid: number;
  /**
   * The group leader's start time, recorded with the `pgid`. A pgid is a pid, so
   * a recycled number can name an unrelated group; the reclaim verifies this
   * before signalling.
   */
  pgidStart: string | null;
  token: string;
  worktree: string;
  startedAt: string;
  /** Age of the heartbeat file, or of the directory when it has none. */
  heartbeatAgeMs: number;
}

/** `pending` is a directory that has not named its owner yet (a takeover window). */
export type SlotState = 'live' | 'stale' | 'pending';

function writeField(dir: string, name: string, value: string): void {
  writeFileSync(join(dir, name), `${value}\n`, { mode: 0o600 });
}

function writeRecord(dir: string, fields: Record<string, string>): void {
  for (const [name, value] of Object.entries(fields)) writeField(dir, name, value);
}

function readdirOrNull(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

function readSlotRecord(path: string, slot: number, now: number): SlotRecord {
  const heartbeat = lstatSync(join(path, 'heartbeat'), { throwIfNoEntry: false });
  const dir = lstatSync(path, { throwIfNoEntry: false });
  const heartbeatMs = heartbeat?.mtimeMs ?? dir?.mtimeMs ?? now;
  return {
    slot,
    path,
    pid: Number(readOwnerField(path, 'pid') ?? '') || 0,
    start: readOwnerField(path, 'start') || null,
    pgid: Number(readOwnerField(path, 'pgid') ?? '') || 0,
    pgidStart: readOwnerField(path, 'pgidStart') || null,
    token: readOwnerField(path, 'token') ?? '',
    worktree: readOwnerField(path, 'worktree') ?? '',
    startedAt: readOwnerField(path, 'startedAt') ?? '',
    heartbeatAgeMs: now - heartbeatMs,
  };
}

function startDiffers(pid: number, start: string): boolean {
  const current = processStartTime(pid);
  return current !== null && current !== start;
}

/**
 * The ADR's staleness rule: the pid is gone, the pid's start time differs, or
 * the recorded process group is gone. A matching identity is **never** stale on
 * heartbeat age alone — a long build is not a dead one.
 */
function slotState(record: SlotRecord, probe: { checkStart: boolean }): SlotState {
  if (record.pid <= 1) {
    return record.heartbeatAgeMs > SLOT_NO_OWNER_GRACE_MS ? 'stale' : 'pending';
  }
  if (!pidAlive(record.pid)) return 'stale';
  if (probe.checkStart && record.start !== null && startDiffers(record.pid, record.start)) {
    return 'stale';
  }
  if (record.pgid > 1 && !groupAlive(record.pgid)) return 'stale';
  return 'live';
}

function ensureSlotsRoot(): string {
  const root = trustRegistryDir(join(ensureRegistryDir(), SLOTS_DIR));
  trustRegistryDir(join(root, 'waiters'));
  trustRegistryDir(join(root, 'worktrees'));
  return root;
}

function readCapacity(root: string): number | null {
  const text = readOwnerField(root, 'capacity');
  if (text === null || !/^\d+$/.test(text)) return null;
  const cap = Number(text);
  return Number.isSafeInteger(cap) && cap > 0 ? cap : null;
}

interface MemoryRecord {
  degraded: boolean;
  detail: string | null;
}

function readMemoryRecord(root: string): MemoryRecord | null {
  const text = readOwnerField(root, 'memory.json');
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as { degraded?: unknown; detail?: unknown };
    return {
      degraded: record.degraded === true,
      detail: typeof record.detail === 'string' ? record.detail : null,
    };
  } catch {
    return null;
  }
}

/**
 * The slot state `env status` and `env doctor` report: one shallow `readdir`,
 * the recorded cap, and the liveness rule — pid, start time and process group.
 * Read-only and cheap: no `du`, no cap recomputation, and on Linux the identity
 * check is a `/proc` read (`ps` only where `/proc` does not exist).
 *
 * `busy` counts live records and can exceed `cap`: the cap gates admission and
 * a stack that appeared after it was derived may have lowered it, while an
 * already-admitted build keeps its slot. `busy < cap` promises nothing either —
 * the free-memory test can refuse admission below the byte-capacity cap.
 *
 * `null` means the slot directory itself is unreadable (nothing has built here),
 * which the callers render as `unknown`, never `0`.
 */
export function readBuildSlots(): BuildSlotsStatus | null {
  const root = join(resolveRegistryDir(), SLOTS_DIR);
  const names = readdirOrNull(root);
  if (names === null) return null;
  const now = Date.now();
  let busy = 0;
  let stale = 0;
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const record = readSlotRecord(join(root, name), Number(name), now);
    if (slotState(record, { checkStart: true }) === 'stale') stale += 1;
    else busy += 1;
  }
  const memory = readMemoryRecord(root);
  return {
    busy,
    cap: readCapacity(root),
    stale,
    waiting: readdirOrNull(join(root, 'waiters'))?.length ?? null,
    degraded: memory?.degraded ?? false,
    detail: memory?.detail ?? null,
  };
}

/**
 * `2 of 3 busy, 1 stale, 1 waiting` — and `unknown` for anything unreadable,
 * never `0`. Shared by `env status`, `env doctor` and the build's progress line
 * so the three cannot disagree about what the slot directory says.
 *
 * The numbers are spelled out because `0/1` read as a fraction of a build, not
 * as "no build is running out of one possible".
 */
export function formatBuildSlots(status: BuildSlotsStatus | null): string {
  if (status === null || status.busy === null) return 'unknown';
  const cap = status.cap === null ? 'unknown' : String(status.cap);
  const parts = [`${status.busy} of ${cap} busy`];
  if (status.stale) parts.push(`${status.stale} stale`);
  if (status.waiting) parts.push(`${status.waiting} waiting`);
  const degraded = status.degraded ? ' (memory gate degraded)' : '';
  return `${parts.join(', ')}${degraded}`;
}

/**
 * The live holders `env status` would count, as one line for a refusal.
 *
 * The `prebuild` guard prints this after its own refusal line: an agent that
 * finds its build refused needs to know whether the machine is busy (wait) or
 * empty (the grant is the problem). Read-only, same shallow `readdir` as status.
 */
export function describeSlotHolders(): string {
  const root = join(resolveRegistryDir(), SLOTS_DIR);
  const now = Date.now();
  const holders: string[] = [];
  for (const name of readdirOrNull(root) ?? []) {
    if (!/^\d+$/.test(name)) continue;
    const record = readSlotRecord(join(root, name), Number(name), now);
    if (slotState(record, { checkStart: true }) !== 'live') continue;
    holders.push(
      `slot ${record.slot} held by pid ${record.pid}${record.worktree ? ` in ${record.worktree}` : ''}`,
    );
  }
  return holders.join(', ');
}

/** What the `prebuild` guard needs to know about the slot a grant names. */
export interface SlotLookup {
  slot: number;
  pid: number;
  worktree: string;
  live: boolean;
  /** Why the slot is not live; null when it is. */
  reason: string | null;
}

/**
 * The slot directory whose single-use `token` matches, with decision 5's
 * liveness verdict.
 *
 * This is how the guard turns a grant into "a build really holds a slot": the
 * token is the slot's own identity, so a grant cannot name a slot that belongs
 * to another build, and `worktree` is checked by the caller against this
 * checkout's root.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function findSlotByToken(token: string): SlotLookup | null {
  if (token === '') return null;
  const root = join(resolveRegistryDir(), SLOTS_DIR);
  const now = Date.now();
  for (const name of readdirOrNull(root) ?? []) {
    if (!/^\d+$/.test(name)) continue;
    const record = readSlotRecord(join(root, name), Number(name), now);
    if (record.token !== token) continue;
    const state = slotState(record, { checkStart: true });
    return {
      slot: record.slot,
      pid: record.pid,
      worktree: record.worktree,
      live: state === 'live',
      reason:
        state === 'live'
          ? null
          : state === 'pending'
            ? 'it has not named its owner yet'
            : 'its launcher, start time or process group is gone',
    };
  }
  return null;
}

export interface BuildSlotHandle {
  readonly number: number;
  readonly token: string;
  /**
   * How long this build waited for the slot and the worktree mutex, in ms. The
   * build's wall time includes it, so a wall comparison between two builds on a
   * busy machine is not a build-speed comparison; `wall − queued` is.
   */
  readonly queuedMs: number;
  /**
   * Record the spawned build's process group so a reclaim can find it. The
   * leader's start time is recorded with it: the reclaim signals the group only
   * while that identity still matches.
   */
  setProcessGroup(pgid: number): void;
  /** Refresh the slot's heartbeat (progress tick). */
  heartbeat(): void;
}

export interface BuildSlotsOptions {
  /** Test seam: how long one invocation may wait for the mutex and the slot. */
  waitMs?: number;
  progressMs?: number;
  backoffMs?: { initial: number; max: number };
  /** Test seam: the admission decision for a given live slot count. */
  decide?(activeSlots: number): AdmissionDecision;
  /** Test seam: the memory reading admission uses (defaults to `probeMemory`). */
  probe?(): MemoryReading;
  /** Test seam: the artifact invalidation a reclaim performs. */
  invalidate?(worktree: string): void;
  /** Test seam: the artifact directory the default invalidation moves aside. */
  artifactDir?: string;
  now?(): number;
}

interface SlotContext {
  root: string;
  token: string;
  start: string | null;
  startedAt: number;
  deadline: number;
  progressMs: number;
  backoff: { initial: number; max: number };
  now(): number;
  decide(activeSlots: number): AdmissionDecision;
  invalidate(worktree: string): void;
}

/**
 * `m:ss` for a progress line.
 *
 * @public Used by the build's progress line and exercised by the unit tests.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * `12.4s` — the admission wait, which can exceed a minute and must stay one
 * number the build's log and the bench can both quote.
 *
 * @public Used by the build's admitted line and its guard, and exercised by the
 * unit tests.
 */
export function formatAdmissionWait(ms: number): string {
  return `${Math.max(0, ms / 1000).toFixed(1)}s`;
}

/** `build: <state>, 0:42 elapsed, 29:18 left` — the 30-second progress contract. */
function progressLine(context: SlotContext, state: string): string {
  const elapsed = formatDuration(context.now() - context.startedAt);
  const left = formatDuration(Math.max(0, context.deadline - context.now()));
  return `build: ${state}, ${elapsed} elapsed, ${left} left`;
}

/** 50–100 % of the current delay, so waiters do not retry in lockstep. */
function jitter(delayMs: number): number {
  return Math.round(delayMs * (0.5 + Math.random() * 0.5));
}

/**
 * The per-worktree mutex name: a short hash of the canonical checkout root, so
 * one registry can hold every worktree's mutex side by side.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function worktreeKey(root: string = REPO_ROOT): string {
  return createHash('sha256').update(canon(root)).digest('hex').slice(0, 16);
}

/**
 * The reclaim's artifact invalidation, for **this** checkout only.
 *
 * Another worktree's `.next` and `.dev/` are outside this process's ownership:
 * its group was killed before the slot was freed, so nothing is writing there,
 * and its own next build invalidates the artifact through its fingerprint and
 * handover. Writing into a foreign checkout from here would be worse than the
 * stale artifact — so a foreign worktree returns without touching anything, and
 * its artifact stays `unrecorded`/`stale` until that checkout's own next build
 * replaces it.
 *
 * @public Exercised by the unit tests, which pass a temporary artifact directory.
 */
export function invalidateWorktree(
  worktree: string,
  artifactDir: string = buildArtifactDir(),
): void {
  if (!worktree || canon(worktree) !== REPO_ROOT) return;
  const moved = invalidateBuildArtifact({ artifactDir });
  writeStderrLine(
    moved === null
      ? 'build: invalidated the reclaimed build (it left no artifact)'
      : `build: moved the artifact left by the reclaimed build aside to ${relative(REPO_ROOT, moved)}`,
  );
}

function recordGate(root: string, reading: MemoryReading, minFree: number, reserve: number): void {
  const cap =
    reading.capacityBytes === null
      ? 1
      : Math.max(1, slotCap(reading.capacityBytes, reserve, minFree));
  atomicWriteFile(join(root, 'capacity'), `${cap}\n`);
  atomicWriteFile(
    join(root, 'memory.json'),
    `${JSON.stringify(
      {
        degraded: reading.detail !== null,
        detail: reading.detail,
        hostFallback: reading.hostFallback,
        disabled: minFree <= 0,
        cap,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * The one-time admission lines. They are printed once per invocation rather
 * than once per backoff tick: a 30-minute wait would otherwise repeat the same
 * sentence hundreds of times.
 */
function announceGate(reading: MemoryReading, minFree: number): void {
  if (minFree <= 0) {
    writeStderrLine('build: memory gate disabled by STUDIQ_BUILD_MIN_FREE_MB=0');
    return;
  }
  if (reading.detail !== null) {
    writeStderrLine(`warning: build: ${reading.detail}; concurrent builds are capped at 1`);
    return;
  }
  if (reading.hostFallback) writeStderrLine('build: no cgroup limit; using host MemAvailable');
}

/**
 * The `always-one` warning: one build is admitted although a test failed.
 *
 * `always-one` is the reason for the admission, not the reason for the failure,
 * so the failed test — and the numbers that test used — come from the decision's
 * `failed` field. Assuming the free test here reports `free 14.0 GB < MIN_FREE
 * 4.5 GB` when the capacity test is what failed.
 */
function alwaysOneWarning(
  failed: AdmissionFailure,
  numbers: {
    activeSlots: number;
    capacityBytes: number;
    freeBytes: number;
    reserve: number;
    minFree: number;
  },
): string {
  const head = 'warning: build: admitting one build under memory pressure';
  if (failed === 'free') {
    return (
      `${head} (free ${formatGb(numbers.freeBytes)} < MIN_FREE ${formatGb(numbers.minFree)}, ` +
      `stack reserve ${formatGb(numbers.reserve)})`
    );
  }
  const slots = numbers.activeSlots + 1;
  const reserved = slots * SLOT_RSS_BYTES + numbers.reserve;
  return (
    `${head} (capacity ${formatGb(numbers.capacityBytes)} − (${slots} × ` +
    `${formatGb(SLOT_RSS_BYTES)} + reserve ${formatGb(numbers.reserve)}) = ` +
    `${formatGb(numbers.capacityBytes - reserved)} < MIN_FREE ${formatGb(numbers.minFree)})`
  );
}

function firstFreeSlot(root: string, cap: number): number | null {
  for (let slot = 1; slot <= cap; slot += 1) {
    if (!existsSync(join(root, String(slot)))) return slot;
  }
  return null;
}

function takeSlot(context: SlotContext, slot: number): SlotRecord | null {
  const path = join(context.root, String(slot));
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  try {
    writeRecord(path, {
      pid: String(process.pid),
      start: context.start ?? '',
      pgid: '0',
      pgidStart: '',
      token: context.token,
      worktree: REPO_ROOT,
      startedAt: new Date(context.now()).toISOString(),
    });
    writeField(path, 'heartbeat', String(context.now()));
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
  return readSlotRecord(path, slot, context.now());
}

function handleFor(record: SlotRecord, context: SlotContext): BuildSlotHandle {
  const owned = (): boolean => readOwnerField(record.path, 'token') === record.token;
  return {
    number: record.slot,
    token: record.token,
    queuedMs: Math.max(0, context.now() - context.startedAt),
    setProcessGroup(pgid: number) {
      if (!owned()) return;
      writeField(record.path, 'pgid', String(pgid));
      writeField(record.path, 'pgidStart', processStartTime(pgid) ?? '');
    },
    heartbeat() {
      if (owned()) writeField(record.path, 'heartbeat', String(context.now()));
    },
  };
}

/**
 * Whether the recorded process group is still the one this slot spawned.
 *
 * A pgid is a pid, and a pid can be recycled: signalling an unverified group
 * would SIGTERM whatever now owns that number. Two outcomes are ours:
 *
 * - the leader is alive with the recorded start time (the normal case);
 * - the leader is gone (no start time to read) — the kernel keeps a group's id
 *   allocated while the group exists, so a surviving group under that id is the
 *   orphan this slot left behind, not a recycled number.
 *
 * A leader that is alive with a *different* start time is a recycled pid, and a
 * slot that recorded no start time cannot be verified at all.
 */
function groupIdentityHolds(record: SlotRecord): boolean {
  if (record.pgidStart === null) return false;
  const current = processStartTime(record.pgid);
  return current === null || current === record.pgidStart;
}

/** Stops the group of a stale slot. If it cannot, the error names the slot. */
async function stopRecordedGroup(record: SlotRecord): Promise<void> {
  try {
    await killProcessGroup(record.pgid);
  } catch (error) {
    if (!(error instanceof UnconfirmedGroupError)) throw error;
    throw new UnconfirmedGroupError(record.pgid, record);
  }
}

async function reclaimSlot(record: SlotRecord, context: SlotContext): Promise<void> {
  const launcherDead =
    !pidAlive(record.pid) || (record.start !== null && startDiffers(record.pid, record.start));
  // Kill the surviving group first: a new build is never admitted over an
  // orphan still writing `.next`. The group is only signalled while its recorded
  // identity holds, so a recycled pgid cannot hit an unrelated group.
  if (record.pgid > 1) {
    if (groupIdentityHolds(record)) await stopRecordedGroup(record);
    else
      writeStderrLine(
        `warning: build: not signalling process group ${record.pgid} of stale slot ${record.slot}; its recorded identity no longer matches`,
      );
  }
  if (launcherDead) context.invalidate(record.worktree);
  const observed = dirLockIdentity(record.path);
  if (observed) {
    takeoverStaleDirLock(record.path, observed, {
      pid: record.pid,
      token: record.token,
      start: record.start,
    });
  }
  writeStderrLine(
    `build: reclaimed stale slot ${record.slot} (pid ${record.pid}${record.worktree ? `, ${record.worktree}` : ''})`,
  );
}

/**
 * Drop waiter directories whose owner is gone, by the slot liveness rule. A
 * waiter that was killed (or whose shell died) would otherwise inflate the
 * count `env status` prints for the rest of the machine's uptime.
 */
function reclaimStaleWaiters(context: SlotContext): void {
  for (const name of readdirOrNull(join(context.root, 'waiters')) ?? []) {
    const path = join(context.root, 'waiters', name);
    const observed = dirLockIdentity(path);
    if (!observed) continue;
    const pid = Number(readOwnerField(path, 'pid') ?? '') || 0;
    const start = readOwnerField(path, 'start');
    const stale =
      pid <= 1
        ? context.now() - observed.mtimeMs > SLOT_NO_OWNER_GRACE_MS
        : !pidAlive(pid) || (start != null && start !== '' && startDiffers(pid, start));
    if (!stale) continue;
    takeoverStaleDirLock(path, observed, {
      pid,
      token: readOwnerField(path, 'token') ?? '',
      start,
    });
  }
}

async function liveSlots(context: SlotContext): Promise<SlotRecord[]> {
  const live: SlotRecord[] = [];
  for (const name of readdirOrNull(context.root) ?? []) {
    if (!/^\d+$/.test(name)) continue;
    const record = readSlotRecord(join(context.root, name), Number(name), context.now());
    if (slotState(record, { checkStart: true }) === 'stale') {
      await reclaimSlot(record, context);
      continue;
    }
    live.push(record);
  }
  return live;
}

function queuedFailure(context: SlotContext, active: SlotRecord[]): EnvFailure {
  const holders =
    active.length === 0
      ? 'no build slot was free'
      : active
          .map(
            (record) =>
              `slot ${record.slot} (pid ${record.pid}${record.worktree ? ` in ${record.worktree}` : ''})`,
          )
          .join(', ');
  return new EnvFailure(
    EXIT_QUEUED,
    `timed out after ${formatDuration(context.now() - context.startedAt)} waiting for a build slot (${holders})`,
  );
}

function holderSlotLabel(root: string, pid: number): string {
  const slot = slotNumberForPid(root, pid);
  return slot === null ? '' : `, slot ${slot}`;
}

function slotNumberForPid(root: string, pid: number): number | null {
  for (const name of readdirOrNull(root) ?? []) {
    if (!/^\d+$/.test(name)) continue;
    if ((Number(readOwnerField(join(root, name), 'pid') ?? '') || 0) === pid) return Number(name);
  }
  return null;
}

/**
 * A build holding this worktree's mutex, as the read-only signal every path that
 * touches `.next` or starts a server must consult.
 *
 * `checkout.lock` is deliberately free while a build runs, so the mutex is the
 * only fact that says "a build owns this `.next` right now": a plain build takes
 * it for its whole run, and the fingerprint describes the source tree, not the
 * artifact, so neither the lock nor the build record can answer this question.
 * The signal is read-only — no mutex is taken (a directory mutex is not
 * reentrant, and the caller may be about to run the build itself) and nothing is
 * reclaimed; reclamation belongs to the admission path.
 */
export interface BuildInProgress {
  /** The mutex holder's pid, or null while it has not named its owner yet. */
  pid: number | null;
  /** The holder's process start time: the half of an identity a pid cannot carry. */
  start: string | null;
  /** ISO timestamp the holder recorded when it took the mutex. */
  startedAt: string | null;
  /** The holder's build slot, when its slot record is still present. */
  slot: number | null;
}

/**
 * Whether a build holds this worktree's mutex, and which one.
 *
 * `null` means no build: the mutex is absent, or its recorded identity is dead
 * by the same rule the mutex itself uses (pid gone, or the pid's start time
 * differs). A mutex that has not named its owner yet is a build taking it, not a
 * free one, until the no-owner grace expires.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function buildInProgress(worktreeRoot: string = REPO_ROOT): BuildInProgress | null {
  const root = join(resolveRegistryDir(), SLOTS_DIR);
  const dir = join(root, 'worktrees', worktreeKey(worktreeRoot));
  const observed = dirLockIdentity(dir);
  if (!observed) return null;
  const pid = Number(readOwnerField(dir, 'pid') ?? '') || 0;
  if (pid <= 1) {
    return Date.now() - observed.mtimeMs > SLOT_NO_OWNER_GRACE_MS
      ? null
      : { pid: null, start: null, startedAt: null, slot: null };
  }
  const start = readOwnerField(dir, 'start') || null;
  if (!pidAlive(pid)) return null;
  if (start !== null && startDiffers(pid, start)) return null;
  return {
    pid,
    start,
    startedAt: readOwnerField(dir, 'startedAt'),
    slot: slotNumberForPid(root, pid),
  };
}

/**
 * The refusal for a live build in this worktree: one message for `env:serve`,
 * `env:ensure`'s start and the rebuild prelude, naming the build's pid, its
 * recorded start time and its slot.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function buildInProgressFailure(build: BuildInProgress): EnvFailure {
  const holder =
    build.pid === null
      ? "a build is taking this worktree's build mutex (no pid recorded yet)"
      : `a build (pid ${build.pid}${build.startedAt === null ? '' : `, started ${build.startedAt}`}${
          build.slot === null ? '' : `, slot ${build.slot}`
        })`;
  return new EnvFailure(
    EXIT_CONFLICT,
    `${holder} holds this worktree's build mutex and is writing apps/web/.next; retry once it finishes`,
  );
}

function mutexStale(holder: DirLockOwner, observed: DirLockIdentity, now: number): boolean {
  if (holder.pid <= 1) return now - observed.mtimeMs > SLOT_NO_OWNER_GRACE_MS;
  if (!pidAlive(holder.pid)) return true;
  return holder.start != null && holder.start !== '' && startDiffers(holder.pid, holder.start);
}

/**
 * The per-worktree mutex: one build per checkout, taken before the slot and
 * released after it. A second build in the same worktree waits here, inside the
 * same deadline, and names the holder's slot.
 */
async function acquireWorktreeMutex(context: SlotContext): Promise<Mutex> {
  const dir = join(context.root, 'worktrees', worktreeKey());
  let delay = context.backoff.initial;
  let lastProgress = context.now();
  for (;;) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      writeRecord(dir, {
        pid: String(process.pid),
        start: context.start ?? '',
        token: context.token,
        worktree: REPO_ROOT,
        startedAt: new Date(context.startedAt).toISOString(),
      });
      return { release: async () => releaseDirMutex(dir, context.token) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const observed = dirLockIdentity(dir);
      if (!observed) continue;
      const holder: DirLockOwner = {
        pid: Number(readOwnerField(dir, 'pid') ?? '') || 0,
        token: readOwnerField(dir, 'token') ?? '',
        start: readOwnerField(dir, 'start'),
      };
      if (mutexStale(holder, observed, context.now())) {
        takeoverStaleDirLock(dir, observed, holder);
        continue;
      }
      if (context.now() >= context.deadline) {
        throw new EnvFailure(
          EXIT_QUEUED,
          `timed out after ${formatDuration(context.now() - context.startedAt)} waiting for this worktree's build ` +
            `(holder pid ${holder.pid}${holderSlotLabel(context.root, holder.pid)})`,
        );
      }
      if (context.now() - lastProgress >= context.progressMs) {
        lastProgress = context.now();
        writeStderrLine(
          progressLine(
            context,
            `waiting for this worktree's build (holder pid ${holder.pid}${holderSlotLabel(context.root, holder.pid)})`,
          ),
        );
      }
      await sleep(jitter(delay));
      delay = Math.min(delay * 2, context.backoff.max);
    }
  }
}

async function acquireSlot(context: SlotContext): Promise<SlotRecord> {
  let delay = context.backoff.initial;
  let lastProgress = context.now();
  for (;;) {
    const active = await liveSlots(context);
    const decision = context.decide(active.length);
    if (decision.admit) {
      const free = firstFreeSlot(context.root, decision.cap);
      if (free !== null) {
        const held = takeSlot(context, free);
        if (held !== null) return held;
      }
    }
    if (context.now() >= context.deadline) throw queuedFailure(context, active);
    if (context.now() - lastProgress >= context.progressMs) {
      lastProgress = context.now();
      const waiting = readdirOrNull(join(context.root, 'waiters'))?.length ?? 0;
      writeStderrLine(
        progressLine(
          context,
          `waiting for a slot (${active.length} of ${decision.cap} busy, ${waiting} waiting)`,
        ),
      );
    }
    await sleep(jitter(delay));
    delay = Math.min(delay * 2, context.backoff.max);
  }
}

/**
 * Run `fn` while holding a global build slot and this worktree's mutex.
 *
 * One invocation owns one slot: the memory-derived cap is a machine-wide total,
 * and the per-worktree mutex makes two builds in the same checkout impossible
 * rather than merely unlikely. The wait is bounded by `waitMs` (30 minutes), and
 * expiry is `EXIT_QUEUED` naming the holders. Admission lives here rather than in
 * `commands/build.ts` so every caller of `runProductionBuild` — `env build` and
 * `env ensure`'s rebuild — goes through it.
 */
export async function withBuildSlots<T>(
  fn: (slot: BuildSlotHandle) => Promise<T>,
  options: BuildSlotsOptions = {},
): Promise<T> {
  const root = ensureSlotsRoot();
  const now = options.now ?? Date.now;
  const startedAt = now();
  const minFree = minFreeBytes();
  const probe = options.probe ?? probeMemory;
  const reading = probe();
  recordGate(root, reading, minFree, stackReserveBytes(readStackReserve()));
  announceGate(reading, minFree);

  const token = randomBytes(12).toString('hex');
  const start = processStartTime(process.pid);
  const context: SlotContext = {
    root,
    token,
    start,
    startedAt,
    deadline: startedAt + (options.waitMs ?? SLOT_WAIT_MS),
    progressMs: options.progressMs ?? SLOT_PROGRESS_MS,
    backoff: options.backoffMs ?? {
      initial: SLOT_BACKOFF_INITIAL_MS,
      max: SLOT_BACKOFF_MAX_MS,
    },
    now,
    decide:
      options.decide ??
      ((active) => {
        const tick = probe();
        const reserve = stackReserveBytes(readStackReserve());
        const decision = decideAdmission({
          activeSlots: active,
          capacityBytes: tick.capacityBytes,
          freeBytes: tick.freeBytes,
          stackReserveBytes: reserve,
          minFreeBytes: minFree,
        });
        // `always-one` is only reachable with both readings present (a failed
        // probe degrades first), so the null checks are what TypeScript needs to
        // say that; the warning names the test the decision says failed.
        if (
          decision.reason === 'always-one' &&
          decision.failed !== null &&
          tick.capacityBytes !== null &&
          tick.freeBytes !== null
        ) {
          writeStderrLine(
            alwaysOneWarning(decision.failed, {
              activeSlots: active,
              capacityBytes: tick.capacityBytes,
              freeBytes: tick.freeBytes,
              reserve,
              minFree,
            }),
          );
        }
        return decision;
      }),
    invalidate:
      options.invalidate ??
      ((worktree) =>
        options.artifactDir === undefined
          ? invalidateWorktree(worktree)
          : invalidateWorktree(worktree, options.artifactDir)),
  };

  reclaimStaleWaiters(context);
  const waiter = join(root, 'waiters', `${process.pid}-${token}`);
  mkdirSync(waiter, { mode: 0o700 });
  writeRecord(waiter, {
    pid: String(process.pid),
    start: start ?? '',
    token,
    worktree: REPO_ROOT,
    since: new Date(startedAt).toISOString(),
  });

  // The waiter is registered before either wait and removed in `finally`, so an
  // abandoned wait (mutex or slot) never leaves a phantom waiter behind.
  let mutex: Mutex | null = null;
  try {
    mutex = await acquireWorktreeMutex(context);
    const held = await acquireSlot(context);
    // Admitted: the slot record replaces the waiter, so status stops counting it.
    rmSync(waiter, { recursive: true, force: true });
    let keepSlot = false;
    try {
      return await fn(handleFor(held, context));
    } catch (error) {
      keepSlot = error instanceof UnconfirmedGroupError;
      throw error;
    } finally {
      // A kept slot becomes stale when this process ends, and the next admission
      // reclaims it (`reclaimSlot`). That tries to stop the group first, but only
      // while the recorded identity of the group still matches.
      if (keepSlot) {
        writeStderrLine(`build: build slot ${held.slot} stays in use: ${held.path}`);
      } else {
        releaseDirMutex(held.path, held.token);
      }
    }
  } finally {
    rmSync(waiter, { recursive: true, force: true });
    await mutex?.release();
  }
}

/** A snapshot publish waits this long for its lock, then skips (decision 3). */
const SNAPSHOT_LOCK_WAIT_SECONDS = 5;

/**
 * Serialize snapshot publication only (`snapshot.lock`).
 *
 * Entered after the checkout lock, the build slot and this worktree's mutex are
 * released — never while any of them is held — because publication reads and
 * swaps directories the next build's stage step writes. The wait is short and a
 * timeout is non-fatal: the previous snapshot stays current and the build has
 * already succeeded. `null` reports the skip to the caller.
 *
 * @public Exercised by the unit tests through `env build`'s snapshot reporting.
 */
export async function withSnapshotLock<T>(fn: () => Promise<T> | T): Promise<T | null> {
  try {
    const dir = ensureRegistrySubdir('locks');
    return await withLockAt(
      join(dir, 'snapshot.lock'),
      SNAPSHOT_LOCK_WAIT_SECONDS,
      EXIT_TIMEOUT,
      'timed out waiting for the snapshot lock',
      fn,
    );
  } catch (error) {
    if (!(error instanceof EnvFailure)) throw error;
    writeStderrLine(`warning: build: snapshot skipped: ${error.message}`);
    return null;
  }
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
