import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface CachedStack {
  stackName: string;
  status: {
    id: string;
    name: string;
    projectRoot: string;
    branch: string | null;
    runtime: string;
    lifecycle: string | null;
    configDrift: string | null;
    apiUrl: string;
    dbUrl: string | null;
    studioUrl: string | null;
    mailUrl: string | null;
    ports: Record<string, number>;
  };
  services: string[];
  envHash: string;
  appUrl: string;
  heartbeatAt: number;
}

interface StackCacheModule {
  readCachedStack(stackName: string | null, now?: number, ttlMs?: number): CachedStack | null;
  writeCachedStack(entry: Omit<CachedStack, 'heartbeatAt'>, now?: number): void;
  removeCachedStack(): void;
}

// `.dev/` (or the isolated state dir) is resolved when `state.ts` is first
// imported, so point it at a private temp dir before loading the module.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-stack-cache-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const cache = await loadEnvModule<StackCacheModule>('lib/stack-cache.ts');
const repo = await loadEnvModule<{ REPO_ROOT: string }>('lib/repo.ts');

const PORTS = {
  api: 21001,
  db: 21002,
  studio: 0,
  mail: 21003,
  mailSmtp: 21004,
  mailPop3: 21005,
  realtime: 0,
  analytics: 0,
  edgeInspector: 0,
  pooler: 0,
  pgmeta: 0,
};

function entry(overrides: { stackName?: string; projectRoot?: string; id?: string } = {}) {
  return {
    stackName: overrides.stackName ?? '',
    status: {
      id: overrides.id ?? 'abc123',
      name: 'default',
      projectRoot: overrides.projectRoot ?? repo.REPO_ROOT,
      branch: 'refs/heads/feat/x',
      runtime: 'native',
      lifecycle: 'running',
      configDrift: null,
      apiUrl: 'http://127.0.0.1:21001',
      dbUrl: 'postgresql://127.0.0.1:21002/postgres',
      studioUrl: null,
      mailUrl: 'http://127.0.0.1:21003',
      ports: PORTS,
    },
    services: ['database', 'auth', 'storage', 'rest'],
    envHash: 'hash',
    appUrl: 'http://localhost:3000',
  };
}

beforeEach(() => {
  delete process.env.STUDIQ_ENV_STATE_DIR;
  process.env.STUDIQ_ENV_STATE_DIR = stateDir;
  cache.removeCachedStack();
});

afterAll(() => {
  cache.removeCachedStack();
  delete process.env.STUDIQ_ENV_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

describe('warm-path stack cache (spec §6)', () => {
  it('returns the record it wrote, for the same stack name', () => {
    cache.writeCachedStack(entry(), 1_000);
    const read = cache.readCachedStack(null, 1_500);
    expect(read?.status.id).toBe('abc123');
    expect(read?.services).toContain('rest');
    expect(read?.envHash).toBe('hash');
    expect(read?.heartbeatAt).toBe(1_000);
    expect(cache.readCachedStack('named', 1_500)).toBeNull();
  });

  it('expires after the TTL (default 120 s) and never trusts a future heartbeat', () => {
    cache.writeCachedStack(entry(), 1_000);
    expect(cache.readCachedStack(null, 1_000 + 119_000)).not.toBeNull();
    expect(cache.readCachedStack(null, 1_000 + 120_001)).toBeNull();
    // An explicit ttl overrides the default.
    expect(cache.readCachedStack(null, 1_200, 500)).not.toBeNull();
    expect(cache.readCachedStack(null, 1_501, 500)).toBeNull();
    // A clock that jumped backwards must not extend the record's life.
    expect(cache.readCachedStack(null, 999_000)).toBeNull();
  });

  it('ignores a record made for another checkout', () => {
    cache.writeCachedStack(entry({ projectRoot: '/somewhere/else' }), 1_000);
    expect(cache.readCachedStack(null, 1_500)).toBeNull();
  });

  it('is removable and tolerates a missing file', () => {
    cache.removeCachedStack();
    expect(cache.readCachedStack(null)).toBeNull();
    cache.writeCachedStack(entry(), 1_000);
    cache.removeCachedStack();
    expect(cache.readCachedStack(null, 1_100)).toBeNull();
  });
});
