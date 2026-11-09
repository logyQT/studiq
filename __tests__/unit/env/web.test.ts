import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface WebModule {
  readWebPid(): number | null;
  stopWebServer(): { pid: number | null; stopped: boolean };
}

interface RepoModule {
  REPO_ROOT: string;
}

const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-web-'));
// `DEV_DIR` is fixed at module load, so the isolated state dir goes first.
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const web = await loadEnvModule<WebModule>('lib/web.ts');
const repo = await loadEnvModule<RepoModule>('lib/repo.ts');

const pidFile = join(stateDir, 'web.pid');
const sleepers = new Set<number>();

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.STUDIQ_DEV_WORKTREE;
  return env;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A long-running process that is *not* a direct child of this test process, so
 * the parent reaps cleanly and `stopWebServer` sees the same situation as a
 * detached server from an earlier `env:ensure`. `setsid` makes it its own group
 * leader, exactly like `startWebServer`'s `detached` spawn.
 */
function spawnSleeper(extra: string[], env: NodeJS.ProcessEnv = baseEnv()): Promise<number> {
  const inner = `setsid bash -c 'while :; do sleep 5; done' bash ${extra
    .map(shellQuote)
    .join(' ')} >/dev/null 2>&1 & echo $!`;
  const outer = spawn('bash', ['-c', inner], {
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    outer.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    outer.on('error', reject);
    outer.on('close', (code) => {
      const pid = Number(stdout.trim());
      if (code !== 0 || !Number.isInteger(pid) || pid <= 1) {
        reject(new Error(`could not start a detached sleeper (${code}: ${stdout})`));
        return;
      }
      sleepers.add(pid);
      resolve(pid);
    });
  });
}

/** Wait until `ps` shows the spawned command, so `/proc/<pid>/environ` is ready. */
async function waitForCommand(pid: number, needle: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.status === 0 && (result.stdout ?? '').includes(needle)) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`process ${pid} never showed '${needle}' in its command`);
}

function writePid(pid: number): void {
  writeFileSync(pidFile, `${pid}\n`, { mode: 0o600 });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const pid of sleepers) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  sleepers.clear();
});

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('web PID ownership', () => {
  it('does not claim a live PID whose command merely mentions the checkout', async () => {
    const pid = await spawnSleeper([repo.REPO_ROOT]);
    await waitForCommand(pid, repo.REPO_ROOT);
    writePid(pid);

    expect(web.readWebPid()).toBeNull();
    expect(web.stopWebServer()).toEqual({ pid: null, stopped: false });
    // A stale PID file must not survive a `down`.
    expect(existsSync(pidFile)).toBe(false);
    // The unrelated process is left alone.
    expect(alive(pid)).toBe(true);
  });

  it('requires a delimiter-safe marker, not a worktree-prefix match', async () => {
    const pid = await spawnSleeper([repo.REPO_ROOT], {
      ...baseEnv(),
      STUDIQ_DEV_WORKTREE: `${repo.REPO_ROOT}-other`,
    });
    await waitForCommand(pid, repo.REPO_ROOT);
    writePid(pid);

    expect(web.readWebPid()).toBeNull();
    expect(web.stopWebServer().stopped).toBe(false);
    expect(alive(pid)).toBe(true);
  });

  it("accepts and stops this checkout's marked Next process", async () => {
    const pid = await spawnSleeper(['next'], {
      ...baseEnv(),
      STUDIQ_DEV_WORKTREE: repo.REPO_ROOT,
    });
    await waitForCommand(pid, 'next');
    writePid(pid);

    expect(web.readWebPid()).toBe(pid);
    expect(web.stopWebServer()).toEqual({ pid, stopped: true });
    expect(existsSync(pidFile)).toBe(false);
    expect(alive(pid)).toBe(false);
  });
});
