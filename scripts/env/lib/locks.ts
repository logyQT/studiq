import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { join } from 'node:path';
import { EXIT_CONFLICT, EXIT_TIMEOUT, EXIT_USAGE, EnvFailure } from './exit';
import { appendEnvLog, ensureDevDir } from './state';
import { resolveRegistryDir } from './registry';
import { REPO_ROOT } from './repo';

/**
 * Cross-checkout locks.
 *
 * The registry directory must be a private, real directory owned by the current
 * user (mode 700); anything else is refused rather than followed. The **start
 * lock** is per stack identity and separate from the build lock and the app
 * port lease; it can be taken over immediately when the holder pid is dead.
 * The **build lock** is the same `flock`/`mkdir` lock `scripts/dev` uses, so
 * only one `next build` runs across all worktrees.
 */

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Only ESRCH proves the pid is gone. EPERM (or any other error) means the
    // process may still exist under another user; never reclaim a live claim.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validate/create the registry directory and return it. */
export function ensureRegistryDir(): string {
  const dir = resolveRegistryDir();
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new EnvFailure(EXIT_CONFLICT, `registry path ${dir} is a symlink; refusing to use it`);
  }
  if (existsSync(dir) && !lstatSync(dir).isDirectory()) {
    throw new EnvFailure(EXIT_CONFLICT, `registry path ${dir} exists and is not a directory`);
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const uid = process.getuid?.();
  if (uid !== undefined && lstatSync(dir).uid !== uid) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `registry directory ${dir} is not owned by the current user; refusing to write to it`,
    );
  }
  chmodSync(dir, 0o700);
  return dir;
}

/**
 * Create a lock file with its full content atomically.
 *
 * `writeFileSync(..., { flag: 'wx' })` publishes an empty file before the
 * content is written; a waiter can read that window as "unparseable", reap the
 * live lock and start a second holder. Writing a temp file and hard-linking it
 * makes EEXIST and content publication one atomic step. The temp file is never
 * a valid lock path, so readers never see it.
 */
function createLockFileAtomic(file: string, content: string): void {
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
  try {
    linkSync(temp, file);
    chmodSync(file, 0o600);
  } finally {
    rmSync(temp, { force: true });
  }
}

interface LockContent {
  pid: number;
  token: string;
  projectRoot: string;
  branch: string;
  stackName: string;
  acquiredAt: string;
  heartbeatAt: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type JsonRead =
  | { kind: 'ok'; value: unknown }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' };

/**
 * Read a JSON lock without treating an I/O failure as "absent":
 * EACCES/EIO/symlink are `unreadable` and must keep waiters waiting; only a
 * successful read with malformed content may be reclaimed.
 */
function readJsonFile(file: string): JsonRead {
  let raw: string;
  try {
    if (lstatSync(file).isSymbolicLink()) return { kind: 'unreadable' };
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'absent' }
      : { kind: 'unreadable' };
  }
  try {
    return { kind: 'ok', value: JSON.parse(raw) as unknown };
  } catch {
    return { kind: 'malformed' };
  }
}

type LockRead =
  | { kind: Exclude<JsonRead['kind'], 'ok'>; lock: null }
  | {
      kind: 'ok';
      lock: LockContent;
    };

function readLock(file: string): LockRead {
  const read = readJsonFile(file);
  if (read.kind !== 'ok') return { kind: read.kind, lock: null };
  const parsed = read.value;
  if (!isObject(parsed) || typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') {
    return { kind: 'malformed', lock: null };
  }
  return {
    kind: 'ok',
    lock: {
      pid: parsed.pid,
      token: parsed.token,
      projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : '',
      branch: typeof parsed.branch === 'string' ? parsed.branch : '',
      stackName: typeof parsed.stackName === 'string' ? parsed.stackName : '',
      acquiredAt: typeof parsed.acquiredAt === 'string' ? parsed.acquiredAt : '',
      heartbeatAt: typeof parsed.heartbeatAt === 'string' ? parsed.heartbeatAt : '',
    },
  };
}

