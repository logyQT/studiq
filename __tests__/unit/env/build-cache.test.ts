import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';
import { REPO_ROOT as REPO_ROOT_FOR_TEST, parseJsonObject } from '#test/unit/env/support';

interface Identity {
  turbopackDir: string | null;
  next: string | null;
  bun: string | null;
  node: string | null;
  typescript: string | null;
  lockfile: string | null;
  mode: string;
  scope: string;
  envHash: string | null;
}

interface Record {
  commit: string | null;
  dirty: boolean;
  behindCommits: number | null;
}

interface Manifest {
  schema: 1;
  complete: boolean;
  identity: Identity;
  record: Record;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
}

interface Paths {
  root: string;
  snapshots: string;
  staging: string;
  pointer: string;
  retired: string;
  lastPublish: string;
}

interface Staged {
  dir: string;
  sizeBytes: number;
  fileCount: number;
  identity: Identity;
  prunedForeign: string[];
}

type PublishResult =
  | { published: true; id: string; sizeBytes: number; fileCount: number }
  | { published: false; reason: string };

interface Gates {
  primary: boolean;
  branch: string | null;
  head: string | null;
  originMain: string | null;
  clean: boolean;
  buildOk: boolean;
  artifactPresent: boolean;
  webPid: number | null;
}

type SeedResult =
  | { status: 'seeded'; id: string; fileCount: number; sizeBytes: number }
  | { status: 'skipped'; reason: string }
  | { status: 'refused'; reason: string };

interface CacheModule {
  SNAPSHOT_SCOPE: string;
  RETENTION_GRACE_MS: number;
  resolveCacheDir(env?: NodeJS.ProcessEnv): string;
  checkCacheRoot(
    root: string,
    repoRoot?: string,
    options?: { create?: boolean; rejectInside?: readonly string[]; uid?: number },
  ): string | null;
  cachePaths(root: string): Paths;
  compareIdentity(live: Identity, recorded: Identity): string | null;
  identityGaps(identity: Identity): string[];
  lockfileTypescript(text: string): string | null;
  cacheMaxBytes(env?: NodeJS.ProcessEnv): number;
  pruneForeignVersions(
    turbopackDir: string,
    nextVersion: string,
    keepDirectory?: string | null,
  ): string[];
  classifyCacheLayout(cacheDir: string): {
    entries: string[];
    allowlisted: string[];
    known: string[];
    unknown: string[];
    turbopackDirs: string[];
  } | null;
  cacheLayoutRecognised(layout: unknown): boolean;
  knownCacheExclusionLabels(): string[];
  worktreeCacheDir(repoRoot?: string, env?: NodeJS.ProcessEnv): string;
  isWithin(path: string, root: string): boolean;
  stageSnapshot(input: {
    cacheRoot: string;
    worktreeCacheDir: string;
    identity: Identity;
    nextVersion: string;
    deps?: { freeBytes?: () => number | null; copyTree?: (src: string, dest: string) => boolean };
  }): Promise<{ staged: Staged } | { skipped: string }>;
  publishSnapshot(input: {
    cacheRoot: string;
    staged: Staged;
    record: Record;
    gates: Gates;
    now?: number;
    maxBytes?: number;
  }): PublishResult;
  readCurrentSnapshotId(cacheRoot: string): string | null;
  readSnapshotStatus(options?: { cacheDir?: string; now?: number }): {
    id: string;
    sizeBytes: number | null;
    fileCount: number | null;
    commit: string | null;
    ageDays: number | null;
    behindCommits: number | null;
    turbopack: string[] | null;
    warnings: string[];
  } | null;
  readLastPublish(cacheDir: string): { outcome: string; reason: string | null } | null;
  seedWorktreeCache(input: {
    worktreeRoot: string;
    cacheRoot: string;
    cacheDir?: string;
    envHash?: string | null;
    deps?: {
      identity?: (worktreeRoot: string) => Promise<Identity>;
      copyTree?: (src: string, dest: string) => boolean;
      freeBytes?: (path: string) => number | null;
    };
  }): Promise<SeedResult>;
}

const cache = await loadEnvModule<CacheModule>('lib/build-cache.ts');

const TEMP_TURBOPACK = 'v16.4.5-4e5335a0';
const CANARY_TURBOPACK = 'v16.5.0-canary3abc';
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'studiq-cache-test-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    turbopackDir: TEMP_TURBOPACK,
    next: '16.4.5',
    bun: '1.4.4',
    node: null,
    typescript: '7.0.2',
    lockfile: 'lock-sha',
    mode: 'production',
    scope: cache.SNAPSHOT_SCOPE,
    envHash: 'env-sha',
    ...overrides,
  };
}

const record: Record = { commit: 'abc123', dirty: false, behindCommits: 0 };

function passingGates(overrides: Partial<Gates> = {}): Gates {
  return {
    primary: true,
    branch: 'main',
    head: 'a'.repeat(40),
    originMain: 'a'.repeat(40),
    clean: true,
    buildOk: true,
    artifactPresent: true,
    webPid: null,
    ...overrides,
  };
}

/**
 * A published snapshot written by hand, with the manifest's counts spelled out
 * rather than measured: the seed's verification must agree with these numbers,
 * so a measurement bug shows up as a refusal instead of cancelling itself out.
 */
