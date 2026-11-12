import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { startHttpServer, startTcpListener } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface ListenerLookup {
  state: 'unsupported' | 'ok' | 'failed';
  pids?: number[];
}

interface ListenerOwnership {
  listeners(port: number): ListenerLookup;
  owns(recordedPid: number, listenerPid: number): boolean;
}

interface WebReadiness {
  ready: boolean;
  reason: string;
}

interface WebModule {
  readWebPid(): number | null;
  readWebPort(): number | null;
  lookupListeners(port: number): ListenerLookup;
  assessWebReadiness(
    input: { pid: number | null; appPort: number; recordedPort: number | null },
    ownership?: ListenerOwnership,
  ): WebReadiness;
  stopWebServer(): { pid: number | null; stopped: boolean };
  waitForWeb(
    appUrl: string,
    pid: number,
    timeoutSeconds: number,
    appPort: number,
    ownership?: ListenerOwnership,
  ): Promise<{ ok: boolean; reason: string; http: number }>;
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
 * detached server from an earlier `env:ensure`. `set -m` gives the background
 * job its own process group — the portable equivalent of `setsid`, which stock
 * macOS does not ship.
 */
function spawnSleeper(extra: string[], env: NodeJS.ProcessEnv = baseEnv()): Promise<number> {
  const inner = `set -m; bash -c 'while :; do sleep 5; done' bash ${extra
    .map(shellQuote)
    .join(' ')} >/dev/null 2>&1 & echo $!`;
  const outer = spawn('bash', ['-c', inner], {
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    outer.stdout.on('data', (chunk: Buffer | string) => {
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
    if (result.status === 0 && result.stdout.includes(needle)) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`process ${pid} never showed '${needle}' in its command`);
}

function writePid(pid: number, port?: number): void {
  writeFileSync(pidFile, port === undefined ? `${pid}\n` : `${pid}\n${port}\n`, { mode: 0o600 });
}

function ownership(
  pids: number[],
  owns: (recordedPid: number, listenerPid: number) => boolean = (recorded, listener) =>
    recorded === listener,
): ListenerOwnership {
  return { listeners: () => ({ state: 'ok', pids }), owns };
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

  it('does not accept HTTP 200 from a dead process as ready', async () => {
    const server = await startHttpServer(200);
    try {
      const result = await web.waitForWeb(server.url, 999_999_999, 1, server.port);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('exited');
    } finally {
      await server.close();
    }
  });
});

describe('web readiness is bound to the recorded listener', () => {
  it('is not ready when the recorded port is not the leased port', async () => {
    const server = await startHttpServer(200);
    try {
      writePid(process.pid, server.port + 1);
      const result = await web.waitForWeb(
        server.url,
        process.pid,
        1,
        server.port,
        ownership([process.pid]),
      );

      expect(result).toMatchObject({ ok: false, reason: 'port-mismatch', http: 200 });
    } finally {
      await server.close();
    }
  });

  it('is not ready when the leased port is served by another process', async () => {
    const server = await startHttpServer(200);
    try {
      writePid(process.pid, server.port);
      const result = await web.waitForWeb(server.url, process.pid, 1, server.port, {
        listeners: () => ({ state: 'ok', pids: [999_999_999] }),
        owns: () => false,
      });

      expect(result).toMatchObject({ ok: false, reason: 'foreign-listener', http: 200 });
    } finally {
      await server.close();
    }
  });

  it('is ready when the listener belongs to the recorded process', async () => {
    const server = await startHttpServer(200);
    try {
      writePid(process.pid, server.port);
      const result = await web.waitForWeb(
        server.url,
        process.pid,
        1,
        server.port,
        ownership([process.pid]),
      );

      expect(result).toMatchObject({ ok: true, reason: 'ready', http: 200 });
      expect(web.readWebPort()).toBe(server.port);
    } finally {
      await server.close();
    }
  });

  it('never reports ready when the listener cannot be verified', async () => {
    const server = await startHttpServer(200);
    try {
      writePid(process.pid, server.port);
      const result = await web.waitForWeb(server.url, process.pid, 1, server.port, {
        listeners: () => ({ state: 'failed' }),
        owns: () => true,
      });

      expect(result).toMatchObject({ ok: false, reason: 'listener-unverifiable', http: 200 });
    } finally {
      await server.close();
    }
  });

  it('never reports ready when the listener table is unsupported', async () => {
    const server = await startHttpServer(200);
    try {
      writePid(process.pid, server.port);
      const result = await web.waitForWeb(server.url, process.pid, 1, server.port, {
        listeners: () => ({ state: 'unsupported' }),
        owns: () => false,
      });

      expect(result).toMatchObject({ ok: false, reason: 'listener-unverifiable', http: 200 });
    } finally {
      await server.close();
    }
  });
});

describe('listener lookup without lsof', () => {
  it.skipIf(process.platform !== 'linux' || !existsSync('/proc/net/tcp'))(
    'uses the /proc listener table instead of reporting unsupported',
    async () => {
      const listener = await startTcpListener(0, '127.0.0.1');
      const withoutLsof = mkdtempSync(join(tmpdir(), 'studiq-env-no-lsof-'));
      const savedPath = process.env.PATH;
      try {
        // An empty PATH makes `lsof` an ENOENT inside the lookup.
        process.env.PATH = withoutLsof;

        const result = web.lookupListeners(listener.port);

        expect(result.state).toBe('ok');
        expect(result.pids).toContain(process.pid);
      } finally {
        process.env.PATH = savedPath;
        rmSync(withoutLsof, { recursive: true, force: true });
        await listener.close();
      }
    },
  );
});
