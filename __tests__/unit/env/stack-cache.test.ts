import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface CachedStack {
  branchRef: string;
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
  readCachedStack(
    stackName: string | null,
    branchRef: string,
    now?: number,
    ttlMs?: number,
  ): CachedStack | null;
  writeCachedStack(entry: Omit<CachedStack, 'heartbeatAt'>, now?: number): void;
  removeCachedStack(): void;
}

// `.dev/` (or the isolated state dir) is resolved when `state.ts` is first
// imported, so point it at a private temp dir before loading the module.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-stack-cache-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const cache = await loadEnvModule<StackCacheModule>('lib/stack-cache.ts');
const repo = await loadEnvModule<{ REPO_ROOT: string }>('lib/repo.ts');
const cacheFile = join(stateDir, 'stack-cache.json');

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

function entry(
  overrides: {
    branchRef?: string;
    stackName?: string;
    projectRoot?: string;
    id?: string;
  } = {},
) {
  return {
    branchRef: overrides.branchRef ?? 'refs/heads/a',
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
  it('returns the record it wrote, for the same stack name and branch', () => {
    cache.writeCachedStack(entry(), 1_000);
    const read = cache.readCachedStack(null, 'refs/heads/a', 1_500);
    expect(read?.status.id).toBe('abc123');
    expect(read?.branchRef).toBe('refs/heads/a');
    expect(read?.services).toContain('rest');
    expect(read?.envHash).toBe('hash');
    expect(read?.heartbeatAt).toBe(1_000);
    expect(cache.readCachedStack('named', 'refs/heads/a', 1_500)).toBeNull();
  });

  it('rejects a record written for another branch, even when it is fresh', () => {
    cache.writeCachedStack(entry({ branchRef: 'refs/heads/a' }), 1_000);

    expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)?.status.id).toBe('abc123');
    // The record is otherwise trustworthy; the identity is projectRoot + branch + stackName.
    expect(cache.readCachedStack(null, 'refs/heads/b', 1_500)).toBeNull();
  });

  it('rejects a record without a branch (there is no compatibility shim)', () => {
    const legacy: Record<string, unknown> = { ...entry() };
    delete legacy.branchRef;
    writeFileSync(cacheFile, JSON.stringify({ ...legacy, heartbeatAt: 1_000 }));

    expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)).toBeNull();
  });

  it('matches a detached HEAD literally and rejects a branch/detached crossing', () => {
    cache.writeCachedStack(entry({ branchRef: 'detached' }), 1_000);
    expect(cache.readCachedStack(null, 'detached', 1_500)?.status.id).toBe('abc123');
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)).toBeNull();

    cache.writeCachedStack(entry({ branchRef: 'refs/heads/a' }), 1_000);
    expect(cache.readCachedStack(null, 'detached', 1_500)).toBeNull();
  });

  it('expires after the TTL (default 120 s) and never trusts a future heartbeat', () => {
    cache.writeCachedStack(entry(), 1_000);
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_000 + 119_000)).not.toBeNull();
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_000 + 120_001)).toBeNull();
    // An explicit ttl overrides the default.
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_200, 500)).not.toBeNull();
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_501, 500)).toBeNull();
    // A clock that jumped backwards must not extend the record's life.
    expect(cache.readCachedStack(null, 'refs/heads/a', 999_000)).toBeNull();
  });

  it('ignores a record made for another checkout', () => {
    cache.writeCachedStack(entry({ projectRoot: '/somewhere/else' }), 1_000);
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)).toBeNull();
  });

  it('refuses a symlinked record', () => {
    const target = join(stateDir, 'elsewhere.json');
    writeFileSync(target, JSON.stringify({ ...entry(), heartbeatAt: 1_000 }));
    symlinkSync(target, cacheFile);

    expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)).toBeNull();
  });

  it.each(['{not json', '[]', 'null', '"text"'])(
    'returns null for a non-record payload (%s)',
    (raw) => {
      writeFileSync(cacheFile, raw);

      expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)).toBeNull();
    },
  );

  it.each([
    ['status is null', { status: null }],
    ['status is not an object', { status: 'running' }],
    ['ports are missing', { status: { ...entry().status, ports: null } }],
    [
      'API port is not a number',
      { status: { ...entry().status, ports: { ...PORTS, api: '21001' } } },
    ],
    ['envHash is not a string', { envHash: 42 }],
    ['branchRef is not a string', { branchRef: 42 }],
    ['appUrl is not a string', { appUrl: null }],
    ['heartbeatAt is not a number', { heartbeatAt: '1000' }],
    ['services is not an array', { services: { rest: true } }],
  ])('returns null when %s', (_label, overrides) => {
    writeFileSync(
      cacheFile,
      JSON.stringify({ ...entry(), heartbeatAt: 1_000, ...(overrides as Record<string, unknown>) }),
    );

    expect(cache.readCachedStack(null, 'refs/heads/a', 1_500)).toBeNull();
  });

  it('is removable and tolerates a missing file', () => {
    cache.removeCachedStack();
    expect(cache.readCachedStack(null, 'refs/heads/a')).toBeNull();
    cache.writeCachedStack(entry(), 1_000);
    cache.removeCachedStack();
    expect(cache.readCachedStack(null, 'refs/heads/a', 1_100)).toBeNull();
  });
});
