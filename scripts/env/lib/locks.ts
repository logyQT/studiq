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
} from 'node:fs';
import { join } from 'node:path';
import { EXIT_CONFLICT, EXIT_TIMEOUT, EXIT_USAGE, EnvFailure } from './exit';
import { appendEnvLog } from './state';
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

function readLock(file: string): LockContent | null {
  try {
    if (lstatSync(file).isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isObject(parsed)) return null;
    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') return null;
    return {
      pid: parsed.pid,
      token: parsed.token,
      projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : '',
      branch: typeof parsed.branch === 'string' ? parsed.branch : '',
      stackName: typeof parsed.stackName === 'string' ? parsed.stackName : '',
      acquiredAt: typeof parsed.acquiredAt === 'string' ? parsed.acquiredAt : '',
      heartbeatAt: typeof parsed.heartbeatAt === 'string' ? parsed.heartbeatAt : '',
    };
  } catch {
    return null;
  }
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
      let owner = 0;
      try {
        owner = Number(readFileSync(join(path, 'pid'), 'utf8').trim());
      } catch {
        /* owner unknown */
      }
      if (owner && !pidAlive(owner)) {
        rmSync(path, { recursive: true, force: true });
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
  const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      createLockFileAtomic(
        file,
        `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`,
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `cannot create the lease lock ${file}: ${(error as Error).message}`,
        );
      }
      let owner = 0;
      let observedToken = '';
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (isObject(parsed)) {
          owner = typeof parsed.pid === 'number' ? parsed.pid : 0;
          observedToken = typeof parsed.token === 'string' ? parsed.token : '';
        }
      } catch {
        /* corrupt/stale */
      }
      if (!owner || !pidAlive(owner)) {
        // Stale lock: remove only while it still carries the token we observed.
        try {
          const current: unknown = JSON.parse(readFileSync(file, 'utf8'));
          if (isObject(current) && current.token === observedToken) rmSync(file, { force: true });
        } catch {
          // Corrupt lock: reclaim only after it is safely old, never a fresh one.
          try {
            const age = Date.now() - statSync(file).mtimeMs;
            if (age > 5_000) rmSync(file, { force: true });
          } catch {
            /* vanished */
          }
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new EnvFailure(
          EXIT_TIMEOUT,
          `timed out after 60s waiting for the registry lease lock (${file})`,
        );
      }
      await sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const current: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (isObject(current) && current.token === token) rmSync(file, { force: true });
    } catch {
      /* gone/replaced */
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
      const holder = readLock(file);
      if (!holder || !pidAlive(holder.pid)) {
        rmSync(file, { force: true });
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
      const holder = readLock(file);
      throw new EnvFailure(
        EXIT_TIMEOUT,
        `timed out after ${options.waitSeconds}s waiting for the start lock${holder ? ` (pid ${holder.pid})` : ''}`,
      );
    }
    if (!announced) {
      announced = true;
      const holder = readLock(file);
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
      if (current?.token !== token) return;
      writeLock(file, {
        pid: process.pid,
        token,
        projectRoot: options.projectRoot,
        branch: options.branch,
        stackName: options.stackName,
        acquiredAt: current.acquiredAt || now,
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
      if (current?.token === token) rmSync(file, { force: true });
      appendEnvLog(`ensure: start lock released (stack ${options.stackName})`);
    },
  };
}

export interface BuildRunResult {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  output: string;
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
export function runBuildUnderLock(options: BuildRunOptions): BuildRunResult {
  const dir = ensureRegistryDir();
  const lock = join(dir, 'build.lock');
  const waitSeconds = options.waitSeconds ?? 1800;
  const command = [process.execPath, 'run', '--filter', '@studiq/web', 'build'];
  const buildEnv = buildEnvWithHeap(options.env);

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
      return { ok: false, timedOut: true, exitCode: 75, output };
    }
    return {
      ok: result.status === 0,
      timedOut: false,
      exitCode: result.status,
      output,
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
      let owner = 0;
      try {
        owner = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim());
      } catch {
        /* owner unknown */
      }
      if (owner && !pidAlive(owner)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        return { ok: false, timedOut: true, exitCode: null, output: '' };
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
    };
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
