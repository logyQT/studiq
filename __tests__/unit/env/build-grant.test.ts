/**
 * Grant minting lives in `runProductionBuild`, not in `commands/build.ts`, so
 * both `env build` and `env ensure`'s rebuild mint one. These tests drive the
 * real function with a fake spawn and read the file the guard would consume.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUN, REPO_ROOT } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface ProductionBuildOptions {
  app: 'web' | 'admin';
  admission: 'slot' | 'no-slot' | 'no-lock';
}

interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintAfter: string;
  slot?: number | null;
  grant?: 'consumed' | 'unconsumed';
}

interface SpawnOutcome {
  status: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

interface BuildModule {
  runProductionBuild(
    envHash: string,
    deps: {
      readWebPid(): number | null;
      spawnBuild(slot: unknown, options: ProductionBuildOptions): Promise<SpawnOutcome>;
    },
    options: ProductionBuildOptions,
  ): Promise<BuildResult>;
  buildCommand(app: 'web' | 'admin'): { args: string[] };
}

// `state.ts` captures DEV_DIR at import time; both modules share this directory.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-grant-state-'));
const registryDir = mkdtempSync(join(tmpdir(), 'studiq-grant-registry-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
process.env.STUDIQ_DEV_REGISTRY = registryDir;

const build = await loadEnvModule<BuildModule>('lib/build.ts');
const grantPath = join(stateDir, 'build-grant.json');
const GUARD = join(REPO_ROOT, 'scripts', 'env', 'build-guard.ts');

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(registryDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
  rmSync(join(registryDir, 'build-slots'), { recursive: true, force: true });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readGrant(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(grantPath, 'utf8'));
  if (!isRecord(parsed)) throw new Error('expected the grant to be a JSON object');
  return parsed;
}

function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

function ok(): SpawnOutcome {
  return { status: 0, timedOut: false, output: '', durationMs: 1 };
}

describe('runProductionBuild mints the single-use grant', () => {
  it('mints an admin grant and spawns the admin workspace filter', async () => {
    let seen: ProductionBuildOptions | null = null;
    let during: Record<string, unknown> | null = null;

    const result = await build.runProductionBuild(
      'env-hash',
      {
        // An admin build serves on 4000: it must not consult the web server.
        readWebPid: () => {
          throw new Error('an admin build must not read the web pid');
        },
        spawnBuild: (_slot, options) => {
          seen = options;
          during = readGrant();
          return Promise.resolve(ok());
        },
      },
      { app: 'admin', admission: 'no-slot' },
    );

    expect(seen).toEqual({ app: 'admin', admission: 'no-slot' });
    expect(during).toMatchObject({
      app: 'admin',
      admission: 'no-slot',
      slot: null,
      launcherPid: process.pid,
    });
    // Admin has no fingerprint of its own, so a zero exit is the whole verdict.
    expect(result.ok).toBe(true);
    expect(result.fingerprintAfter).toBe('');
    expect(result.slot).toBeNull();
    // The fake spawn never runs `prebuild`, so the grant is still on disk.
    expect(result.grant).toBe('unconsumed');
    expect(existsSync(grantPath)).toBe(true);

    expect(build.buildCommand('admin').args).toContain('@studiq/admin');
    expect(build.buildCommand('web').args).toContain('@studiq/web');
  });

  it('mints a slotless grant for --no-slot and prints its one line', async () => {
    const stderr = captureStderr();

    await build.runProductionBuild(
      'env-hash',
      { readWebPid: () => null, spawnBuild: () => Promise.resolve(ok()) },
      { app: 'web', admission: 'no-slot' },
    );

    expect(stderr.join('')).toContain(
      'build: --no-slot: no build slot or lease claimed (CI/Playwright mode)',
    );
    expect(readGrant()).toMatchObject({ app: 'web', admission: 'no-slot', slot: null });
  });

  it('warns on every --no-lock build', async () => {
    const stderr = captureStderr();

    await build.runProductionBuild(
      'env-hash',
      { readWebPid: () => null, spawnBuild: () => Promise.resolve(ok()) },
      { app: 'web', admission: 'no-lock' },
    );

    expect(stderr.join('')).toContain(
      'warning: build: --no-lock bypasses build admission on this machine',
    );
    expect(readGrant()).toMatchObject({ admission: 'no-lock', slot: null });
  });

  it('mints a grant naming the held slot and its token in slot mode', async () => {
    let during: Record<string, unknown> | null = null;
    let slotToken = '';

    const result = await build.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () => {
          during = readGrant();
          slotToken = readFileSync(join(registryDir, 'build-slots', '1', 'token'), 'utf8').trim();
          return Promise.resolve(ok());
        },
      },
      { app: 'web', admission: 'slot' },
    );

    expect(during).toMatchObject({ app: 'web', admission: 'slot', slot: 1 });
    expect(slotToken).not.toBe('');
    expect(during?.['token']).toBe(slotToken);
    expect(result.slot).toBe(1);
  });

  it('mints a grant the real prebuild guard accepts', async () => {
    await build.runProductionBuild(
      'env-hash',
      { readWebPid: () => null, spawnBuild: () => Promise.resolve(ok()) },
      { app: 'web', admission: 'no-slot' },
    );

    const guard = spawnSync(BUN, [GUARD], {
      cwd: join(REPO_ROOT, 'apps', 'web'),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: stateDir,
        STUDIQ_ENV_STATE_DIR: stateDir,
        STUDIQ_DEV_REGISTRY: registryDir,
      },
    });

    expect(guard.status).toBe(0);
    expect(guard.stderr).toContain('build: admitted apps/web (no slot, no-slot');
    expect(existsSync(grantPath)).toBe(false);
  });

  it('marks the grant consumed when the guard ran', async () => {
    const result = await build.runProductionBuild(
      'env-hash',
      {
        readWebPid: () => null,
        spawnBuild: () => {
          // Stand in for the `prebuild` hook: consume the grant, as the guard does.
          rmSync(grantPath, { force: true });
          return Promise.resolve(ok());
        },
      },
      { app: 'web', admission: 'no-slot' },
    );

    expect(result.grant).toBe('consumed');
  });
});

describe('a slot-mode grant outlives its slot', () => {
  it('is refused by the guard once the build released the slot', async () => {
    // The fake spawn never runs `prebuild`, so the grant is left behind — the
    // shape a crashed or replayed launcher would leave.
    await build.runProductionBuild(
      'env-hash',
      { readWebPid: () => null, spawnBuild: () => Promise.resolve(ok()) },
      { app: 'web', admission: 'slot' },
    );
    expect(existsSync(grantPath)).toBe(true);

    const guard = spawnSync(BUN, [GUARD], {
      cwd: join(REPO_ROOT, 'apps', 'web'),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: stateDir,
        STUDIQ_ENV_STATE_DIR: stateDir,
        STUDIQ_DEV_REGISTRY: registryDir,
      },
    });

    expect(guard.status).toBe(6);
    expect(guard.stderr).toContain('the build slot that minted this grant is gone');
  });
});
