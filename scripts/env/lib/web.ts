import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './repo';

const WEB_PID_FILE = join(REPO_ROOT, '.dev', 'web.pid');

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasWorktreeMarker(pid: number): boolean {
  try {
    const environ = readFileSync(`/proc/${pid}/environ`, 'utf8');
    return environ.includes(`STUDIQ_DEV_WORKTREE=${REPO_ROOT}`);
  } catch {
    const result = spawnSync('ps', ['eww', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    return (result.stdout ?? '').includes(`STUDIQ_DEV_WORKTREE=${REPO_ROOT}`);
  }
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
  if (command.includes(REPO_ROOT)) return pid;
  return null;
}
