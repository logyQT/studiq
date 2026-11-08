import { closeSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { probeHttp } from './health';
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

/**
 * PID of this checkout's `next start`/dev server, or null.
 *
 * Ported from `scripts/dev`'s `read_web_pid`: the pid file alone is not proof —
 * the process must still be alive and either carry this checkout's marker (and
 * look like Next) or reference the checkout path.
 */
export function readWebPid(): number | null {
  let raw: string;
  try {
    if (!statSync(WEB_PID_FILE).isFile()) return null;
    raw = readFileSync(WEB_PID_FILE, 'utf8').trim();
  } catch {
    return null;
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || !pidAlive(pid)) return null;

  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const command = result.stdout ?? '';

  if (hasWorktreeMarker(pid) && (command.includes('next') || command.includes('@studiq/web'))) {
    return pid;
  }
  // Same delimiter rule for the command fallback.
  const commandPath = new RegExp(`(?:^|\\s)${escapeRegExp(REPO_ROOT)}(?:[\\s/]|$)`);
  if (commandPath.test(command)) return pid;
  return null;
}

function terminateWebPid(pid: number): boolean {
  if (!pidAlive(pid)) {
    try {
      if (readFileSync(WEB_PID_FILE, 'utf8').trim() === String(pid)) rmSync(WEB_PID_FILE);
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
      if (readFileSync(WEB_PID_FILE, 'utf8').trim() === String(pid)) rmSync(WEB_PID_FILE);
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

/** Stop only this checkout's web server; idempotent. */
export function stopWebServer(): StopWebResult {
  const pid = readWebPid();
  if (!pid) {
    rmSync(WEB_PID_FILE, { force: true });
    return { pid: null, stopped: false };
  }
  return { pid, stopped: terminateWebPid(pid) };
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
  writeFileSync(WEB_PID_FILE, `${pid}\n`, { mode: 0o600 });
  return pid;
}

export interface WaitWebResult {
  ok: boolean;
  reason: 'ready' | 'exited' | 'timeout';
  http: number;
}

export async function waitForWeb(
  appUrl: string,
  pid: number,
  timeoutSeconds: number,
): Promise<WaitWebResult> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let http = 0;
  while (Date.now() < deadline) {
    http = await probeHttp(appUrl);
    if (http === 200) return { ok: true, reason: 'ready', http };
    if (!pidAlive(pid)) return { ok: false, reason: 'exited', http };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, reason: 'timeout', http };
}

export function webLogPath(): string {
  return WEB_LOG;
}
