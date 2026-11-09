import {
  closeSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { probeHttp } from './health';
import { EXIT_CONFLICT, EnvFailure } from './exit';
import { DEV_DIR, ensureDevDir } from './state';
import { REPO_ROOT } from './repo';
import { pidAlive } from './locks';

const WEB_PID_FILE = join(DEV_DIR, 'web.pid');
const WEB_LOG = join(DEV_DIR, 'web.log');

/** The process environment as NUL/space-separated text, or ''. */
function readProcessEnvironment(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8');
  } catch {
    const result = spawnSync('ps', ['eww', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    return result.stdout ?? '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWorktreeMarker(pid: number): boolean {
  // A delimiter is required: `/repo` must not match `/repo-feature`.
  const marker = new RegExp(`STUDIQ_DEV_WORKTREE=${escapeRegExp(REPO_ROOT)}(?:[\\0\\s]|$)`);
  return marker.test(readProcessEnvironment(pid));
}

interface WebProcessRecord {
  pid: number;
  /** The app port recorded when the server was started, or null (legacy file). */
  port: number | null;
}

/**
 * Parsed `.dev/web.pid`: the first field is the server PID, the second the app
 * port it was started for. The port is recorded with the process so readiness
 * can prove *which* port the owned server serves instead of trusting a bare PID.
 */
function readWebRecord(): WebProcessRecord | null {
  let raw: string;
  try {
    if (!statSync(WEB_PID_FILE).isFile()) return null;
    raw = readFileSync(WEB_PID_FILE, 'utf8');
  } catch {
    return null;
  }
  const [pidLine = '', portLine = ''] = raw.trim().split(/\s+/);
  const pid = Number(pidLine);
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const recorded = Number(portLine);
  const port = Number.isInteger(recorded) && recorded > 0 && recorded <= 65535 ? recorded : null;
  return { pid, port };
}

/** Whether the PID file still records `pid` (checked before removing it). */
function recordsPid(pid: number): boolean {
  return readWebRecord()?.pid === pid;
}

/**
 * PID of this checkout's `next start`/dev server, or null.
 *
 * The pid file alone is not proof — the PID may have been reused by an
 * unrelated process. Both startup paths (`scripts/dev` and `startWebServer`)
 * set `STUDIQ_DEV_WORKTREE`, so this checkout's marker (and a Next-looking
 * command) is required: a command that merely mentions the checkout path is
 * not enough. Readiness additionally needs the recorded app port and listener
 * (see `assessWebReadiness`).
 */
export function readWebPid(): number | null {
  const record = readWebRecord();
  if (!record || !pidAlive(record.pid)) return null;
  const pid = record.pid;

  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const command = result.stdout ?? '';

  if (!hasWorktreeMarker(pid)) return null;
  if (!command.includes('next') && !command.includes('@studiq/web')) return null;
  return pid;
}

/** @public Exercised by the unit tests, which load this module by computed URL. */
export function readWebPort(): number | null {
  return readWebRecord()?.port ?? null;
}

function terminateWebPid(pid: number): boolean {
  if (!pidAlive(pid)) {
    try {
      if (recordsPid(pid)) rmSync(WEB_PID_FILE);
    } catch {
      /* gone */
    }
    return false;
  }
  if (!hasWorktreeMarker(pid)) return false;

  let signalled = false;
  if (spawnSync('kill', ['-TERM', '--', `-${pid}`]).status === 0) {
    signalled = true;
  } else {
    try {
      process.kill(pid, 'SIGTERM');
      signalled = true;
    } catch {
      /* already gone */
    }
  }
  if (!signalled) return false;

  const deadline = Date.now() + 15_000;
  while (pidAlive(pid) && Date.now() < deadline) {
    spawnSync('sleep', ['0.2']);
  }
  if (pidAlive(pid)) {
    if (spawnSync('kill', ['-KILL', '--', `-${pid}`]).status !== 0) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  const stopped = !pidAlive(pid);
  if (stopped) {
    try {
      if (recordsPid(pid)) rmSync(WEB_PID_FILE);
    } catch {
      /* gone */
    }
  }
  return stopped;
}

export interface StopWebResult {
  pid: number | null;
  /** True only when this checkout's server was signalled and is now gone. */
  stopped: boolean;
}

/** The process facts the rebuild guard needs (injected so it is testable). */
export interface RebuildWebGuard {
  readPid(): number | null;
  stop(): StopWebResult;
  alive(pid: number): boolean;
}

const defaultRebuildWebGuard: RebuildWebGuard = {
  readPid: () => readWebPid(),
  stop: () => stopWebServer(),
  alive: (pid) => pidAlive(pid),
};

/**
 * A rebuild replaces `apps/web/.next` under the running server, so the server
 * must be *gone* first — not merely asked to stop. `stopWebServer` can decline
 * (no marker, a signalled group that survived), and the build would then race a
 * live server, so a surviving PID aborts before the caller builds anything.
 */
export async function rebuildWithWebStopped<T>(
  build: () => Promise<T>,
  guard: RebuildWebGuard = defaultRebuildWebGuard,
): Promise<T> {
  const pid = guard.readPid();
  if (pid !== null) {
    guard.stop();
    const survivor = guard.readPid() ?? (guard.alive(pid) ? pid : null);
    if (survivor !== null) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `web server (pid ${survivor}) is still running after stop; refusing to rebuild over it.`,
      );
    }
  }
  return build();
}

/** Stop only this checkout's web server; idempotent. */
export function stopWebServer(): StopWebResult {
  const pid = readWebPid();
  if (!pid) {
    rmSync(WEB_PID_FILE, { force: true });
    return { pid: null, stopped: false };
  }
  return { pid, stopped: terminateWebPid(pid) };
}

/**
 * Stop this checkout's recorded server before a replacement is started. A
 * declined or incomplete stop must abort: starting a second server would race
 * the survivor for the port and leave an orphan answering requests, so a live
 * PID after the stop is a conflict, not a warning.
 */
export function stopWebServerForReplacement(
  guard: RebuildWebGuard = defaultRebuildWebGuard,
): StopWebResult {
  const pid = guard.readPid();
  if (pid === null) return { pid: null, stopped: false };
  const result = guard.stop();
  const survivor = guard.readPid() ?? (result.stopped ? null : guard.alive(pid) ? pid : null);
  if (survivor !== null) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `web server (pid ${survivor}) is still running after stop; refusing to start a replacement.`,
    );
  }
  return result;
}