function writeSnapshot(
  cacheRoot: string,
  options: {
    id?: string;
    identity?: Identity;
    record?: Record;
    createdAt?: string;
    complete?: boolean;
    manifest?: string | null;
    sizeBytes?: number;
    fileCount?: number;
    extra?: string[];
  } = {},
): { id: string; dir: string } {
  const paths = cache.cachePaths(cacheRoot);
  const id = options.id ?? '20260101T000000Z-aaaaaaaa';
  const dir = join(paths.snapshots, id);
  mkdirSync(join(dir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
  writeFileSync(join(dir, 'turbopack', TEMP_TURBOPACK, 'file-1.bin'), 'abcd');
  writeFileSync(join(dir, 'turbopack', TEMP_TURBOPACK, 'file-2.bin'), 'ef');
  for (const name of options.extra ?? []) writeFileSync(join(dir, name), 'x');
  const manifest: Manifest = {
    schema: 1,
    complete: options.complete ?? true,
    identity: options.identity ?? identity(),
    record: options.record ?? record,
    sizeBytes: options.sizeBytes ?? 6,
    fileCount: options.fileCount ?? 2,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  if (options.manifest !== null) {
    writeFileSync(join(dir, 'manifest.json'), options.manifest ?? `${JSON.stringify(manifest)}\n`);
  }
  mkdirSync(paths.snapshots, { recursive: true });
  writeFileSync(paths.pointer, `${id}\n`);
  writeFileSync(paths.retired, '{}\n');
  return { id, dir };
}

/**
 * A fresh worktree: `apps/web` exists and `.next` does not.
 *
 * No `.next` on purpose — that is the state `scripts/spin` leaves a new worktree
 * in, and the free-space preflight still has to find a filesystem to ask.
 */
function writeWorktree(options: { bunLock?: string } = {}): string {
  const root = tempRoot();
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(
    join(root, 'bun.lock'),
    options.bunLock ?? '"typescript": ["typescript@7.0.2", "", {}],\n',
  );
  return root;
}

async function seedFromCache(
  cacheRoot: string,
  worktreeRoot: string,
  overrides: Partial<Parameters<CacheModule['seedWorktreeCache']>[0]> = {},
): Promise<SeedResult> {
  return cache.seedWorktreeCache({
    worktreeRoot,
    cacheRoot,
    deps: { identity: () => Promise.resolve(identity()) },
    ...overrides,
  });
}

function staged(dir: string, overrides: Partial<Staged> = {}): Staged {
  return { dir, sizeBytes: 6, fileCount: 2, identity: identity(), prunedForeign: [], ...overrides };
}

describe('cache identity', () => {
  it('refuses every match component that differs, naming it', () => {
    const fields: Array<keyof Identity> = [
      'scope',
      'mode',
      'turbopackDir',
      'next',
      'bun',
      'node',
      'typescript',
      'lockfile',
    ];
    for (const field of fields) {
      const live = identity({
        [field]: field === 'node' ? '20.0.0' : 'different',
      });
      const reason = cache.compareIdentity(live, identity());
      expect(reason, field).toContain(`${field} mismatch`);
    }
  });

  it('never accepts a version prefix for the Turbopack directory name', () => {
    const reason = cache.compareIdentity(
      identity({ turbopackDir: 'v16.4.5' }),
      identity({ turbopackDir: TEMP_TURBOPACK }),
    );
    expect(reason).toContain('turbopackDir mismatch');
  });

  it('never blocks on a record-role field', () => {
    const live = identity({ envHash: 'another-env' });
    expect(cache.compareIdentity(live, identity({ envHash: 'env-sha' }))).toBeNull();
    expect(cache.compareIdentity(identity(), identity({ envHash: 'the-producer-env' }))).toBeNull();
  });

  it('reports unresolved match components instead of guessing them', () => {
    expect(cache.identityGaps(identity({ turbopackDir: null, typescript: null }))).toEqual([
      'turbopackDir',
      'typescript',
    ]);
  });

  it('reads the resolved typescript version from the lockfile, not a range', () => {
    const text = [
      '    "typescript": "^7.0.2",',
      '    "typescript": ["typescript@7.0.3", "", {}],',
    ].join('\n');
    expect(cache.lockfileTypescript(text)).toBe('7.0.3');
    expect(cache.lockfileTypescript('    "typescript": "^7.0.2",')).toBeNull();
  });
});

describe('snapshot publication', () => {
  it('publishes with a complete manifest and a pointer swap', () => {
    const cacheRoot = tempRoot();
    const staging = join(cache.cachePaths(cacheRoot).staging, '4242-aaaa');
    mkdirSync(join(staging, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    writeFileSync(join(staging, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');

    const result = cache.publishSnapshot({
      cacheRoot,
      staged: staged(staging, { sizeBytes: 4, fileCount: 1 }),
      record,
      gates: passingGates(),
      now: Date.parse('2026-11-17T12:00:00Z'),
    });

    expect(result.published).toBe(true);
    if (!result.published) return;
    const paths = cache.cachePaths(cacheRoot);
    expect(readFileSync(paths.pointer, 'utf8').trim()).toBe(result.id);
    const manifest = parseJsonObject(
      readFileSync(join(paths.snapshots, result.id, 'manifest.json'), 'utf8'),
    );
    expect(manifest['complete']).toBe(true);
    expect(manifest['sizeBytes']).toBe(4);
    expect(manifest['fileCount']).toBe(1);
    expect(manifest['record']).toEqual(record);
    expect(readdirSync(paths.snapshots).some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(cache.readLastPublish(cacheRoot)?.outcome).toBe('published');
  });

  const gateCases: Array<[string, Partial<Gates>, string]> = [
    ['not the primary checkout', { primary: false }, 'primary checkout'],
    ['detached HEAD', { branch: null }, 'detached HEAD'],
    ['HEAD not origin/main', { head: 'b'.repeat(40) }, 'not the last fetched origin/main'],
    ['origin/main unavailable', { originMain: null }, 'origin/main is unavailable'],
    ['dirty tree', { clean: false }, 'working tree is dirty'],
    ['a failed build', { buildOk: false }, 'did not succeed'],
    ['no BUILD_ID', { artifactPresent: false }, 'BUILD_ID is missing'],
    ['a running web server', { webPid: 4242 }, 'web server (pid 4242)'],
  ];

  for (const [name, override, expected] of gateCases) {
    it(`refuses to publish for ${name} and keeps the previous snapshot`, () => {
      const cacheRoot = tempRoot();
      const previous = writeSnapshot(cacheRoot, { id: '20260101T000000Z-previous00' });
      const staging = join(cache.cachePaths(cacheRoot).staging, '4343-bbbb');
      mkdirSync(join(staging, 'turbopack', TEMP_TURBOPACK), { recursive: true });
      writeFileSync(join(staging, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');

      const result = cache.publishSnapshot({
        cacheRoot,
        staged: staged(staging, { sizeBytes: 4, fileCount: 1 }),
        record,
        gates: passingGates(override),
      });

      expect(result.published).toBe(false);
      if (result.published) return;
      expect(result.reason).toContain(expected);
      const paths = cache.cachePaths(cacheRoot);
      expect(readFileSync(paths.pointer, 'utf8').trim()).toBe(previous.id);
      expect(existsSync(join(paths.snapshots, previous.id))).toBe(true);
      expect(existsSync(staging)).toBe(false);
      expect(cache.readLastPublish(cacheRoot)?.outcome).toBe('refused');
    });
  }

  it('refuses a body that does not match its manifest', () => {
    const cacheRoot = tempRoot();
    const staging = join(cache.cachePaths(cacheRoot).staging, '4444-cccc');
    mkdirSync(join(staging, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    writeFileSync(join(staging, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');

    const result = cache.publishSnapshot({
      cacheRoot,
      staged: staged(staging, { sizeBytes: 999, fileCount: 1 }),
      record,
      gates: passingGates(),
    });

    expect(result.published).toBe(false);
    if (!result.published) expect(result.reason).toContain('does not match its manifest');
  });

  it('refuses an over-cap snapshot and keeps the previous one', () => {
    const cacheRoot = tempRoot();
    const previous = writeSnapshot(cacheRoot, { id: '20260101T000000Z-previous01' });
    const staging = join(cache.cachePaths(cacheRoot).staging, '4545-dddd');
    mkdirSync(join(staging, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    writeFileSync(join(staging, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');

    const result = cache.publishSnapshot({
      cacheRoot,
      staged: staged(staging, { sizeBytes: 4, fileCount: 1 }),
      record,
      gates: passingGates(),
      maxBytes: 1,
    });

    expect(result.published).toBe(false);
    if (!result.published) expect(result.reason).toContain('over the');
    expect(readFileSync(cache.cachePaths(cacheRoot).pointer, 'utf8').trim()).toBe(previous.id);
    expect(cache.readLastPublish(cacheRoot)?.reason).toContain('over the');
  });

  it('keeps one retired predecessor past the grace and deletes the older one', () => {
    const cacheRoot = tempRoot();
    const paths = cache.cachePaths(cacheRoot);
    const t0 = Date.parse('2026-11-17T12:00:00Z');
    const make = (nonce: string, now: number): void => {
      const dir = join(paths.staging, `5555-${nonce}`);
      mkdirSync(join(dir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
      writeFileSync(join(dir, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');
      const result = cache.publishSnapshot({
        cacheRoot,
        staged: staged(dir, { sizeBytes: 4, fileCount: 1 }),
        record,
        gates: passingGates(),
        now,
      });
      expect(result.published).toBe(true);
    };

    make('a', t0);
    const first = cache.readCurrentSnapshotId(cacheRoot);
    expect(first).not.toBeNull();
    if (first === null) return;
    make('b', t0 + 60_000);
    const second = cache.readCurrentSnapshotId(cacheRoot);
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(second).not.toBe(first);
    expect(existsSync(join(paths.snapshots, first))).toBe(true);

    // A seed that read the pointer before the swap still finds its directory.
    make('c', t0 + 60_000 + cache.RETENTION_GRACE_MS + 60_000);
    expect(existsSync(join(paths.snapshots, first))).toBe(false);
    expect(existsSync(join(paths.snapshots, second))).toBe(true);
    expect(readdirSync(paths.snapshots).filter((name) => name.startsWith('2026'))).toHaveLength(2);
  });
});

/** A realistic `.next/cache`: the allowlisted root plus all three known exclusions. */
function cacheTree(): string {
  const root = tempRoot();
  const cacheDir = join(root, '.next', 'cache');
  mkdirSync(join(cacheDir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
  writeFileSync(join(cacheDir, 'turbopack', TEMP_TURBOPACK, 'keep.bin'), 'abcd');
  mkdirSync(join(cacheDir, 'fetch-cache'), { recursive: true });
  writeFileSync(join(cacheDir, 'fetch-cache', 'font.json'), 'not copied');
  writeFileSync(join(cacheDir, 'config.json'), '{"anonymousId":"x"}');
  writeFileSync(join(cacheDir, '.tsbuildinfo'), 'ts');
  return cacheDir;
}

describe('snapshot staging', () => {
  it('copies the allowlist only', async () => {
    const worktreeCacheDir = cacheTree();
    const cacheRoot = tempRoot();
    const result = await cache.stageSnapshot({
      cacheRoot,
      worktreeCacheDir,
      identity: identity(),
      nextVersion: '16.4.5',
    });
    expect('staged' in result).toBe(true);
    if (!('staged' in result)) return;
    expect(readdirSync(result.staged.dir)).toEqual(['turbopack']);
    expect(result.staged.fileCount).toBe(1);
    expect(result.staged.sizeBytes).toBe(4);
    expect(existsSync(join(result.staged.dir, 'fetch-cache'))).toBe(false);
    expect(existsSync(join(result.staged.dir, 'config.json'))).toBe(false);
    expect(existsSync(join(result.staged.dir, '.tsbuildinfo'))).toBe(false);
  });

  it('prunes a foreign version directory from the staging copy', async () => {
    const worktreeCacheDir = cacheTree();
    mkdirSync(join(worktreeCacheDir, 'turbopack', 'v16.4.3-b175f52b'), { recursive: true });
    writeFileSync(join(worktreeCacheDir, 'turbopack', 'v16.4.3-b175f52b', 'old.bin'), 'old');
    const result = await cache.stageSnapshot({
      cacheRoot: tempRoot(),
      worktreeCacheDir,
      identity: identity(),
      nextVersion: '16.4.5',
    });
    expect('staged' in result).toBe(true);
    if (!('staged' in result)) return;
    expect(result.staged.prunedForeign).toEqual(['v16.4.3-b175f52b']);
    expect(readdirSync(join(result.staged.dir, 'turbopack'))).toEqual([TEMP_TURBOPACK]);
  });

  it('skips an unrecognised cache root without copying anything', async () => {
    const worktreeCacheDir = cacheTree();
    writeFileSync(join(worktreeCacheDir, 'unknown-entry'), 'x');
    const cacheRoot = tempRoot();
    const result = await cache.stageSnapshot({
      cacheRoot,
      worktreeCacheDir,
      identity: identity(),
      nextVersion: '16.4.5',
    });
    expect(result).toHaveProperty('skipped');
    if (!('skipped' in result)) return;
    expect(result.skipped).toContain('unrecognised');
    expect(existsSync(join(cache.cachePaths(cacheRoot).staging))).toBe(false);
  });

  it('writes nothing when the free-space preflight fails', async () => {
    const cacheRoot = tempRoot();
    const result = await cache.stageSnapshot({
      cacheRoot,
      worktreeCacheDir: cacheTree(),
      identity: identity(),
      nextVersion: '16.4.5',
      deps: { freeBytes: () => 1 },
    });
    expect('skipped' in result).toBe(true);
    if (!('skipped' in result)) return;
    expect(result.skipped).toContain('not enough free space');
    expect(existsSync(join(cache.cachePaths(cacheRoot).staging))).toBe(false);
  });
});

describe('cache layout reporting', () => {
  it('names the known exclusions and flags an unknown entry', () => {
    const root = tempRoot();
    const cacheDir = join(root, 'cache');
    mkdirSync(join(cacheDir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    mkdirSync(join(cacheDir, 'fetch-cache'));
    writeFileSync(join(cacheDir, 'config.json'), '{}');
    writeFileSync(join(cacheDir, '.tsbuildinfo'), '');
    // Next names its telemetry batches `_events_<pid>_<hex>.json`; a dev server
    // or a build leaves one behind and it is not cache identity.
    writeFileSync(join(cacheDir, '_events_4242_0487b99c35c29ae3.json'), '[]');
    const layout = cache.classifyCacheLayout(cacheDir);
    expect(layout?.known.toSorted()).toEqual([
      '.tsbuildinfo',
      '_events_4242_0487b99c35c29ae3.json',
      'config.json',
      'fetch-cache',
    ]);
    expect(layout?.unknown).toEqual([]);
    expect(layout?.turbopackDirs).toEqual([TEMP_TURBOPACK]);
    expect(cache.cacheLayoutRecognised(layout)).toBe(true);

    writeFileSync(join(cacheDir, 'surprise'), '');
    const unknown = cache.classifyCacheLayout(cacheDir);
    expect(unknown?.unknown).toEqual(['surprise']);
    expect(cache.cacheLayoutRecognised(unknown)).toBe(false);
  });

  it('applies every exclusion it advertises', () => {
    const cacheDir = join(tempRoot(), 'cache');
    mkdirSync(join(cacheDir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    // A label's `*` stands for the part that varies; a name of that shape must be
    // classified as known, or doctor advertises an exclusion it does not apply.
    const names = cache
      .knownCacheExclusionLabels()
      .map((label) => label.replace('*', '4242_0487b99c35c29ae3'));
    for (const name of names) writeFileSync(join(cacheDir, name), '');
    const layout = cache.classifyCacheLayout(cacheDir);
    expect(layout?.known.toSorted()).toEqual(names.toSorted());
    expect(layout?.unknown).toEqual([]);
  });

  it('excludes only Next’s batch shape, not every name starting with _events_', () => {
    const cacheDir = join(tempRoot(), 'cache');
    mkdirSync(join(cacheDir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    writeFileSync(join(cacheDir, '_events_notes.txt'), '');
    const layout = cache.classifyCacheLayout(cacheDir);
    expect(layout?.known).toEqual([]);
    expect(layout?.unknown).toEqual(['_events_notes.txt']);
    expect(cache.cacheLayoutRecognised(layout)).toBe(false);
  });

  it('treats a cache root without turbopack/ as unrecognised', () => {
    const cacheDir = join(tempRoot(), 'cache');
    mkdirSync(cacheDir);
    writeFileSync(join(cacheDir, 'config.json'), '{}');
    expect(cache.cacheLayoutRecognised(cache.classifyCacheLayout(cacheDir))).toBe(false);
    expect(cache.classifyCacheLayout(join(tempRoot(), 'absent'))).toBeNull();
  });
});

describe('cache root trust', () => {
  it('refuses a root inside or above the repository, and a symlink', () => {
    const repo = tempRoot();
    expect(cache.checkCacheRoot(join(repo, '.cache'), repo)).toContain(
      'inside (or an ancestor of)',
    );
    expect(cache.checkCacheRoot(join(repo, '..'), repo)).toContain('inside (or an ancestor of)');
    const root = tempRoot();
    const link = join(tempRoot(), 'link');
    mkdirSync(join(link, '..'), { recursive: true });
    const target = join(root, 'real');
    mkdirSync(target, { mode: 0o700 });
    try {
      symlinkSync(target, link);
    } catch {
      return; // a platform without symlink permission: the containment cases still ran
    }
    expect(cache.checkCacheRoot(link, repo)).toContain('symlink');
  });

  it('refuses a root owned by another user, read-only included', () => {
    const root = tempRoot();
    const repo = tempRoot();
    const foreignUid = (process.getuid?.() ?? 1000) + 1;

    // A mode-700 directory owned by someone else is not trusted: the read paths
    // (seed, doctor) must refuse rather than report "no snapshot".
    expect(cache.checkCacheRoot(root, repo, { create: false, uid: foreignUid })).toContain(
      'not owned by this user',
    );
    expect(cache.checkCacheRoot(root, repo, { uid: foreignUid })).toContain(
      'not owned by this user',
    );
    expect(cache.checkCacheRoot(root, repo, { create: false })).toBeNull();
  });

  it('resolves STUDIQ_CACHE_DIR and falls back to XDG_CACHE_HOME', () => {
    const explicit = cache.resolveCacheDir({ STUDIQ_CACHE_DIR: '/tmp/explicit-cache' });
    expect(explicit).toBe('/tmp/explicit-cache');
    const xdg = cache.resolveCacheDir({ XDG_CACHE_HOME: '/tmp/xdg-cache' });
    expect(xdg).toBe('/tmp/xdg-cache/studiq');
    const home = cache.resolveCacheDir({ HOME: '/tmp/home-dir' });
    expect(home).toBe('/tmp/home-dir/.cache/studiq');
  });
});

describe('seeding a worktree', () => {
  it('seeds a matching snapshot into an absent cache and leaves no temp directory', async () => {
    const cacheRoot = tempRoot();
    const { id } = writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(result).toEqual({ status: 'seeded', id, fileCount: 2, sizeBytes: 6 });
    const cacheDir = join(worktreeRoot, 'apps', 'web', '.next', 'cache');
    expect(readdirSync(cacheDir)).toEqual(['turbopack']);
    expect(readFileSync(join(cacheDir, 'turbopack', TEMP_TURBOPACK, 'file-1.bin'), 'utf8')).toBe(
      'abcd',
    );
    expect(readdirSync(join(worktreeRoot, 'apps', 'web', '.next'))).toEqual(['cache']);
  });

  it('skips every mismatched match component', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot, {
      deps: { identity: () => Promise.resolve(identity({ next: '16.4.6' })) },
    });

    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.reason).toContain('next mismatch');
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next', 'cache'))).toBe(false);
  });

  it('seeds when only record-role fields differ', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, {
      identity: identity({ envHash: 'producer-env' }),
      record: { commit: 'old', dirty: true, behindCommits: 120 },
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot, {
      envHash: 'this-checkout-env',
    });

    expect(result.status).toBe('seeded');
  });

  it('never overwrites an existing cache', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();
    const cacheDir = join(worktreeRoot, 'apps', 'web', '.next', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'sentinel'), 'mine');

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(result.status).toBe('skipped');
    expect(readdirSync(cacheDir)).toEqual(['sentinel']);
  });

  it('retires an incomplete snapshot and writes nothing', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, { complete: false });
    const worktreeRoot = writeWorktree();

    const first = await seedFromCache(cacheRoot, worktreeRoot);
    const second = await seedFromCache(cacheRoot, worktreeRoot);

    expect(first.status).toBe('skipped');
    if (first.status === 'skipped') expect(first.reason).toContain('not complete');
    expect(cache.readCurrentSnapshotId(cacheRoot)).toBeNull();
    if (second.status === 'skipped') expect(second.reason).toContain('no published snapshot');
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next', 'cache'))).toBe(false);
  });

  it('retires a corrupt manifest and writes nothing', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, { manifest: 'not json' });
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(result.status).toBe('skipped');
    expect(cache.readCurrentSnapshotId(cacheRoot)).toBeNull();
  });

  it('retires a snapshot whose body does not match its manifest', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, { sizeBytes: 999 });
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('does not match its manifest');
    expect(cache.readCurrentSnapshotId(cacheRoot)).toBeNull();
  });

  it('leaves no cache when the copy fails', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot, {
      deps: { identity: () => Promise.resolve(identity()), copyTree: () => false },
    });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('copy failed');
    const nextDir = join(worktreeRoot, 'apps', 'web', '.next');
    expect(readdirSync(nextDir)).toEqual([]);
  });

  it('keeps the worktree cache when the rename loses a race', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();
    const cacheDir = join(worktreeRoot, 'apps', 'web', '.next', 'cache');

    const result = await seedFromCache(cacheRoot, worktreeRoot, {
      deps: {
        identity: () => Promise.resolve(identity()),
        // Another process publishes `.next/cache` while this copy runs.
        copyTree: (src, dest) => {
          mkdirSync(join(dest, 'turbopack', TEMP_TURBOPACK), { recursive: true });
          writeFileSync(join(dest, 'turbopack', TEMP_TURBOPACK, 'file-1.bin'), 'abcd');
          writeFileSync(join(dest, 'turbopack', TEMP_TURBOPACK, 'file-2.bin'), 'ef');
          mkdirSync(cacheDir, { recursive: true });
          writeFileSync(join(cacheDir, 'theirs'), 'x');
          return true;
        },
      },
    });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('another process');
    expect(readdirSync(cacheDir)).toEqual(['theirs']);
    expect(readdirSync(join(worktreeRoot, 'apps', 'web', '.next'))).toEqual(['cache']);
  });

  it('skips when free space is short, writing nothing', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot, {
      deps: { identity: () => Promise.resolve(identity()), freeBytes: () => 1 },
    });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('not enough free space');
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next'))).toBe(false);
  });

  it('refuses a cache root inside the worktree and writes nothing', async () => {
    const worktreeRoot = writeWorktree();
    const result = await cache.seedWorktreeCache({
      worktreeRoot,
      cacheRoot: join(worktreeRoot, '.cache'),
      deps: { identity: () => Promise.resolve(identity()) },
    });
    expect(result.status).toBe('refused');
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next'))).toBe(false);
    expect(existsSync(join(worktreeRoot, '.cache'))).toBe(false);
  });

  it('removes a stale seed temp directory whose owner is gone', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();
    const nextDir = join(worktreeRoot, 'apps', 'web', '.next');
    const stale = join(nextDir, 'cache.seed-999999-dead');
    mkdirSync(stale, { recursive: true });
    utimesSync(stale, new Date(0), new Date(0));

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(result.status).toBe('seeded');
    expect(existsSync(stale)).toBe(false);
    expect(readdirSync(nextDir)).toEqual(['cache']);
  });
});

describe('foreign-version pruning', () => {
  it('compares the numeric prefix, so a pre-release keeps its live cache', () => {
    const turbopackDir = join(tempRoot(), 'turbopack');
    mkdirSync(join(turbopackDir, CANARY_TURBOPACK), { recursive: true });
    mkdirSync(join(turbopackDir, TEMP_TURBOPACK), { recursive: true });

    const removed = cache.pruneForeignVersions(turbopackDir, '16.5.0-canary.3');

    expect(removed).toEqual([TEMP_TURBOPACK]);
    expect(existsSync(join(turbopackDir, CANARY_TURBOPACK))).toBe(true);
  });

  it('never removes the directory the installed Next resolved', () => {
    const make = (): string => {
      const dir = join(tempRoot(), 'turbopack');
      mkdirSync(join(dir, CANARY_TURBOPACK), { recursive: true });
      mkdirSync(join(dir, TEMP_TURBOPACK), { recursive: true });
      return dir;
    };

    const canaryKept = make();
    expect(cache.pruneForeignVersions(canaryKept, '16.5.0-canary.3', CANARY_TURBOPACK)).toEqual([
      TEMP_TURBOPACK,
    ]);

    // A name the comparison would prune still survives when it is the resolved one.
    const olderKept = make();
    expect(cache.pruneForeignVersions(olderKept, '16.5.0-canary.3', TEMP_TURBOPACK)).toEqual([]);
    expect(existsSync(join(olderKept, TEMP_TURBOPACK))).toBe(true);
  });

  it('removes nothing when the installed version cannot be parsed', () => {
    const turbopackDir = join(tempRoot(), 'turbopack');
    mkdirSync(join(turbopackDir, TEMP_TURBOPACK), { recursive: true });
    expect(cache.pruneForeignVersions(turbopackDir, 'not-a-version')).toEqual([]);
    expect(existsSync(join(turbopackDir, TEMP_TURBOPACK))).toBe(true);
  });

  it('stages, publishes and seeds a pre-release cache with files', async () => {
    const cacheRoot = tempRoot();
    const worktreeCacheDir = join(tempRoot(), '.next', 'cache');
    mkdirSync(join(worktreeCacheDir, 'turbopack', CANARY_TURBOPACK), { recursive: true });
    writeFileSync(join(worktreeCacheDir, 'turbopack', CANARY_TURBOPACK, 'live.bin'), 'abcd');
    mkdirSync(join(worktreeCacheDir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    writeFileSync(join(worktreeCacheDir, 'turbopack', TEMP_TURBOPACK, 'old.bin'), 'old');
    const canary = identity({ turbopackDir: CANARY_TURBOPACK, next: '16.5.0-canary.3' });

    const copy = await cache.stageSnapshot({
      cacheRoot,
      worktreeCacheDir,
      identity: canary,
      nextVersion: '16.5.0-canary.3',
    });
    expect('staged' in copy).toBe(true);
    if (!('staged' in copy)) return;
    expect(copy.staged.prunedForeign).toEqual([TEMP_TURBOPACK]);
    expect(copy.staged.fileCount).toBe(1);
    expect(readdirSync(join(copy.staged.dir, 'turbopack'))).toEqual([CANARY_TURBOPACK]);

    const published = cache.publishSnapshot({
      cacheRoot,
      staged: copy.staged,
      record,
      gates: passingGates(),
      now: Date.parse('2026-11-17T12:00:00Z'),
    });
    expect(published.published).toBe(true);
    if (!published.published) return;
    expect(published.fileCount).toBe(1);

    const worktreeRoot = writeWorktree();
    const seeded = await cache.seedWorktreeCache({
      worktreeRoot,
      cacheRoot,
      deps: { identity: () => Promise.resolve(canary) },
    });
    expect(seeded).toEqual({
      status: 'seeded',
      id: published.id,
      fileCount: 1,
      sizeBytes: 4,
    });
    expect(
      existsSync(
        join(
          worktreeRoot,
          'apps',
          'web',
          '.next',
          'cache',
          'turbopack',
          CANARY_TURBOPACK,
          'live.bin',
        ),
      ),
    ).toBe(true);
  });
});

describe('empty snapshot bodies', () => {
  it('skips a staging copy with no files', async () => {
    const worktreeCacheDir = join(tempRoot(), '.next', 'cache');
    mkdirSync(join(worktreeCacheDir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    const cacheRoot = tempRoot();

    const result = await cache.stageSnapshot({
      cacheRoot,
      worktreeCacheDir,
      identity: identity(),
      nextVersion: '16.4.5',
    });

    expect('skipped' in result).toBe(true);
    if (!('skipped' in result)) return;
    expect(result.skipped).toContain('empty');
    expect(readdirSync(cache.cachePaths(cacheRoot).staging)).toEqual([]);
  });

  it('refuses to publish an empty body', () => {
    const cacheRoot = tempRoot();
    const staging = join(cache.cachePaths(cacheRoot).staging, '4646-eeee');
    mkdirSync(join(staging, 'turbopack', TEMP_TURBOPACK), { recursive: true });

    const result = cache.publishSnapshot({
      cacheRoot,
      staged: staged(staging, { sizeBytes: 0, fileCount: 0 }),
      record,
      gates: passingGates(),
    });

    expect(result.published).toBe(false);
    if (!result.published) expect(result.reason).toContain('empty');
    expect(cache.readCurrentSnapshotId(cacheRoot)).toBeNull();
  });
});

describe('retention is bounded', () => {
  it('keeps exactly the current snapshot and one retired predecessor', () => {
    const cacheRoot = tempRoot();
    const paths = cache.cachePaths(cacheRoot);
    const t0 = Date.parse('2026-11-17T12:00:00Z');
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const dir = join(paths.staging, `6666-${index}`);
      mkdirSync(join(dir, 'turbopack', TEMP_TURBOPACK), { recursive: true });
      writeFileSync(join(dir, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');
      const result = cache.publishSnapshot({
        cacheRoot,
        staged: staged(dir, { sizeBytes: 4, fileCount: 1 }),
        record,
        gates: passingGates(),
        now: t0 + index * 60_000,
      });
      expect(result.published).toBe(true);
      if (result.published) ids.push(result.id);
    }

    const trees = readdirSync(paths.snapshots).filter((name) => name.startsWith('2026'));
    expect(trees).toHaveLength(2);
    expect(trees).toContain(ids.at(-1));
    expect(trees).toContain(ids.at(-2));
    const retired = parseJsonObject(readFileSync(paths.retired, 'utf8'));
    expect(Object.keys(retired)).toEqual([ids.at(-2)]);
    expect(typeof retired[ids.at(-2) ?? '']).toBe('string');
    expect(readFileSync(paths.pointer, 'utf8').trim()).toBe(ids.at(-1));
  });
});

describe('the read seam', () => {
  it('resolves the default cache and both override forms', () => {
    expect(cache.worktreeCacheDir('/repo')).toBe('/repo/apps/web/.next/cache');
    expect(cache.worktreeCacheDir('/repo', { STUDIQ_WORKTREE_CACHE_DIR: 'fixtures/cache' })).toBe(
      '/repo/fixtures/cache',
    );
    expect(cache.worktreeCacheDir('/repo', { STUDIQ_WORKTREE_CACHE_DIR: '/elsewhere/cache' })).toBe(
      '/elsewhere/cache',
    );
  });

  it('places a path by real location, not by string prefix', () => {
    const root = tempRoot();
    expect(cache.isWithin(join(root, 'apps', 'web', '.next', 'cache'), root)).toBe(true);
    expect(cache.isWithin(root, root)).toBe(true);
    expect(cache.isWithin(join(root, '..', 'sibling'), root)).toBe(false);
    // A shared prefix is not containment: `/root-copy` is not inside `/root`.
    expect(cache.isWithin(`${root}-copy`, root)).toBe(false);

    const outside = tempRoot();
    const link = join(root, 'linked');
    try {
      symlinkSync(outside, link);
    } catch {
      return; // a platform without symlink permission: the prefix cases still ran
    }
    expect(cache.isWithin(join(link, 'cache'), root)).toBe(false);
  });
});

describe('seed containment', () => {
  it('refuses a resolved cache outside the worktree before deleting or creating anything', async () => {
    const cacheRoot = tempRoot();
    // No published snapshot: the refusal must come before the snapshot read, as
    // the delete it guards does.
    const worktreeRoot = writeWorktree();
    const outside = tempRoot();
    const cacheDir = join(outside, 'cache');
    const stale = join(outside, 'cache.seed-424242-abcd');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'operator-file'), 'keep me');

    const result = await seedFromCache(cacheRoot, worktreeRoot, { cacheDir });

    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.reason).toContain('outside');
    // Neither the stale seed directory beside the target nor the target itself.
    expect(readFileSync(join(stale, 'operator-file'), 'utf8')).toBe('keep me');
    expect(existsSync(cacheDir)).toBe(false);
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next', 'cache'))).toBe(false);
  });

  it('refuses a root inside the repository even when it seeds a sibling worktree', async () => {
    const worktreeRoot = writeWorktree();
    const inside = join(REPO_ROOT_FOR_TEST, '.tmp', 'cache-root-should-not-exist');

    const result = await cache.seedWorktreeCache({
      worktreeRoot,
      cacheRoot: inside,
      deps: { identity: () => Promise.resolve(identity()) },
    });

    expect(result.status).toBe('refused');
    if (result.status === 'refused') expect(result.reason).toContain('inside (or an ancestor of)');
    expect(existsSync(inside)).toBe(false);
  });

  it('refuses a root inside the checkout it would write into, or above it', async () => {
    const worktreeRoot = writeWorktree();
    const inside = await cache.seedWorktreeCache({
      worktreeRoot,
      cacheRoot: join(worktreeRoot, '.cache'),
      deps: { identity: () => Promise.resolve(identity()) },
    });
    expect(inside.status).toBe('refused');

    const ancestor = await cache.seedWorktreeCache({
      worktreeRoot,
      cacheRoot: join(worktreeRoot, '..'),
      deps: { identity: () => Promise.resolve(identity()) },
    });
    expect(ancestor.status).toBe('refused');
    expect(existsSync(join(worktreeRoot, '.cache'))).toBe(false);
  });

  it('rejects a root inside every checkout it is told about', () => {
    const first = tempRoot();
    const sibling = tempRoot();
    const reason = cache.checkCacheRoot(join(sibling, '.cache'), first, {
      rejectInside: [sibling],
    });
    expect(reason).toContain(sibling);
    expect(existsSync(join(sibling, '.cache'))).toBe(false);
  });

  it('never creates the root or repairs its mode when read-only', () => {
    const repo = tempRoot();
    const missing = join(repo, '..', `cache-absent-${process.pid}-${Date.now()}`);
    expect(cache.checkCacheRoot(missing, repo, { create: false })).toBeNull();
    expect(existsSync(missing)).toBe(false);

    const loose = mkdtempSync(join(tmpdir(), 'studiq-cache-loose-'));
    roots.push(loose);
    chmodSync(loose, 0o755);
    const reason = cache.checkCacheRoot(loose, repo, { create: false });
    expect(reason).toContain('mode 755');
    expect(statSync(loose).mode & 0o777).toBe(0o755);
  });
});

describe('seed verification and overwrite protection', () => {
  it('rejects a truncated copy and leaves no cache', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();

    const result = await cache.seedWorktreeCache({
      worktreeRoot,
      cacheRoot,
      deps: {
        identity: () => Promise.resolve(identity()),
        copyTree: (_src, dest) => {
          mkdirSync(join(dest, 'turbopack', TEMP_TURBOPACK), { recursive: true });
          writeFileSync(join(dest, 'turbopack', TEMP_TURBOPACK, 'file-1.bin'), 'abcd');
          return true;
        },
      },
    });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('does not match the manifest');
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next', 'cache'))).toBe(false);
    expect(readdirSync(join(worktreeRoot, 'apps', 'web', '.next'))).toEqual([]);
  });

  it('names the existing cache as the reason and copies nothing', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    const worktreeRoot = writeWorktree();
    const cacheDir = join(worktreeRoot, 'apps', 'web', '.next', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('already exists');
    expect(readdirSync(join(worktreeRoot, 'apps', 'web', '.next'))).toEqual(['cache']);
  });
});

describe('pointer and cap edge cases', () => {
  it('ignores a pointer that is not a snapshot id', async () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot);
    writeFileSync(cache.cachePaths(cacheRoot).pointer, '../../etc\n');
    const worktreeRoot = writeWorktree();

    const result = await seedFromCache(cacheRoot, worktreeRoot);

    expect(cache.readCurrentSnapshotId(cacheRoot)).toBeNull();
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toContain('no published snapshot');
    expect(existsSync(join(worktreeRoot, 'apps', 'web', '.next', 'cache'))).toBe(false);
  });

  it('treats STUDIQ_CACHE_MAX_MB=0 as no cap, and an unreadable value as the default', () => {
    expect(cache.cacheMaxBytes({ STUDIQ_CACHE_MAX_MB: '0' })).toBe(0);
    expect(cache.cacheMaxBytes({ STUDIQ_CACHE_MAX_MB: 'nonsense' })).toBe(1024 * 1024 * 1024);
    expect(cache.cacheMaxBytes({ STUDIQ_CACHE_MAX_MB: '-5' })).toBe(1024 * 1024 * 1024);
  });

  it('publishes over any size when the cap is disabled', () => {
    const cacheRoot = tempRoot();
    const staging = join(cache.cachePaths(cacheRoot).staging, '4747-ffff');
    mkdirSync(join(staging, 'turbopack', TEMP_TURBOPACK), { recursive: true });
    writeFileSync(join(staging, 'turbopack', TEMP_TURBOPACK, 'f.bin'), 'abcd');

    const result = cache.publishSnapshot({
      cacheRoot,
      staged: staged(staging, { sizeBytes: 4, fileCount: 1 }),
      record,
      gates: passingGates(),
      maxBytes: 0,
    });

    expect(result.published).toBe(true);
  });

  it('clamps a future createdAt to a zero age', () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, { createdAt: new Date(Date.now() + 3_600_000).toISOString() });
    const status = cache.readSnapshotStatus({ cacheDir: cacheRoot });
    expect(status?.ageDays).toBe(0);
    expect(status?.warnings).toEqual([]);
  });
});

describe('snapshot status', () => {
  it('reports size, files, commit, age and the recorded distance', () => {
    const cacheRoot = tempRoot();
    const createdAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    writeSnapshot(cacheRoot, {
      record: { commit: 'deadbeef', dirty: false, behindCommits: 3 },
      createdAt,
      sizeBytes: 6,
      fileCount: 2,
    });

    const status = cache.readSnapshotStatus({ cacheDir: cacheRoot });

    expect(status?.sizeBytes).toBe(6);
    expect(status?.fileCount).toBe(2);
    expect(status?.commit).toBe('deadbeef');
    expect(status?.behindCommits).toBe(3);
    expect(status?.ageDays).toBeCloseTo(2, 1);
    expect(status?.turbopack).toEqual([TEMP_TURBOPACK]);
    expect(status?.warnings).toEqual([]);
  });

  it('warns above the age and distance thresholds', () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, {
      record: { commit: 'deadbeef', dirty: false, behindCommits: 120 },
      createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    const status = cache.readSnapshotStatus({ cacheDir: cacheRoot });
    expect(status?.warnings.join(' ')).toContain('days old');
    expect(status?.warnings.join(' ')).toContain('120 commits behind');
  });

  it('reports unknown fields as null, never zero', () => {
    const cacheRoot = tempRoot();
    writeSnapshot(cacheRoot, { manifest: 'not json' });
    const status = cache.readSnapshotStatus({ cacheDir: cacheRoot });
    expect(status?.sizeBytes).toBeNull();
    expect(status?.fileCount).toBeNull();
    expect(status?.commit).toBeNull();
    expect(status?.ageDays).toBeNull();
    expect(status?.warnings).toContain('manifest.json is missing or unreadable');
  });

  it('is null when no snapshot has been published', () => {
    expect(cache.readSnapshotStatus({ cacheDir: tempRoot() })).toBeNull();
  });
});
