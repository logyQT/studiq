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
import { join } from 'node:path';
import {
  decideAdmission,
  formatGb,
  minFreeBytes,
  probeMemory,
  readStackReserve,
  slotCap,
  stackReserveBytes,
  type AdmissionDecision,
  type MemoryReading,
} from './admission';
import { EXIT_CONFLICT, EXIT_QUEUED, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from './exit';
import type { BuildSlotsStatus } from './json';
import { writeStderrLine } from './output';
import { resolveRegistryDir } from './registry';
import { REPO_ROOT, canon } from './repo';
import { DEV_DIR, ensureDevDir, removeBuildState } from './state';

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
 * SIGTERM the group, wait out the grace, then SIGKILL.
 *
 * `false` means there was no group to signal. Callers release a slot only after
 * this returns, so a new build is never admitted over an orphan still writing
 * `.next`.
 */
export async function killProcessGroup(pgid: number, graceMs = KILL_GRACE_MS): Promise<boolean> {
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!groupAlive(pgid)) return true;
    await sleep(100);
  }
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    /* the group exited between the check and the kill */
  }
  return true;
}

export interface SlotRecord {
  slot: number;
  path: string;
  pid: number;
  start: string | null;
  pgid: number;
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

function writeAtomic(path: string, contents: string): void {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
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
 * the recorded cap, and pid liveness. Read-only and cheap — no `du`, no child
 * process, and the cap is never recomputed from memory here.
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
    if (slotState(record, { checkStart: false }) === 'stale') stale += 1;
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
 * `2/3 busy, 1 stale, 1 waiting` — and `unknown` for anything unreadable, never
 * `0`. Shared by `env status`, `env doctor` and the build's progress line so the
 * three cannot disagree about what the slot directory says.
 */
export function formatBuildSlots(status: BuildSlotsStatus | null): string {
  if (status === null || status.busy === null) return 'unknown';
  const cap = status.cap === null ? 'unknown' : String(status.cap);
  const parts = [`${status.busy}/${cap} busy`];
  if (status.stale) parts.push(`${status.stale} stale`);
  if (status.waiting) parts.push(`${status.waiting} waiting`);
  const degraded = status.degraded ? ' (memory gate degraded)' : '';
  return `${parts.join(', ')}${degraded}`;
}

export interface BuildSlotHandle {
  readonly number: number;
  readonly token: string;
  /** Record the spawned build's process group so a reclaim can kill it. */
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
  /** Test seam: the artifact invalidation a reclaim performs. */
  invalidate?(worktree: string): void;
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

function worktreeKey(): string {
  return createHash('sha256').update(canon(REPO_ROOT)).digest('hex').slice(0, 16);
}

/**
 * The reclaim's artifact invalidation, for **this** checkout only.
 *
 * Another worktree's `.next` and `.dev/` are outside this process's ownership:
 * its group was killed before the slot was freed, so nothing is writing there,
 * and its own next build invalidates the artifact through its fingerprint and
 * handover. Writing into a foreign checkout from here would be worse than the
 * stale artifact.
 */
function invalidateWorktree(worktree: string): void {
  if (!worktree || canon(worktree) !== REPO_ROOT) return;
  rmSync(join(REPO_ROOT, 'apps', 'web', '.next'), { recursive: true, force: true });
  removeBuildState();
  writeStderrLine('build: invalidated apps/web/.next left by the reclaimed build');
}

function recordGate(root: string, reading: MemoryReading, minFree: number, reserve: number): void {
  const cap =
    reading.capacityBytes === null
      ? 1
      : Math.max(1, slotCap(reading.capacityBytes, reserve, minFree));
  writeAtomic(join(root, 'capacity'), `${cap}\n`);
  writeAtomic(
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
    setProcessGroup(pgid: number) {
      if (owned()) writeField(record.path, 'pgid', String(pgid));
    },
    heartbeat() {
      if (owned()) writeField(record.path, 'heartbeat', String(context.now()));
    },
  };
}

async function reclaimSlot(record: SlotRecord, context: SlotContext): Promise<void> {
  const launcherDead =
    !pidAlive(record.pid) || (record.start !== null && startDiffers(record.pid, record.start));
  // Kill the surviving group first: a new build is never admitted over an
  // orphan still writing `.next`.
  if (record.pgid > 1) await killProcessGroup(record.pgid);
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
  for (const name of readdirOrNull(root) ?? []) {
    if (!/^\d+$/.test(name)) continue;
    const path = join(root, name);
    if ((Number(readOwnerField(path, 'pid') ?? '') || 0) === pid) return `, slot ${name}`;
  }
  return '';
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
          `waiting for a slot (${active.length}/${decision.cap} busy, ${waiting} waiting)`,
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
  const reading = probeMemory();
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
        const tick = probeMemory();
        const reserve = stackReserveBytes(readStackReserve());
        const decision = decideAdmission({
          activeSlots: active,
          capacityBytes: tick.capacityBytes,
          freeBytes: tick.freeBytes,
          stackReserveBytes: reserve,
          minFreeBytes: minFree,
        });
        if (decision.reason === 'always-one') {
          writeStderrLine(
            `warning: build: admitting one build under memory pressure (free ${formatGb(tick.freeBytes ?? 0)} ` +
              `< MIN_FREE ${formatGb(minFree)}, stack reserve ${formatGb(reserve)})`,
          );
        }
        return decision;
      }),
    invalidate: options.invalidate ?? invalidateWorktree,
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
    try {
      return await fn(handleFor(held, context));
    } finally {
      releaseDirMutex(held.path, held.token);
    }
  } finally {
    rmSync(waiter, { recursive: true, force: true });
    await mutex?.release();
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
