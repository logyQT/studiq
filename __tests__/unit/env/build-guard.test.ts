/**
 * The `prebuild` guard is the only thing standing between a raw workspace build
 * and `next build`, so each test drives the real script in a child process with
 * a fixture state directory and registry — the same files the launcher writes.
 *
 * The guard runs with `cwd` = `apps/web`/`apps/admin` (that is how Bun invokes a
 * workspace `prebuild` hook), and resolves the repo root from its own location.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { BUN, REPO_ROOT } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface LocksModule {
  processStartTime(pid: number): string | null;
}

// `state.ts` captures DEV_DIR at import time; keep this suite off the real `.dev/`.
const moduleStateDir = mkdtempSync(join(tmpdir(), 'studiq-guard-module-'));
const savedStateDir = process.env.STUDIQ_ENV_STATE_DIR;
process.env.STUDIQ_ENV_STATE_DIR = moduleStateDir;
const locks = await loadEnvModule<LocksModule>('lib/locks.ts');
if (savedStateDir === undefined) delete process.env.STUDIQ_ENV_STATE_DIR;
else process.env.STUDIQ_ENV_STATE_DIR = savedStateDir;

const GUARD = join(REPO_ROOT, 'scripts', 'env', 'build-guard.ts');
const dirs: string[] = [];

afterAll(() => {
  rmSync(moduleStateDir, { recursive: true, force: true });
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  stateDir: string;
  registryDir: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'studiq-guard-'));
  dirs.push(root);
  const stateDir = join(root, 'state');
  const registryDir = join(root, 'registry');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(registryDir, { recursive: true });
  return { stateDir, registryDir };
}

interface SlotFixture {
  pid: number;
  start: string | null;
  pgid?: number;
  token: string;
  worktree?: string;
}

function writeSlot(registryDir: string, slot: number, record: SlotFixture): void {
  const path = join(registryDir, 'build-slots', String(slot));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(path, 'pid'), `${record.pid}\n`);
  writeFileSync(join(path, 'start'), `${record.start ?? ''}\n`);
  writeFileSync(join(path, 'pgid'), `${record.pgid ?? 0}\n`);
  writeFileSync(join(path, 'pgidStart'), '\n');
  writeFileSync(join(path, 'token'), `${record.token}\n`);
  writeFileSync(join(path, 'worktree'), `${record.worktree ?? REPO_ROOT}\n`);
  writeFileSync(join(path, 'startedAt'), `${new Date().toISOString()}\n`);
  writeFileSync(join(path, 'heartbeat'), `${Date.now()}\n`);
}

interface GrantFixture {
  token?: string;
  app?: 'web' | 'admin';
  admission?: 'slot' | 'no-slot' | 'no-lock';
  slot?: number | null;
  launcherPid?: number;
  launcherStart?: string | null;
  expiresAt?: string;
}

/** The grant a launcher would have minted; the guard consumes it on first read. */
function writeGrant(stateDir: string, record: GrantFixture = {}): string {
  const path = join(stateDir, 'build-grant.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        token: record.token ?? 'grant-token',
        app: record.app ?? 'web',
        admission: record.admission ?? 'slot',
        slot: record.slot === undefined ? 1 : record.slot,
        launcherPid: record.launcherPid ?? process.pid,
        launcherStart:
          record.launcherStart === undefined
            ? locks.processStartTime(process.pid)
            : record.launcherStart,
        mintedAt: new Date().toISOString(),
        expiresAt: record.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

interface GuardResult {
  status: number | null;
  stderr: string;
}

function runGuard(app: 'web' | 'admin', fixturePaths: Fixture): GuardResult {
  const result = spawnSync(BUN, [GUARD], {
    cwd: join(REPO_ROOT, 'apps', app),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: fixturePaths.stateDir,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      STUDIQ_ENV_STATE_DIR: fixturePaths.stateDir,
      STUDIQ_DEV_REGISTRY: fixturePaths.registryDir,
    },
  });
  return { status: result.status, stderr: result.stderr };
}

describe('build guard', () => {
  it('refuses a build with no grant and names the command that mints one', () => {
    const paths = fixture();
    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('no build grant for this checkout');
    expect(result.stderr).toContain("run 'bun run env:build'");
    // `env:build` builds web, so the web advice must not carry the admin flag.
    expect(result.stderr).not.toContain('--app');
    // The slot state is printed too, so "busy machine" is distinguishable from
    // "no grant"; nothing has built here, so the count is unknown.
    expect(result.stderr).toContain('build slots: unknown');
  });

  it('names --app admin when the admin build is refused', () => {
    const paths = fixture();
    const result = runGuard('admin', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('no build grant for this checkout');
    // `env:build` alone builds web: following that advice would leave this
    // build refused, so the admin refusal has to name the flag.
    expect(result.stderr).toContain("run 'bun run env:build --app admin'");
    expect(result.stderr).not.toContain('env:ensure --profile web');
  });

  it('admits a build whose grant names a live slot with the matching token', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, { token: 'slot-token', slot: 1 });

    const result = runGuard('web', paths);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('build: admitted apps/web (slot 1');
  });

  it('refuses an expired grant', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, {
      token: 'slot-token',
      slot: 1,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('expired at');
    expect(result.stderr).toContain("run 'bun run env:build'");
  });

  it('consumes the grant, so a second build cannot replay it', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, { token: 'slot-token', slot: 1 });

    expect(runGuard('web', paths).status).toBe(0);
    const replay = runGuard('web', paths);

    expect(replay.status).toBe(6);
    expect(replay.stderr).toContain('no build grant for this checkout');
  });

  it('refuses a grant minted for the other app', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, { app: 'admin', token: 'slot-token', slot: 1 });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('is for apps/admin, not apps/web');
    expect(result.stderr).toContain("run 'bun run env:build --app web'");
  });

  it('refuses when the slot the grant names is gone', () => {
    const paths = fixture();
    writeGrant(paths.stateDir, { token: 'slot-token', slot: 1 });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('the build slot that minted this grant is gone');
  });

  it('refuses a grant whose token does not match the slot it names', () => {
    const paths = fixture();
    // The slot exists and is live, but it belongs to a different build: decision
    // 6 makes the token equality part of holding a slot, not a formality.
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, { token: 'other-token', slot: 1 });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('the build slot that minted this grant is gone');
  });

  it('refuses when the slot the grant names is stale', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: 999_999_999,
      start: '1',
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, { token: 'slot-token', slot: 1 });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('build slot 1 is no longer live');
  });

  it('refuses a slot that belongs to another checkout', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
      worktree: '/tmp/another-worktree',
    });
    writeGrant(paths.stateDir, { token: 'slot-token', slot: 1 });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('belongs to /tmp/another-worktree');
  });

  it('admits a --no-slot grant with a live launcher and no slot directory', () => {
    const paths = fixture();
    writeGrant(paths.stateDir, { admission: 'no-slot', slot: null, token: 'slotless-token' });

    const result = runGuard('web', paths);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('build: admitted apps/web (no slot, no-slot');
  });

  it('refuses a --no-slot grant whose launcher is gone', () => {
    const paths = fixture();
    writeGrant(paths.stateDir, {
      admission: 'no-slot',
      slot: null,
      launcherPid: 999_999_999,
      launcherStart: '1',
    });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('the build that minted this grant (pid 999999999) is gone');
  });

  it('refuses a grant whose recorded launcher start time no longer matches', () => {
    const paths = fixture();
    writeSlot(paths.registryDir, 1, {
      pid: process.pid,
      start: locks.processStartTime(process.pid),
      token: 'slot-token',
    });
    writeGrant(paths.stateDir, {
      token: 'slot-token',
      slot: 1,
      launcherStart: 'not-this-process',
    });

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('now belongs to a different process');
  });

  it('refuses an unreadable grant', () => {
    const paths = fixture();
    writeFileSync(join(paths.stateDir, 'build-grant.json'), 'not json\n');

    const result = runGuard('web', paths);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('is unreadable');
  });

  it('refuses when the hook is not run from an app directory', () => {
    const paths = fixture();
    const result = spawnSync(BUN, [GUARD], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: paths.stateDir,
        STUDIQ_ENV_STATE_DIR: paths.stateDir,
        STUDIQ_DEV_REGISTRY: paths.registryDir,
      },
    });

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('runs as the prebuild hook of apps/web or apps/admin');
  });

  it('never reads STUDIQ_BUILD_SLOT: the grant is the only admission fact', () => {
    const paths = fixture();
    const result = spawnSync(BUN, [GUARD], {
      cwd: join(REPO_ROOT, 'apps', 'web'),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: paths.stateDir,
        STUDIQ_ENV_STATE_DIR: paths.stateDir,
        STUDIQ_DEV_REGISTRY: paths.registryDir,
        STUDIQ_BUILD_SLOT: '1',
      },
    });

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('no build grant for this checkout');
  });

  it('leaves no grant file behind after a refusal', () => {
    const paths = fixture();
    writeGrant(paths.stateDir, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    runGuard('web', paths);

    expect(() => readFileSync(join(paths.stateDir, 'build-grant.json'))).toThrow();
  });
});