function writeLock(file: string, content: LockContent): void {
  const temp = `${file}.${content.token}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(content)}\n`, { mode: 0o600, flag: 'wx' });
    // `rename` is atomic; an existing lock is never truncated in place.
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(file, 0o600);
}

interface MutexHandle {
  release(): Promise<void>;
}

function hasFlock(): boolean {
  const result = spawnSync('flock', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  return result.status === 0;
}

/**
 * Kernel mutex for the start lock's check-and-takeover critical section.
 *
 * A `flock` child holds the lock and waits on stdin; we signal it to release.
 * That keeps the lock held across the JavaScript critical section, which a
 * plain file+rename cannot do (two waiters could both replace a dead holder).
 */
async function acquireKernelMutex(path: string, waitSeconds: number): Promise<MutexHandle | null> {
  if (!hasFlock()) return null;
  return new Promise<MutexHandle>((resolvePromise, reject) => {
    const child = spawn(
      'flock',
      ['-w', String(waitSeconds), path, 'sh', '-c', 'printf ready; IFS= read -r _'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let settled = false;
    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(
          new EnvFailure(
            EXIT_TIMEOUT,
            `timed out after ${waitSeconds}s waiting for the start-lock mutex (${path})`,
          ),
        );
      },
      (waitSeconds + 5) * 1000,
    );
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (!stdout.includes('ready') || settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        async release() {
          try {
            child.stdin?.write('\n');
          } catch {
            /* child already gone */
          }
          await new Promise<void>((done) => {
            if (child.exitCode !== null || child.signalCode !== null) return done();
            child.once('close', () => done());
          });
        },
      });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new EnvFailure(
          EXIT_CONFLICT,
          `cannot run the start-lock mutex: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new EnvFailure(
          EXIT_TIMEOUT,
          `timed out after ${waitSeconds}s waiting for the start-lock mutex (${path})`,
        ),
      );
    });
  });
}

type StatIdentity = Stats;

function sameEntry(left: StatIdentity, right: StatIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs;
}

/** Portable fallback when `flock` is unavailable: atomic `mkdir` + owner pid. */
async function acquireDirMutex(path: string, waitSeconds: number): Promise<MutexHandle> {
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
      let observed: StatIdentity | null = null;
      try {
        observed = lstatSync(path);
      } catch {
        continue;
      }
      let owner = 0;
      try {
        owner = Number(readFileSync(join(path, 'pid'), 'utf8').trim());
      } catch {
        /* owner unknown */
      }
      if (owner && !pidAlive(owner)) {
        // Re-check identity so a reclaimer cannot delete a fresh lock created
        // by another waiter after our first stat.
        try {
          const current = lstatSync(path);
          if (sameEntry(observed, current)) rmSync(path, { recursive: true, force: true });
        } catch {
          /* vanished */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new EnvFailure(
          EXIT_TIMEOUT,
          `timed out after ${waitSeconds}s waiting for the start-lock mutex (${path})`,
        );
      }
      await sleep(50);
    }
  }
}

async function acquireStartMutex(path: string, waitSeconds: number): Promise<MutexHandle> {
  return (await acquireKernelMutex(path, waitSeconds)) ?? acquireDirMutex(path, waitSeconds);
}

/**
 * Short registry-wide mutex around "read leases + probe port + write lease".
 * The lease lock is deliberately separate from the start lock: it is held only
 * for the port decision, not for the whole start.
 */
export async function withRegistryLeaseLock<T>(fn: () => Promise<T>): Promise<T> {
  const dir = join(ensureRegistryDir(), 'locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'lease.lock');
  const mutexPath = join(dir, 'lease.mutex');
  const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    // Serialize create/reclaim so two waiters cannot both delete a dead owner
    // and publish different leases.
    const mutex = await acquireStartMutex(mutexPath, 30);
    let acquired = false;
    let wait = false;
    try {
      try {
        createLockFileAtomic(
          file,
          `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`,
        );
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new EnvFailure(
            EXIT_CONFLICT,
            `cannot create the lease lock ${file}: ${(error as Error).message}`,
          );
        }
        const read = readJsonFile(file);
        if (read.kind === 'absent') {
          wait = true;
        } else if (read.kind === 'unreadable') {
          // Never reclaim a lock we could not read; wait for it to clear.
          wait = true;
        } else if (read.kind === 'malformed') {
          try {
            const age = Date.now() - statSync(file).mtimeMs;
            if (age > 5_000) rmSync(file, { force: true });
          } catch {
            /* vanished */
          }
          wait = true;
        } else {
          const parsed = read.value;
          const owner = isObject(parsed) && typeof parsed.pid === 'number' ? parsed.pid : 0;
          const observedToken =
            isObject(parsed) && typeof parsed.token === 'string' ? parsed.token : '';
          if (!owner || !pidAlive(owner)) {
            const current = readJsonFile(file);
            if (
              current.kind === 'ok' &&
              isObject(current.value) &&
              current.value.token === observedToken
            ) {
              rmSync(file, { force: true });
            }
          }
          wait = true;
        }
      }
    } finally {
      await mutex.release();
    }
    if (acquired) break;
    if (wait) {
      if (Date.now() >= deadline) {
        throw new EnvFailure(
          EXIT_TIMEOUT,
          `timed out after 60s waiting for the registry lease lock (${file})`,
        );
      }
      await sleep(50);
      continue;
    }
  }

  try {
    return await fn();
  } finally {
    const current = readJsonFile(file);
    if (current.kind === 'ok' && isObject(current.value) && current.value.token === token) {
      rmSync(file, { force: true });
    }
  }
}

/**
 * Checkout-wide claim for the single web server. Different stack identities
 * have different per-identity start locks, so this short lock is what stops two
 * concurrent `ensure` runs from both passing the "no server yet" check and
 * starting a server. It covers detection + start only (never the build).
 */
export async function withCheckoutWebLock<T>(fn: () => Promise<T>): Promise<T> {
  const dir = join(ensureRegistryDir(), 'locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'web-server.lock');
  const mutexPath = join(dir, 'web-server.mutex');
  const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + 30_000;

  for (;;) {
    const mutex = await acquireStartMutex(mutexPath, 30);
    let acquired = false;
    let wait = false;
    try {
      try {
        createLockFileAtomic(
          file,
          `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`,
        );
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new EnvFailure(
            EXIT_CONFLICT,
            `cannot create the web-server claim lock ${file}: ${(error as Error).message}`,
          );
        }
        const read = readJsonFile(file);
        if (read.kind === 'absent' || read.kind === 'unreadable') {
          wait = true;
        } else if (read.kind === 'malformed') {
          try {
            const age = Date.now() - statSync(file).mtimeMs;
            if (age > 5_000) rmSync(file, { force: true });
          } catch {
            /* vanished */
          }
          wait = true;
        } else {
          const owner =
            isObject(read.value) && typeof read.value.pid === 'number' ? read.value.pid : 0;
          const observedToken =
            isObject(read.value) && typeof read.value.token === 'string' ? read.value.token : '';
          if (!owner || !pidAlive(owner)) {
            const current = readJsonFile(file);
            if (
              current.kind === 'ok' &&
              isObject(current.value) &&
              current.value.token === observedToken
            ) {
              rmSync(file, { force: true });
            }
          }
          wait = true;
        }
      }
    } finally {
      await mutex.release();
    }
    if (acquired) break;
    if (wait) {
      if (Date.now() >= deadline) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          'timed out after 30s waiting for another process in this checkout to claim the web server; run env:status to inspect it',
        );
      }
      await sleep(50);
      continue;
    }
  }

  try {
    return await fn();
  } finally {
    const current = readJsonFile(file);
    if (current.kind === 'ok' && isObject(current.value) && current.value.token === token) {
      rmSync(file, { force: true });
    }
  }
}

export interface StartLock {
  file: string;
  release(): void;
}

export interface StartLockOptions {
  key: string;
  projectRoot: string;
  branch: string;
  stackName: string;
  waitSeconds: number;
  /** Called on every heartbeat so the app-port lease ages with the start. */
  onHeartbeat?: () => void;
}

/**
 * Acquire the per-identity start lock. A dead holder is replaced immediately;
 * a live holder is waited for up to `waitSeconds` (exit 5 on timeout). The lock
 * holder writes `pid` plus a heartbeat every 2 s.
 */
export async function acquireStartLock(options: StartLockOptions): Promise<StartLock> {
  const dir = join(ensureRegistryDir(), 'locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, `start-${options.key}.lock`);
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new EnvFailure(EXIT_CONFLICT, `start lock ${file} is a symlink; refusing to use it`);
  }

  const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + options.waitSeconds * 1000;
  const mutexPath = `${file}.mutex`;
  let announced = false;

  for (;;) {
    const now = new Date().toISOString();
    const content: LockContent = {
      pid: process.pid,
      token,
      projectRoot: options.projectRoot,
      branch: options.branch,
      stackName: options.stackName,
      acquiredAt: now,
      heartbeatAt: now,
    };

    // Serialize read-check-replace so two waiters cannot both take over a
    // dead holder. The kernel/dir mutex is held only for this critical section.
    const mutex = await acquireStartMutex(mutexPath, Math.min(options.waitSeconds, 30));
    let acquired = false;
    try {
      const current = readLock(file);
      const holder = current.lock;
      const reclaim =
        current.kind === 'absent' ||
        current.kind === 'malformed' ||
        (current.kind === 'ok' && holder !== null && !pidAlive(holder.pid));
      if (reclaim) {
        if (current.kind !== 'absent') rmSync(file, { force: true });
        try {
          createLockFileAtomic(file, `${JSON.stringify(content)}\n`);
          acquired = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw new EnvFailure(
              EXIT_CONFLICT,
              `cannot create start lock ${file}: ${(error as Error).message}`,
            );
          }
        }
      }
    } finally {
      await mutex.release();
    }

    if (acquired) break;
    if (Date.now() >= deadline) {
      const holder = readLock(file).lock;
      throw new EnvFailure(
        EXIT_TIMEOUT,
        `timed out after ${options.waitSeconds}s waiting for the start lock${holder ? ` (pid ${holder.pid})` : ''}`,
      );
    }
    if (!announced) {
      announced = true;
      const holder = readLock(file).lock;
      if (holder) {
        appendEnvLog(
          `ensure: waiting for start lock held by pid ${holder.pid} (stack ${options.stackName})`,
        );
      }
    }
    await sleep(100);
  }

  appendEnvLog(`ensure: start lock acquired (stack ${options.stackName}, pid ${process.pid})`);
  const heartbeat = setInterval(() => {
    const now = new Date().toISOString();
    try {
      const current = readLock(file);
      if (current.kind !== 'ok' || current.lock.token !== token) return;
      writeLock(file, {
        pid: process.pid,
        token,
        projectRoot: options.projectRoot,
        branch: options.branch,
        stackName: options.stackName,
        acquiredAt: current.lock.acquiredAt || now,
        heartbeatAt: now,
      });
      options.onHeartbeat?.();
    } catch {
      /* a failed heartbeat must never crash the command */
    }
  }, 2_000);
  // A heartbeat must not keep the process alive after the command finishes.
  heartbeat.unref?.();

  let released = false;
  return {
    file,
    release() {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      const current = readLock(file);
      if (current.kind === 'ok' && current.lock.token === token) rmSync(file, { force: true });
      appendEnvLog(`ensure: start lock released (stack ${options.stackName})`);
    },
  };
}

export interface BuildRunResult {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  output: string;
  /** Unique backup of the pre-build `.next`, if one existed. */
  backupPath: string;
}

export interface BuildRunOptions {
  waitSeconds?: number;
  env: NodeJS.ProcessEnv;
}

/** The same heap cap `scripts/dev` uses (`DEV_BUILD_MEMORY_MB`, default 4096). */
function buildEnvWithHeap(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const raw = process.env.DEV_BUILD_MEMORY_MB ?? '4096';
  const memory = Number(raw);
  if (!Number.isInteger(memory) || memory <= 0) {
    throw new EnvFailure(
      EXIT_USAGE,
      `DEV_BUILD_MEMORY_MB='${raw}' is not a positive number of megabytes`,
    );
  }
  const inherited = process.env['NODE_OPTIONS'];
  const nodeOptions = inherited
    ? `${inherited} --max-old-space-size=${memory}`
    : `--max-old-space-size=${memory}`;
  return { ...env, NODE_OPTIONS: nodeOptions };
}

/**
 * Run `next build` under the cross-worktree lock.
 *
 * `flock` is preferred because it is the same lock `scripts/dev` holds; the
 * fallback is the atomic `mkdir` + pid lock (also `scripts/dev`'s fallback).
 * The lock covers the build only, never the whole `ensure`.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function runBuildUnderLock(options: BuildRunOptions): BuildRunResult {
  const dir = ensureRegistryDir();
  const lock = join(dir, 'build.lock');
  const waitSeconds = options.waitSeconds ?? 1800;
  const buildEnv = buildEnvWithHeap(options.env);
  ensureDevDir();

  // `next build` empties `.next` before compiling, so a failed build would
  // otherwise leave the checkout with a broken/partial build. Move the old
  // output aside first; the shell restores it on failure. On success the
  // caller keeps/discards the backup after the fingerprint is verified.
  // Keep the backup beside `apps/web/.next` so the move is a same-filesystem
  // rename and does not depend on the volatile `.dev/` location.
  const backupPath = join(
    REPO_ROOT,
    'apps',
    'web',
    `.next-build-backup-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  const buildCommand = `${shellQuote(process.execPath)} run --filter @studiq/web build`;
  const backup = shellQuote(backupPath);
  const script = [
    `rm -rf ${backup}`,
    'if [ -d apps/web/.next ]; then',
    `  if ! mv apps/web/.next ${backup}; then exit 1; fi`,
    'fi',
    buildCommand,
    'status=$?',
    'if [ "$status" -ne 0 ]; then',
    '  rm -rf apps/web/.next',
    `  if [ -d ${backup} ]; then mv ${backup} apps/web/.next; fi`,
    '  exit "$status"',
    'fi',
    'exit 0',
  ].join('\n');
  const command = ['sh', '-c', script];

  // The build lock is a kernel flock on an empty file (its content is never
  // read) or an atomic mkdir with a diagnostic pid; neither has the
  // partial-content window the JSON lock files had.
  if (hasFlock()) {
    const result = spawnSync('flock', ['-E', '75', '-w', String(waitSeconds), lock, ...command], {
      cwd: REPO_ROOT,
      env: buildEnv,
      encoding: 'utf8',
      timeout: (waitSeconds + 120) * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status === 75) {
      return { ok: false, timedOut: true, exitCode: 75, output, backupPath };
    }
    return {
      ok: result.status === 0,
      timedOut: false,
      exitCode: result.status,
      output,
      backupPath,
    };
  }

  const lockDir = `${lock}.d`;
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      writeFileSync(join(lockDir, 'pid'), `${process.pid}\n`, { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let observed: StatIdentity | null = null;
      try {
        observed = lstatSync(lockDir);
      } catch {
        continue;
      }
      let owner = 0;
      try {
        owner = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim());
      } catch {
        /* owner unknown */
      }
      if (owner && !pidAlive(owner)) {
        try {
          const current = lstatSync(lockDir);
          if (sameEntry(observed, current)) rmSync(lockDir, { recursive: true, force: true });
        } catch {
          /* vanished */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        return { ok: false, timedOut: true, exitCode: null, output: '', backupPath };
      }
      spawnSync('sleep', ['1']);
    }
  }

  try {
    const result = spawnSync(command[0] as string, command.slice(1), {
      cwd: REPO_ROOT,
      env: buildEnv,
      encoding: 'utf8',
      timeout: (waitSeconds + 120) * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      ok: result.status === 0,
      timedOut: false,
      exitCode: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      backupPath,
    };
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