export interface StartWebOptions {
  appPort: number;
  appUrl: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Start `next start` through the workspace script, so `--keepAliveTimeout
 * 55000` is kept (a raw `next start` loses it and Playwright sees ECONNRESET).
 * The process is detached in its own group so one signal stops its children.
 */
export function startWebServer(options: StartWebOptions): number {
  ensureDevDir();
  const log = openSync(WEB_LOG, 'a', 0o600);
  const line = `\n===== ${new Date().toISOString()} env:ensure (prod, port ${options.appPort}) =====\n`;
  writeFileSync(WEB_LOG, line, { flag: 'a', mode: 0o600 });

  const child = spawn(process.execPath, ['run', '--filter', '@studiq/web', 'start'], {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      PORT: String(options.appPort),
      APP_URL: options.appUrl,
      NEXT_PUBLIC_SITE_URL: options.env.NEXT_PUBLIC_SITE_URL || options.appUrl,
      STUDIQ_DEV_WORKTREE: REPO_ROOT,
    },
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  const pid = child.pid;
  if (!pid) throw new Error('could not start the web server');
  child.unref();
  writeFileSync(WEB_PID_FILE, `${pid}\n${options.appPort}\n`, { mode: 0o600 });
  return pid;
}

export type WebReadinessReason =
  | 'ready'
  | 'no-pid'
  | 'port-mismatch'
  | 'listener-unverifiable'
  | 'foreign-listener'
  | 'not-listening';

export interface WebReadiness {
  ready: boolean;
  reason: WebReadinessReason;
}

/** What `lsof` could tell about a TCP listen port. */
export type ListenerLookup =
  { state: 'unsupported' } | { state: 'ok'; pids: number[] } | { state: 'failed' };

/**
 * Listener evidence, injectable so the readiness rules are testable without a
 * real server (or a host that happens to have `lsof`).
 */
export interface ListenerOwnership {
  /** PIDs listening on TCP `port`; `unsupported` only when neither `lsof` nor `/proc` can answer. */
  listeners(port: number): ListenerLookup;
  /** Whether `listenerPid` belongs to the recorded server process. */
  owns(recordedPid: number, listenerPid: number): boolean;
}

/**
 * Linux-only `/proc` fallback for lsof: it covers lsof's blind spot (4.95 cannot
 * parse a process whose `comm` contains a space, and Next 16 names its server
 * `next-server (v16.4.4)`) and hosts where `lsof` is absent entirely. `null`
 * means the table could not be read (treat the listener as unverifiable); `[]`
 * means nothing listens on the port.
 */
function procListenerPids(port: number): number[] | null {
  if (process.platform !== 'linux') return null;
  const inodes = new Set<string>();
  let readable = false;
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
      readable = true;
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== '0A') continue; // 0A = LISTEN
      const localPort = Number.parseInt(fields[1]?.split(':')[1] ?? '', 16);
      if (localPort === port) inodes.add(fields[9] as string);
    }
  }
  if (!readable) return null;
  if (inodes.size === 0) return [];
  const pids: number[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${name}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let target: string;
      try {
        target = readlinkSync(`/proc/${name}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match && inodes.has(match[1] as string)) {
        pids.push(Number(name));
        break;
      }
    }
  }
  return pids;
}

/** @public Exercised by the unit tests, which load this module by computed URL. */
export function lookupListeners(port: number): ListenerLookup {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  // `lsof` is absent on some Linux images: fall back to `/proc` there instead of
  // skipping the listener proof (an empty list still means "nothing listens").
  if (code === 'ENOENT') {
    const fallback = procListenerPids(port);
    return fallback === null ? { state: 'unsupported' } : { state: 'ok', pids: fallback };
  }
  if (result.error || result.status === null) return { state: 'failed' };
  // `lsof` exits 1 when nothing matches; that is a valid "no listener".
  if (result.status !== 0 && result.status !== 1) return { state: 'failed' };
  const pids = (result.stdout ?? '')
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 1);
  if (pids.length > 0 || result.status === 0) return { state: 'ok', pids };
  // lsof answered "nothing listens" — cross-check /proc before concluding that,
  // because lsof cannot read a `next-server (v…)` process name.
  const fallback = procListenerPids(port);
  if (fallback === null) return { state: 'ok', pids: [] };
  return { state: 'ok', pids: fallback };
}

function listenerBelongsTo(recordedPid: number, listenerPid: number): boolean {
  if (listenerPid === recordedPid) return true;
  // `startWebServer` spawns `bun run … start`, so the listening `next start` is
  // a child in the detached server's process group (the recorded PID is the
  // group leader). A listener outside that group is not ours.
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(listenerPid)], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) return false;
  return Number((result.stdout ?? '').trim()) === recordedPid;
}

const defaultListenerOwnership: ListenerOwnership = {
  listeners: lookupListeners,
  owns: listenerBelongsTo,
};

/**
 * Is the recorded server actually this checkout's server on `appPort`?
 *
 * A live owned PID plus an HTTP 200 is not proof: the 200 may come from a
 * foreign listener while our process sits on another port. The PID file's
 * recorded port must equal the leased port, and (when `lsof` is available) the
 * listener on that port must belong to the recorded process. A mismatch or an
 * unverifiable listener is never reported ready.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function assessWebReadiness(
  input: { pid: number | null; appPort: number; recordedPort: number | null },
  ownership: ListenerOwnership = defaultListenerOwnership,
): WebReadiness {
  const pid = input.pid;
  if (pid === null || !pidAlive(pid)) return { ready: false, reason: 'no-pid' };
  if (input.recordedPort !== input.appPort) return { ready: false, reason: 'port-mismatch' };
  const listeners = ownership.listeners(input.appPort);
  if (listeners.state === 'unsupported') return { ready: true, reason: 'ready' };
  if (listeners.state === 'failed') return { ready: false, reason: 'listener-unverifiable' };
  if (listeners.pids.length === 0) return { ready: false, reason: 'not-listening' };
  if (!listeners.pids.some((listener) => ownership.owns(pid, listener))) {
    return { ready: false, reason: 'foreign-listener' };
  }
  return { ready: true, reason: 'ready' };
}

/** Warm-path readiness for the recorded server on `appPort` (no HTTP probe). */
export function recordedWebReadiness(appPort: number): WebReadiness {
  return assessWebReadiness({ pid: readWebPid(), appPort, recordedPort: readWebPort() });
}

export interface WaitWebResult {
  ok: boolean;
  reason: 'ready' | 'exited' | 'timeout' | Exclude<WebReadinessReason, 'ready'>;
  http: number;
}

export async function waitForWeb(
  appUrl: string,
  pid: number,
  timeoutSeconds: number,
  appPort: number,
  ownership: ListenerOwnership = defaultListenerOwnership,
): Promise<WaitWebResult> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let http = 0;
  while (Date.now() < deadline) {
    // A dead `next start` can leave a socket that still answers for a moment;
    // our own PID is necessary but not sufficient for "this checkout's server".
    if (!pidAlive(pid)) return { ok: false, reason: 'exited', http };
    http = await probeHttp(appUrl);
    if (http === 200) {
      // Re-check: the process may have exited while the probe was in flight.
      if (!pidAlive(pid)) return { ok: false, reason: 'exited', http };
      // HTTP 200 alone can be a foreign listener on the leased port. Only the
      // recorded port plus its owning listener proves our server serves it.
      const readiness = assessWebReadiness(
        { pid, appPort, recordedPort: readWebPort() },
        ownership,
      );
      if (!readiness.ready) return { ok: false, reason: readiness.reason, http };
      return { ok: true, reason: 'ready', http };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, reason: 'timeout', http };
}

export function webLogPath(): string {
  return WEB_LOG;
}
