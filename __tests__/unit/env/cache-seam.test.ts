/**
 * The `.next/cache` seam, end to end in one process.
 *
 * `STUDIQ_WORKTREE_CACHE_DIR` redirects what a reader classifies, snapshots and
 * reports. These tests pin the seam's inputs (the resolution rules), the one
 * pass-through a command owns (the resolved cache reaches the seed), and the
 * boundary the seam must not cross: a recursive delete never follows it outside
 * the checkout.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface SeedResult {
  status: 'seeded' | 'skipped' | 'refused';
  reason?: string;
  id?: string;
}

interface CacheModule {
  worktreeCacheDir(repoRoot?: string, env?: NodeJS.ProcessEnv): string;
  seedWorktreeCache(input: unknown): Promise<SeedResult>;
}

interface BuildModule {
  pruneCacheVersions(nextVersion: string | null, keepDirectory?: string | null): string[];
}

interface BuildCommandModule {
  seedIfMissing(envHash: string): Promise<{
    outcome: string;
    id: string | null;
    reason: string | null;
  }>;
}

// `state.ts` captures DEV_DIR at import time, so isolate it before any module loads.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-cache-seam-state-'));
const registryDir = mkdtempSync(join(tmpdir(), 'studiq-cache-seam-registry-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
process.env.STUDIQ_DEV_REGISTRY = registryDir;

const cacheModule = await loadEnvModule<CacheModule>('lib/build-cache.ts');
const buildModule = await loadEnvModule<BuildModule>('lib/build.ts');
const buildCommandModule = await loadEnvModule<BuildCommandModule>('commands/build.ts');

const outerDir = mkdtempSync(join(tmpdir(), 'studiq-cache-seam-outer-'));
const baselineEnv = { ...process.env };

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(registryDir, { recursive: true, force: true });
  rmSync(outerDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
  delete process.env.STUDIQ_WORKTREE_CACHE_DIR;
  delete process.env.STUDIQ_CACHE_SEED;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(baselineEnv)) process.env[key] = value;
});

describe('the cache a build seeds', () => {
  it('passes the resolved cache directory to the seed', async () => {
    const redirected = join(outerDir, 'redirected', 'cache');
    process.env.STUDIQ_WORKTREE_CACHE_DIR = redirected;
    const seed = vi
      .spyOn(cacheModule, 'seedWorktreeCache')
      .mockResolvedValue({ status: 'skipped', reason: 'no published snapshot' });

    const result = await buildCommandModule.seedIfMissing('env-hash');

    expect(result).toEqual({
      outcome: 'skipped',
      id: null,
      reason: 'no published snapshot',
    });
    // Dropping `cacheDir` here would silently seed the default path instead.
    expect(seed.mock.calls[0]?.[0]).toMatchObject({
      worktreeRoot: REPO_ROOT,
      cacheDir: redirected,
    });
  });
});

describe('the prune never leaves the checkout', () => {
  it('leaves a cache outside the worktree untouched', () => {
    const cacheDir = join(outerDir, 'outside', 'cache');
    const foreign = join(cacheDir, 'turbopack', 'v16.0.0-dead');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'operator-file'), 'keep me');
    process.env.STUDIQ_WORKTREE_CACHE_DIR = cacheDir;

    const pruned = buildModule.pruneCacheVersions('16.4.5');

    expect(pruned).toEqual([]);
    expect(readdirSync(join(cacheDir, 'turbopack'))).toEqual(['v16.0.0-dead']);
    expect(existsSync(join(foreign, 'operator-file'))).toBe(true);
  });
});
