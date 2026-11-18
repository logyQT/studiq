import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { BUILD_MODE } from './fingerprint';
import { atomicWriteFile } from './atomic-file';
import { pidAlive } from './locks';
import { writeStderrLine } from './output';
import { REPO_ROOT, canon, checkoutPaths, isPrimaryCheckout } from './repo';

/**
 * The Turbopack build-cache snapshot (ADR-0014, decisions 1–4).
 *
 * A snapshot is one immutable directory under the cache root holding an
 * allowlisted copy of a worktree's `.next/cache`, a manifest and nothing else.
 * The copy is taken while a build holds this worktree's slot and mutex, because
 * that is the only time the cache is quiescent: `next dev` and a raw `next build`
 * write it at arbitrary moments, and a snapshot taken then would be a torn tree.
 *
 * The seed is a separate, lock-free read of one immutable id: it copies into a
 * temp directory beside `.next/cache` and renames, so an interrupted or ENOSPC
 * copy is never observed as a cache.
 */

/** The only entries a snapshot body may contain; every other name is skipped by name. */
const CACHE_ALLOWLIST = ['turbopack'] as const;
/** Known `.next/cache` entries that are deliberately not copied (decision 3). */
export const CACHE_KNOWN_EXCLUSIONS = ['fetch-cache', 'config.json', '.tsbuildinfo'] as const;
/**
 * Names the snapshot, so an admin cache and a web cache can never match.
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export const SNAPSHOT_SCOPE = 'apps/web:turbopack';
/** 1024 MB per published snapshot; prune-only, never an eviction (decision 4). */
const DEFAULT_CACHE_MAX_MB = 1024;
/** The seed must leave this much free beside the copy it writes (decision 4). */
const DEFAULT_CACHE_RESERVE_MB = 500;
/**
 * A retired predecessor is deleted by a later write once this has passed.
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export const RETENTION_GRACE_MS = 10 * 60 * 1000;
/** Draft threshold for the age warning `env status` prints; not a measurement. */
const SNAPSHOT_AGE_WARN_DAYS = 7;
/** Draft threshold for the recorded commit distance; not a measurement. */
const SNAPSHOT_BEHIND_WARN = 100;

const MANIFEST_NAME = 'manifest.json';
const POINTER_NAME = 'current';
const RETIRED_NAME = 'retired.json';
const LAST_PUBLISH_NAME = 'last-publish.json';
const SEED_TEMP_PREFIX = 'cache.seed-';
const STAGING_DIR = 'staging';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readText(path: string): string | null {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

// ── Location and trust ──────────────────────────────────────────────────────

/**
 * `${STUDIQ_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/studiq}`.
 *
 * A relative override resolves against the checkout, like the registry's. A
 * user override is a convenience, not a trust decision: `checkCacheRoot` still
 * validates whatever it names.
 */
export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['STUDIQ_CACHE_DIR'] ?? '';
  if (explicit) return explicit.startsWith('/') ? explicit : resolve(REPO_ROOT, explicit);
  const cacheHome = env['XDG_CACHE_HOME'] || join(env['HOME'] || '/tmp', '.cache');
  return join(cacheHome, 'studiq');
}

/** The fixed layout under one cache root. */
export interface CachePaths {
  root: string;
  snapshots: string;
  staging: string;
  pointer: string;
  retired: string;
  lastPublish: string;
}

/**
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function cachePaths(root: string): CachePaths {
  const snapshots = join(root, 'snapshots');
  return {
    root,
    snapshots,
    staging: join(snapshots, STAGING_DIR),
    pointer: join(snapshots, POINTER_NAME),
    retired: join(snapshots, RETIRED_NAME),
    lastPublish: join(snapshots, LAST_PUBLISH_NAME),
  };
}

function isInsideOrAncestor(path: string, repoRoot: string): boolean {
  const target = resolve(path);
  const repo = resolve(repoRoot);
  return (
    target === repo ||
    target.startsWith(`${repo}/`) ||
    repo.startsWith(`${target}/`) ||
    target === canon(repo) ||
    target.startsWith(`${canon(repo)}/`) ||
    canon(repo).startsWith(`${target}/`)
  );
}

/**
 * Validate a cache root, optionally creating it.
 *
 * The registry's guard (real directory, owned by the caller, mode 700) plus a
 * containment check across **every checkout the call knows about**, so a bad
 * override cannot aim snapshot deletes at any repository checkout — the primary,
 * this worktree, or the sibling a seed is about to write into. `create: false` is
 * the read-only form: it never creates the root and never changes its mode.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function checkCacheRoot(
  root: string,
  repoRoot: string = REPO_ROOT,
  options: { create?: boolean; rejectInside?: readonly string[]; uid?: number } = {},
): string | null {
  for (const checkout of [repoRoot, ...(options.rejectInside ?? [])]) {
    if (!isInsideOrAncestor(root, checkout)) continue;
    return `cache root ${root} is inside (or an ancestor of) the repository ${checkout}`;
  }
  // The identity check is the caller's own uid against the directory's owner.
  // It runs before the `create` handling on purpose: a mode-700 root owned by
  // someone else is not trusted read-only either, and the read paths (the seed
  // and `env doctor`) report it instead of pretending no snapshot exists.
  const uid = options.uid ?? process.getuid?.();
  const ownerProblem = (stat: { uid: number }): string | null =>
    uid !== undefined && stat.uid !== uid ? `cache root ${root} is not owned by this user` : null;
  try {
    const existing = lstatSync(root, { throwIfNoEntry: false });
    if (existing) {
      if (existing.isSymbolicLink()) return `cache root ${root} is a symlink`;
      if (!existing.isDirectory()) return `cache root ${root} is not a directory`;
      const foreign = ownerProblem(existing);
      if (foreign !== null) return foreign;
      if ((existing.mode & 0o777) !== 0o700) {
        // Read-only callers report the mode instead of repairing it: `env doctor`
        // must never turn a 755 root into 700 just by looking.
        return `cache root ${root} is mode ${(existing.mode & 0o777).toString(8)}; chmod 700 ${root}`;
      }
      return null;
    }
    if (options.create === false) return null;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const created = lstatSync(root);
    const foreign = ownerProblem(created);
    if (foreign !== null) return foreign;
    if (!created.isDirectory()) return `cache root ${root} is not a directory`;
    chmodSync(root, 0o700);
    return null;
  } catch (error) {
    return `cannot use cache root ${root}: ${message(error)}`;
  }
}

/**
 * The per-snapshot cap in bytes; `0` disables it, and anything unreadable falls
 * back to the default. `0` is the documented "no cap" value rather than a
 * silently ignored one, because a cap of zero MB reads as "off" to an operator.
 */
export function cacheMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['STUDIQ_CACHE_MAX_MB'];
  if (raw === undefined || raw === '') return DEFAULT_CACHE_MAX_MB * 1024 * 1024;
  const value = Number(raw);
  if (value === 0) return 0;
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_CACHE_MAX_MB) * 1024 * 1024;
}

function cacheReserveBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['STUDIQ_CACHE_RESERVE_MB'];
  const value = raw === undefined || raw === '' ? DEFAULT_CACHE_RESERVE_MB : Number(raw);
  return (Number.isFinite(value) && value >= 0 ? value : DEFAULT_CACHE_RESERVE_MB) * 1024 * 1024;
}

/** Free bytes on the filesystem holding `path`, or null when it cannot be read. */
export function freeBytes(path: string): number | null {
  try {
    const stat = statfsSync(path);
    return stat.bsize * stat.bavail;
  } catch {
    return null;
  }
}

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * What a snapshot matches on.
 *
 * Every `match` component is compared exactly; a mismatch means the build runs
 * cold. `envHash` is **recorded**, not matched: the cold-vs-seeded experiment
 * measured all three inlined values with 0 stale occurrences and 0 differences
 * after normalising per-build randomness, so a different port no longer costs
 * the seed (ADR-0014, Evidence §5).
 */
export interface SnapshotIdentity {
  turbopackDir: string | null;
  next: string | null;
  bun: string | null;
  node: string | null;
  typescript: string | null;
  lockfile: string | null;
  mode: string;
  scope: string;
  /** Record-only: never part of a match. */
  envHash: string | null;
}

/** `record`-role facts, reported as staleness and never as a refusal. */
export interface SnapshotRecord {
  commit: string | null;
  dirty: boolean;
  behindCommits: number | null;
}

export interface SnapshotManifest {
  schema: 1;
  /** Written last: an incomplete manifest is retired, never seeded. */
  complete: boolean;
  identity: SnapshotIdentity;
  record: SnapshotRecord;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
}

/** Match components, in the order a refusal names them. */
const MATCH_FIELDS = [
  'scope',
  'mode',
  'turbopackDir',
  'next',
  'bun',
  'node',
  'typescript',
  'lockfile',
] as const;

/**
 * The first component that differs, or null when the snapshot matches.
 *
 * Exact string equality on purpose: `v16.4.5` is never accepted for
 * `v16.4.5-4e5335a0`, even though one is a prefix of the other.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
const REQUIRED_MATCH_FIELDS = ['turbopackDir', 'next', 'typescript', 'lockfile'] as const;

/**
 * Match components this checkout cannot resolve; a snapshot is never guessed.
 *
 * `bun` and `node` are absent by design when the other runtime ran the build, so
 * a null there is a value (`null` matches `null`), not a gap.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function identityGaps(identity: SnapshotIdentity): string[] {
  return REQUIRED_MATCH_FIELDS.filter((field) => identity[field] === null);
}

/**
 * The first component that differs, or null when the snapshot matches.
 *
 * Exact string equality on purpose: `v16.4.5` is never accepted for
 * `v16.4.5-4e5335a0`, even though one is a prefix of the other.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function compareIdentity(live: SnapshotIdentity, recorded: SnapshotIdentity): string | null {
  for (const field of MATCH_FIELDS) {
    const expected = live[field];
    const actual = recorded[field];
    if (expected === actual) continue;
    return `${field} mismatch (this checkout: ${expected ?? 'unknown'}, snapshot: ${actual ?? 'unknown'})`;
  }
  return null;
}

/** A snapshot id is a UTC timestamp plus a short hash of the match key. */
function snapshotId(identity: SnapshotIdentity, now: number): string {
  const key = MATCH_FIELDS.map((field) => identity[field] ?? '').join('\0');
  const stamp = new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${sha256(key).slice(0, 8)}`;
}

/** The resolved `next` version of the checkout that will build, or null. */
export function nextVersionOf(worktreeRoot: string): string | null {
  const parsed = readJsonObject(join(worktreeRoot, 'node_modules', 'next', 'package.json'));
  return typeof parsed?.version === 'string' ? parsed.version : null;
}

/**
 * The full Turbopack cache directory name the installed Next resolves, or null.
 *
 * Resolved through Next's own bindings (`getTurbopackCacheVersion()`), which is
 * the same call that names the directory a build writes. A version prefix is
 * never inferred from `next/package.json`: the name carries a second hash, and
 * substituting the version for it would seed a directory the build never reads.
 *
 * @public Exercised by the unit tests, which inject a resolver instead.
 */
export async function resolveTurbopackDir(worktreeRoot: string): Promise<string | null> {
  try {
    const requireFrom = createRequire(join(worktreeRoot, 'package.json'));
    const swc = requireFrom('next/dist/build/swc') as {
      loadBindings?: () => Promise<unknown>;
      getTurbopackCacheVersion?: () => string | undefined;
    };
    if (typeof swc.loadBindings === 'function') await swc.loadBindings();
    const name =
      typeof swc.getTurbopackCacheVersion === 'function'
        ? swc.getTurbopackCacheVersion()
        : undefined;
    return typeof name === 'string' && /^v\d/.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * The resolved `typescript` version in a `bun.lock`, not the manifest range.
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function lockfileTypescript(text: string): string | null {
  const match = /^[ \t]*"typescript": \[\s*"typescript@([^"]+)"/m.exec(text);
  return match?.[1] ?? null;
}

export interface IdentityDeps {
  runtime?: { bun: string | null; node: string | null };
  nextVersion?: (worktreeRoot: string) => string | null;
  turbopackDir?: (worktreeRoot: string) => Promise<string | null>;
}

/**
 * The live identity of a checkout: what a snapshot must match to be used here.
 *
 * `node` stays null under Bun because Bun is the runtime that ran the build;
 * recording a compatibility version would claim a second runtime that was not
 * involved.
 */
export async function collectIdentityFacts(
  worktreeRoot: string,
  envHash: string | null,
  deps: IdentityDeps = {},
): Promise<SnapshotIdentity> {
  const runtime = deps.runtime ?? {
    bun: process.versions.bun ?? null,
    node: process.versions.bun === undefined ? process.versions.node : null,
  };
  const lockText = readText(join(worktreeRoot, 'bun.lock'));
  return {
    turbopackDir: await (deps.turbopackDir ?? resolveTurbopackDir)(worktreeRoot),
    next: (deps.nextVersion ?? nextVersionOf)(worktreeRoot),
    bun: runtime.bun,
    node: runtime.node,
    typescript: lockText === null ? null : lockfileTypescript(lockText),
    lockfile: lockText === null ? null : sha256(lockText),
    mode: BUILD_MODE,
    scope: SNAPSHOT_SCOPE,
    envHash,
  };
}

// ── `.next/cache` layout and measurement ────────────────────────────────────

export interface CacheLayout {
  root: string;
  entries: string[];
  allowlisted: string[];
  known: string[];
  unknown: string[];
  turbopackDirs: string[];
}

/**
 * This checkout's `.next/cache` by name, without reading a byte of content.
 *
 * `null` means the directory does not exist (normal before a first build). An
 * entry that is neither allowlisted nor a known exclusion makes the layout
 * unrecognised, which is a reason to build cold and for `env doctor` to report
 * it — never a reason to copy something unknown.
 */
export function classifyCacheLayout(cacheDir: string): CacheLayout | null {
  let entries: string[];
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return null;
  }
  const allowlisted = entries.filter((name) =>
    (CACHE_ALLOWLIST as readonly string[]).includes(name),
  );
  const known = entries.filter((name) =>
    (CACHE_KNOWN_EXCLUSIONS as readonly string[]).includes(name),
  );
  const unknown = entries.filter((name) => !allowlisted.includes(name) && !known.includes(name));
  let turbopackDirs: string[] = [];
  if (allowlisted.includes('turbopack')) {
    try {
      turbopackDirs = readdirSync(join(cacheDir, 'turbopack')).filter((name) =>
        name.startsWith('v'),
      );
    } catch {
      turbopackDirs = [];
    }
  }
  return { root: cacheDir, entries, allowlisted, known, unknown, turbopackDirs };
}

/** A layout the snapshot writer may read: `turbopack/` present, nothing unknown. */
export function cacheLayoutRecognised(layout: CacheLayout | null): boolean {
  return layout !== null && layout.allowlisted.includes('turbopack') && layout.unknown.length === 0;
}

export interface TreeSize {
  fileCount: number;
  sizeBytes: number;
}

/** Recursive metadata-only walk; symlinks count as entries and contribute no bytes. */
function measureTree(root: string): TreeSize | null {
  let fileCount = 0;
  let sizeBytes = 0;
  const walk = (dir: string): boolean => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return false;
    }
    for (const name of names) {
      const path = join(dir, name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        return false;
      }
      if (stat.isDirectory()) {
        if (!walk(path)) return false;
        continue;
      }
      fileCount += 1;
      if (stat.isFile()) sizeBytes += stat.size;
    }
    return true;
  };
  return walk(root) ? { fileCount, sizeBytes } : null;
}

/** `cp --reflink=auto -a` where it exists, plain `cp -a` as the fallback. */
export function copyTree(src: string, dest: string): boolean {
  const attempts: string[][] =
    process.platform === 'darwin'
      ? [
          ['-c', '-a', src, dest],
          ['-a', src, dest],
        ]
      : [
          ['--reflink=auto', '-a', src, dest],
          ['-a', src, dest],
        ];
  for (const args of attempts) {
    const result = spawnSync('cp', args, { encoding: 'utf8' });
    if (result.status === 0) return true;
  }
  return false;
}

/**
 * The numeric `X.Y.Z` prefix of a Next version (`16.5.0-canary.3` → `16.5.0`).
 *
 * Turbopack's directory name carries the numeric version plus its own hash
 * (`v16.4.5-4e5335a0`), and a pre-release adds a qualifier on both sides
 * (`16.5.0-canary.3` → `v16.5.0-canary3abc`). Comparing the full version with the
 * numeric prefix would call the live directory foreign and delete it.
 */
function numericVersion(version: string): string | null {
  return /^\d+\.\d+\.\d+/.exec(version)?.[0] ?? null;
}

/**
 * Delete `turbopack/v*` directories whose **numeric** version differs.
 *
 * `keepDirectory` is the full name the installed Next resolves; it is never
 * removed even if the comparison would remove it, and an unparseable version
 * removes nothing at all — deleting the live cache is the one outcome this
 * cannot recover from.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function pruneForeignVersions(
  turbopackDir: string,
  nextVersion: string,
  keepDirectory?: string | null,
): string[] {
  const numeric = numericVersion(nextVersion);
  if (numeric === null) return [];
  let names: string[];
  try {
    names = readdirSync(turbopackDir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (name === keepDirectory) continue;
    const match = /^v(\d+\.\d+\.\d+)/.exec(name);
    if (!match) continue;
    if (match[1] === numeric) continue;
    try {
      rmSync(join(turbopackDir, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      /* an undeletable foreign dir is reported by doctor, never retried here */
    }
  }
  return removed;
}

// ── Publication ─────────────────────────────────────────────────────────────

/**
 * The facts the six publication gates are judged from, captured at one moment.
 *
 * Pure input so each gate can be flipped independently in a test: one refusal
 * per condition, and the reason names the gate that failed.
 */
export interface PublishGates {
  primary: boolean;
  branch: string | null;
  head: string | null;
  originMain: string | null;
  clean: boolean;
  buildOk: boolean;
  artifactPresent: boolean;
  webPid: number | null;
}

function publishGateFailure(gates: PublishGates): string | null {
  if (!gates.primary) return 'not the primary checkout (a linked worktree never publishes)';
  if (gates.branch === null) return 'detached HEAD (the primary must be attached to a branch)';
  if (gates.originMain === null) return 'origin/main is unavailable (fetch it in the primary)';
  if (gates.head !== gates.originMain) {
    return `HEAD ${(gates.head ?? 'unknown').slice(0, 12)} is not the last fetched origin/main ${gates.originMain.slice(0, 12)}`;
  }
  if (!gates.clean) return 'the working tree is dirty (git status --porcelain is not empty)';
  if (!gates.buildOk) return 'the build did not succeed';
  if (!gates.artifactPresent) return 'apps/web/.next/BUILD_ID is missing';
  if (gates.webPid !== null) {
    return `a web server (pid ${gates.webPid}) is running for this checkout`;
  }
  return null;
}

function git(repoRoot: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
}

/**
 * The `record`-role facts of a publish: HEAD, tree state and commit distance.
 *
 * All three are reportable staleness, never a refusal; the gates already decided
 * whether publishing is allowed at all.
 */
export function readPublishRecord(repoRoot: string = REPO_ROOT): SnapshotRecord {
  const behind = git(repoRoot, ['rev-list', '--count', 'HEAD..origin/main']);
  const parsedBehind = behind === null ? Number.NaN : Number(behind);
  return {
    commit: git(repoRoot, ['rev-parse', '--short=12', 'HEAD']),
    dirty: git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']) !== '',
    behindCommits: Number.isInteger(parsedBehind) ? parsedBehind : null,
  };
}

export interface GateInput {
  repoRoot: string;
  buildOk: boolean;
  artifactPresent: boolean;
  webPid: number | null;
}

/** Read the gates from git and the checkout; `null` git answers stay null. */
export function readPublishGates(input: GateInput): PublishGates {
  return {
    primary: isPrimaryCheckout(input.repoRoot),
    branch: git(input.repoRoot, ['symbolic-ref', '-q', '--short', 'HEAD']),
    head: git(input.repoRoot, ['rev-parse', 'HEAD']),
    originMain: git(input.repoRoot, ['rev-parse', '--verify', 'origin/main^{commit}']),
    clean: git(input.repoRoot, ['status', '--porcelain', '--untracked-files=normal']) === '',
    buildOk: input.buildOk,
    artifactPresent: input.artifactPresent,
    webPid: input.webPid,
  };
}

/**
 * The cheap half of the gates, used to decide *whether to stage at all*.
 *
 * Staging is a 300 MB copy. A linked worktree or a dirty tree can never publish,
 * so copying the cache there would pay the cost on every build for a snapshot
 * that will be refused. Publication still evaluates every gate again; this only
 * keeps the refusal from costing IO.
 */
export function staticProducerReason(repoRoot: string): string | null {
  if (!isPrimaryCheckout(repoRoot)) {
    return 'not the primary checkout (a linked worktree never publishes)';
  }
  const branch = git(repoRoot, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (branch === null) return 'detached HEAD (the primary must be attached to a branch)';
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const originMain = git(repoRoot, ['rev-parse', '--verify', 'origin/main^{commit}']);
  if (originMain === null) return 'origin/main is unavailable (fetch it in the primary)';
  if (head !== originMain) {
    return `HEAD ${(head ?? 'unknown').slice(0, 12)} is not the last fetched origin/main ${originMain.slice(0, 12)}`;
  }
  if (git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']) !== '') {
    return 'the working tree is dirty (git status --porcelain is not empty)';
  }
  return null;
}

export interface StagedSnapshot {
  /** `<cacheRoot>/snapshots/staging/<pid>-<nonce>`, the directory publish renames. */
  dir: string;
  sizeBytes: number;
  fileCount: number;
  identity: SnapshotIdentity;
  prunedForeign: string[];
}

export type StageResult = { staged: StagedSnapshot } | { skipped: string };

export interface StageInput {
  cacheRoot: string;
  worktreeCacheDir: string;
  identity: SnapshotIdentity;
  nextVersion: string;
  now?: number;
  deps?: {
    copyTree?: typeof copyTree;
    freeBytes?: typeof freeBytes;
    reserveBytes?: number;
  };
}

/** `20261117T214830Z-39e24f82`: the only shape ever written to the pointer. */
const SNAPSHOT_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

/**
 * The id the pointer names, or null.
 *
 * The id is used as one path component under `snapshots/`, so anything else — a
 * hand-edited `../..`, an absolute path — reads as "no snapshot" instead of
 * sending a copy or a delete outside the cache root.
 */
function readCurrentId(paths: CachePaths): string | null {
  const trimmed = (readText(paths.pointer) ?? '').trim();
  return SNAPSHOT_ID_RE.test(trimmed) ? trimmed : null;
}

function previousSnapshotSize(paths: CachePaths, currentId: string | null): number {
  if (currentId === null) return 0;
  const stored = readSnapshotManifest(join(paths.snapshots, currentId));
  return stored?.valid === true ? stored.manifest.sizeBytes : 0;
}

/**
 * Take the staging copy, inside the locked build while the cache is quiescent.
 *
 * Nothing is published here: the copy is pruned of foreign version directories
 * and measured, and the caller publishes it after the checkout lock, the slot
 * and the worktree mutex are released. Every failure is a skip, never a build
 * failure.
 */
export async function stageSnapshot(input: StageInput): Promise<StageResult> {
  const deps = input.deps ?? {};
  const rootReason = checkCacheRoot(input.cacheRoot);
  if (rootReason !== null) return { skipped: rootReason };

  const gaps = identityGaps(input.identity);
  const layout = classifyCacheLayout(input.worktreeCacheDir);
  if (layout === null || !cacheLayoutRecognised(layout)) {
    return {
      skipped:
        layout === null
          ? `${input.worktreeCacheDir} does not exist; nothing to snapshot`
          : `unrecognised .next/cache layout (${layout.unknown.length === 0 ? 'no turbopack/' : layout.unknown.join(', ')}); env doctor reports it`,
    };
  }

  if (gaps.length > 0)
    return { skipped: `cannot resolve the snapshot identity (${gaps.join(', ')})` };

  const turbopackDir = join(input.worktreeCacheDir, 'turbopack');
  const source = deps.freeBytes ?? freeBytes;
  const measured = measureTree(turbopackDir);
  if (measured === null) return { skipped: `cannot measure ${turbopackDir}` };

  const paths = cachePaths(input.cacheRoot);
  const previousBytes = previousSnapshotSize(paths, readCurrentId(paths));
  const reserveBytes = deps.reserveBytes ?? cacheReserveBytes();
  const free = source(paths.root);
  if (free === null) return { skipped: `cannot read free space at ${paths.root}` };
  const needed = measured.sizeBytes + previousBytes + reserveBytes;
  if (free < needed) {
    return {
      skipped: `not enough free space (${Math.round(free / 1024 / 1024)} MB free, ${Math.round(needed / 1024 / 1024)} MB needed: staged copy + previous snapshot + reserve)`,
    };
  }

  const dir = join(paths.staging, `${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    mkdirSync(paths.staging, { recursive: true, mode: 0o700 });
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    return { skipped: `cannot create ${dir}: ${message(error)}` };
  }

  const copy = deps.copyTree ?? copyTree;
  try {
    for (const name of layout.allowlisted) {
      if (!copy(join(input.worktreeCacheDir, name), join(dir, name))) {
        throw new Error(`copying ${name} failed`);
      }
    }
    const prunedForeign = pruneForeignVersions(
      join(dir, 'turbopack'),
      input.nextVersion,
      input.identity.turbopackDir,
    );
    const staged = measureTree(join(dir, 'turbopack'));
    if (staged === null) throw new Error('the staged copy cannot be measured');
    // An empty body is published as `complete` and then seeded as a no-op cache,
    // so it is refused here rather than at the manifest.
    if (staged.fileCount === 0) throw new Error('the staged copy is empty');
    return {
      staged: {
        dir,
        sizeBytes: staged.sizeBytes,
        fileCount: staged.fileCount,
        identity: input.identity,
        prunedForeign,
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    return { skipped: `staging copy failed: ${message(error)}` };
  }
}

type StoredManifest =
  { valid: true; manifest: SnapshotManifest } | { valid: false; reason: string };

function readSnapshotManifest(snapshotDir: string): StoredManifest | null {
  const parsed = readJsonObject(join(snapshotDir, MANIFEST_NAME));
  if (parsed === null) {
    return existsSync(snapshotDir)
      ? { valid: false, reason: 'manifest.json is missing or unreadable' }
      : null;
  }
  const identity = parsed.identity as SnapshotIdentity | undefined;
  const record = parsed.record as SnapshotRecord | undefined;
  const sizeBytes = parsed.sizeBytes;
  const fileCount = parsed.fileCount;
  if (
    typeof identity !== 'object' ||
    identity === null ||
    typeof identity.turbopackDir !== 'string' ||
    typeof identity.next !== 'string' ||
    typeof record !== 'object' ||
    record === null ||
    typeof sizeBytes !== 'number' ||
    typeof fileCount !== 'number'
  ) {
    return { valid: false, reason: 'manifest.json is malformed' };
  }
  if (parsed.complete !== true) {
    return { valid: false, reason: 'manifest.json is not complete (the copy never finished)' };
  }
  return {
    valid: true,
    manifest: {
      schema: 1,
      complete: true,
      identity,
      record: {
        commit: typeof record.commit === 'string' ? record.commit : null,
        dirty: record.dirty === true,
        behindCommits: typeof record.behindCommits === 'number' ? record.behindCommits : null,
      },
      sizeBytes,
      fileCount,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
    },
  };
}

/** Write the manifest last inside a completed staging directory. */
function writeManifest(
  staged: StagedSnapshot,
  record: SnapshotRecord,
  now: number,
): SnapshotManifest {
  const manifest: SnapshotManifest = {
    schema: 1,
    complete: true,
    identity: staged.identity,
    record,
    sizeBytes: staged.sizeBytes,
    fileCount: staged.fileCount,
    createdAt: new Date(now).toISOString(),
  };
  atomicWriteFile(join(staged.dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** The snapshot body is the allowlist and nothing else; the manifest sits beside it. */
function verifySnapshotBody(snapshotDir: string, manifest: SnapshotManifest): string | null {
  let entries: string[];
  try {
    entries = readdirSync(snapshotDir).filter((name) => name !== MANIFEST_NAME);
  } catch {
    return 'the snapshot directory cannot be read';
  }
  const unexpected = entries.filter(
    (name) => !(CACHE_ALLOWLIST as readonly string[]).includes(name),
  );
  if (unexpected.length > 0)
    return `the snapshot body holds unrecognised entries (${unexpected.join(', ')})`;
  if (!entries.includes('turbopack')) return 'the snapshot body has no turbopack/';
  const measured = measureTree(join(snapshotDir, 'turbopack'));
  if (measured === null) return 'the snapshot body cannot be measured';
  if (manifest.fileCount === 0 || measured.fileCount === 0) return 'the snapshot body is empty';
  if (measured.fileCount !== manifest.fileCount || measured.sizeBytes !== manifest.sizeBytes) {
    return `the snapshot body does not match its manifest (${measured.fileCount} files/${measured.sizeBytes} bytes vs ${manifest.fileCount}/${manifest.sizeBytes})`;
  }
  return null;
}

function acquireStagingName(
  paths: CachePaths,
  id: string,
  logger: (line: string) => void,
): string | null {
  const target = join(paths.snapshots, id);
  if (!existsSync(target)) return target;
  const current = readCurrentId(paths);
  if (current === id) return null;
  try {
    rmSync(target, { recursive: true, force: true });
    return target;
  } catch (error) {
    logger(`cannot replace the orphaned snapshot ${id}: ${message(error)}`);
    return null;
  }
}

interface RetiredMap {
  [id: string]: string;
}

function readRetired(paths: CachePaths): RetiredMap {
  const parsed = readJsonObject(paths.retired);
  const retired: RetiredMap = {};
  for (const [id, at] of Object.entries(parsed ?? {})) {
    if (typeof at === 'string') retired[id] = at;
  }
  return retired;
}

/**
 * Retention: `current` plus **exactly one** retired predecessor.
 *
 * The grace protects that one predecessor, so a seed that read the pointer just
 * before a swap still finds its id. A further publish inside the grace retires
 * the previous predecessor too — it is superseded, and a copy that was walking it
 * may fail (the build runs cold; it never gets wrong bytes). That bound is what
 * keeps a `--force` loop from filling the disk: the cap bounds one tree, this
 * bounds how many trees exist.
 *
 * An unreferenced directory (a publish that died between the rename and the
 * pointer swap) is pruned as well, and a directory named by the pointer is never
 * touched.
 */
function pruneRetained(
  paths: CachePaths,
  currentId: string,
  retired: RetiredMap,
  now: number,
): void {
  let names: string[];
  try {
    names = readdirSync(paths.snapshots);
  } catch {
    return;
  }
  const newestRetired = Object.entries(retired)
    .filter(([id]) => id !== currentId && names.includes(id))
    .sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))[0];
  const keepRetired =
    newestRetired !== undefined && now - Date.parse(newestRetired[1]) < RETENTION_GRACE_MS
      ? newestRetired[0]
      : null;
  for (const name of names) {
    if (name === STAGING_DIR || name === POINTER_NAME || name === RETIRED_NAME) continue;
    if (name === LAST_PUBLISH_NAME) continue;
    if (name === currentId || name === keepRetired) continue;
    try {
      rmSync(join(paths.snapshots, name), { recursive: true, force: true });
    } catch {
      /* an undeletable predecessor costs disk, never correctness */
    }
  }
  for (const id of Object.keys(retired)) {
    if (id !== keepRetired) delete retired[id];
  }
}

/** Leftover staging copies whose owning build is gone cost disk and nothing else. */
function pruneStaging(paths: CachePaths): void {
  let names: string[];
  try {
    names = readdirSync(paths.staging);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = Number(name.split('-')[0]);
    if (Number.isInteger(pid) && pid > 1 && pidAlive(pid)) continue;
    rmSync(join(paths.staging, name), { recursive: true, force: true });
  }
}

export interface PublishInput {
  cacheRoot: string;
  staged: StagedSnapshot;
  record: SnapshotRecord;
  gates: PublishGates;
  now?: number;
  maxBytes?: number;
}

export type PublishResult =
  | { published: true; id: string; sizeBytes: number; fileCount: number }
  | { published: false; reason: string };

export interface LastPublish {
  at: string;
  outcome: 'published' | 'refused';
  reason: string | null;
  id: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
}

export function readLastPublish(cacheDir = resolveCacheDir()): LastPublish | null {
  const parsed = readJsonObject(cachePaths(cacheDir).lastPublish);
  if (parsed === null || typeof parsed.at !== 'string') return null;
  return {
    at: parsed.at,
    outcome: parsed.outcome === 'published' ? 'published' : 'refused',
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    id: typeof parsed.id === 'string' ? parsed.id : null,
    sizeBytes: typeof parsed.sizeBytes === 'number' ? parsed.sizeBytes : null,
    fileCount: typeof parsed.fileCount === 'number' ? parsed.fileCount : null,
  };
}

function writeLastPublish(paths: CachePaths, outcome: LastPublish): void {
  try {
    mkdirSync(paths.snapshots, { recursive: true, mode: 0o700 });
    atomicWriteFile(paths.lastPublish, `${JSON.stringify(outcome, null, 2)}\n`);
  } catch {
    /* the record is reporting, not state a build depends on */
  }
}

/**
 * Publish one staged snapshot: verify, manifest, atomic pointer swap, retention.
 *
 * Runs with no checkout lock, no slot and no worktree mutex held (ADR-0014,
 * decision 2); production wraps it in `snapshot.lock` through
 * `publishSnapshotLocked`. A refusal keeps the previous snapshot and leaves the
 * worktree to build cold.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function publishSnapshot(input: PublishInput): PublishResult {
  const now = input.now ?? Date.now();
  const paths = cachePaths(input.cacheRoot);
  const refuse = (reason: string): PublishResult => {
    rmSync(input.staged.dir, { recursive: true, force: true });
    try {
      writeLastPublish(paths, {
        at: new Date(now).toISOString(),
        outcome: 'refused',
        reason,
        id: null,
        sizeBytes: input.staged.sizeBytes,
        fileCount: input.staged.fileCount,
      });
    } catch {
      /* reporting only */
    }
    return { published: false, reason };
  };

  const gateFailure = publishGateFailure(input.gates);
  if (gateFailure !== null) return refuse(gateFailure);

  const maxBytes = input.maxBytes ?? cacheMaxBytes();
  if (maxBytes > 0 && input.staged.sizeBytes > maxBytes) {
    return refuse(
      `the staged snapshot is ${Math.round(input.staged.sizeBytes / 1024 / 1024)} MB, over the ${Math.round(maxBytes / 1024 / 1024)} MB cap; the previous snapshot is kept`,
    );
  }

  const manifest = writeManifest(input.staged, input.record, now);
  const bodyFailure = verifySnapshotBody(input.staged.dir, manifest);
  if (bodyFailure !== null) return refuse(bodyFailure);

  const id = snapshotId(input.staged.identity, now);
  const target = acquireStagingName(paths, id, (line) =>
    writeStderrLine(`warning: build: ${line}`),
  );
  if (target === null) {
    rmSync(input.staged.dir, { recursive: true, force: true });
    return {
      published: true,
      id,
      sizeBytes: input.staged.sizeBytes,
      fileCount: input.staged.fileCount,
    };
  }
  try {
    mkdirSync(paths.snapshots, { recursive: true, mode: 0o700 });
    renameSync(input.staged.dir, target);
  } catch (error) {
    rmSync(input.staged.dir, { recursive: true, force: true });
    return refuse(`cannot publish the snapshot: ${message(error)}`);
  }

  const previous = readCurrentId(paths);
  const retired = readRetired(paths);
  try {
    atomicWriteFile(paths.pointer, `${id}\n`);
  } catch (error) {
    return refuse(`cannot swap the snapshot pointer: ${message(error)}`);
  }
  delete retired[id];
  if (previous !== null && previous !== id) retired[previous] = new Date(now).toISOString();
  pruneRetained(paths, id, retired, now);
  pruneStaging(paths);
  try {
    atomicWriteFile(paths.retired, `${JSON.stringify(retired, null, 2)}\n`);
  } catch {
    /* retention bookkeeping degrades to orphan pruning by mtime */
  }
  writeLastPublish(paths, {
    at: new Date(now).toISOString(),
    outcome: 'published',
    reason: null,
    id,
    sizeBytes: input.staged.sizeBytes,
    fileCount: input.staged.fileCount,
  });
  return {
    published: true,
    id,
    sizeBytes: input.staged.sizeBytes,
    fileCount: input.staged.fileCount,
  };
}

/** The pointer read a seed starts from; one read, so a later swap cannot affect it. */
export function readCurrentSnapshotId(cacheDir = resolveCacheDir()): string | null {
  return readCurrentId(cachePaths(cacheDir));
}

// ── Seeding ─────────────────────────────────────────────────────────────────

export interface SeedDeps {
  now?: () => number;
  copyTree?: typeof copyTree;
  freeBytes?: typeof freeBytes;
  identity?: (worktreeRoot: string) => Promise<SnapshotIdentity>;
}

export type SeedResult =
  | { status: 'seeded'; id: string; fileCount: number; sizeBytes: number }
  | { status: 'skipped'; reason: string }
  | { status: 'refused'; reason: string };

export interface SeedInput {
  worktreeRoot: string;
  cacheRoot?: string;
  /** Recorded only; the seed never matches on it. */
  envHash?: string | null;
  deps?: SeedDeps;
}

function retireCurrent(paths: CachePaths, id: string): void {
  if (readCurrentId(paths) !== id) return;
  rmSync(paths.pointer, { force: true });
}

function removeStaleSeedDirs(nextDir: string): void {
  let names: string[];
  try {
    names = readdirSync(nextDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(SEED_TEMP_PREFIX)) continue;
    const pid = Number(name.slice(SEED_TEMP_PREFIX.length).split('-')[0]);
    if (Number.isInteger(pid) && pid > 1 && pidAlive(pid)) continue;
    rmSync(join(nextDir, name), { recursive: true, force: true });
  }
}

/**
 * Seed a worktree whose `.next/cache` is absent, atomically.
 *
 * Reads the pointer once, verifies the manifest and the identity, preflights
 * free space, copies into `cache.seed-<pid>-<nonce>` on the same filesystem and
 * renames — the rename is the publication step. It never overwrites or merges
 * into an existing cache, and it never fails a build: a refused cache root is the
 * one case a caller may report as an error (the explicit `seed-cache` entrypoint
 * exits non-zero for it).
 */
export async function seedWorktreeCache(input: SeedInput): Promise<SeedResult> {
  const deps = input.deps ?? {};
  const cacheRoot = input.cacheRoot ?? resolveCacheDir();
  const worktreeRoot = input.worktreeRoot;
  // A seed is the one caller whose target is a *different* checkout (spin), so
  // containment has to cover the repository, not just that target. It is also
  // read-only: a seed never creates the cache root.
  const refused = checkCacheRoot(cacheRoot, REPO_ROOT, {
    create: false,
    rejectInside: [worktreeRoot, ...checkoutPaths()],
  });
  if (refused !== null) return { status: 'refused', reason: refused };

  const cacheDir = join(worktreeRoot, 'apps', 'web', '.next', 'cache');
  const nextDir = join(worktreeRoot, 'apps', 'web', '.next');
  if (existsSync(cacheDir)) return { status: 'skipped', reason: `${cacheDir} already exists` };
  removeStaleSeedDirs(nextDir);

  const paths = cachePaths(cacheRoot);
  const id = readCurrentId(paths);
  if (id === null) return { status: 'skipped', reason: 'no published snapshot' };
  const snapshotDir = join(paths.snapshots, id);
  const stored = readSnapshotManifest(snapshotDir);
  if (stored === null || !stored.valid) {
    retireCurrent(paths, id);
    return {
      status: 'skipped',
      reason: `snapshot ${id} is unusable (${stored?.reason ?? 'it is gone'}); retired`,
    };
  }
  const { manifest } = stored;
  const bodyFailure = verifySnapshotBody(snapshotDir, manifest);
  if (bodyFailure !== null) {
    retireCurrent(paths, id);
    return { status: 'skipped', reason: `snapshot ${id} is unusable (${bodyFailure}); retired` };
  }

  // Without the resolved Turbopack directory name there is nothing to compare,
  // and a guess would seed a directory this build never reads.
  const facts =
    input.deps?.identity === undefined
      ? await collectIdentityFacts(worktreeRoot, input.envHash ?? null)
      : await input.deps.identity(worktreeRoot);
  const gaps = identityGaps(facts);
  if (gaps.length > 0) {
    return {
      status: 'skipped',
      reason: `cannot resolve this checkout’s cache identity (${gaps.join(', ')})`,
    };
  }
  const mismatch = compareIdentity(facts, manifest.identity);
  if (mismatch !== null) return { status: 'skipped', reason: mismatch };

  // `.next` may not exist yet on a fresh worktree; the preflight asks the
  // filesystem that will hold it, which is the worktree's own.
  const probePath = existsSync(nextDir) ? nextDir : worktreeRoot;
  const free = (deps.freeBytes ?? freeBytes)(probePath);
  if (free === null) return { status: 'skipped', reason: `cannot read free space at ${probePath}` };
  const needed = manifest.sizeBytes + cacheReserveBytes();
  if (free < needed) {
    return {
      status: 'skipped',
      reason: `not enough free space (${Math.round(free / 1024 / 1024)} MB free, ${Math.round(needed / 1024 / 1024)} MB needed: snapshot + reserve)`,
    };
  }

  const temp = join(nextDir, `${SEED_TEMP_PREFIX}${process.pid}-${randomBytes(4).toString('hex')}`);
  const copy = deps.copyTree ?? copyTree;
  try {
    mkdirSync(nextDir, { recursive: true, mode: 0o700 });
    mkdirSync(temp, { mode: 0o700 });
    for (const name of CACHE_ALLOWLIST) {
      if (!existsSync(join(snapshotDir, name))) continue;
      if (!copy(join(snapshotDir, name), join(temp, name))) {
        throw new Error(`copying ${name} failed`);
      }
    }
    const measured = measureTree(join(temp, 'turbopack'));
    if (measured === null) throw new Error('the copy cannot be measured');
    if (measured.fileCount !== manifest.fileCount || measured.sizeBytes !== manifest.sizeBytes) {
      throw new Error(
        `the copy does not match the manifest (${measured.fileCount} files/${measured.sizeBytes} bytes vs ${manifest.fileCount}/${manifest.sizeBytes})`,
      );
    }
    renameSync(temp, cacheDir);
    return { status: 'seeded', id, fileCount: measured.fileCount, sizeBytes: measured.sizeBytes };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (existsSync(cacheDir)) {
      return { status: 'skipped', reason: 'another process created this worktree’s cache first' };
    }
    return { status: 'skipped', reason: `seed copy failed: ${message(error)}` };
  }
}

// ── Reporting (status / doctor) ─────────────────────────────────────────────

export interface SnapshotStatus {
  id: string;
  path: string;
  sizeBytes: number | null;
  fileCount: number | null;
  commit: string | null;
  createdAt: string | null;
  ageDays: number | null;
  /** Recorded at publish; `env status` never invokes git for this. */
  behindCommits: number | null;
  turbopack: string[] | null;
  identity: SnapshotIdentity | null;
  warnings: string[];
}

/**
 * One pointer read, one manifest read and one shallow `readdir` (decision 8).
 *
 * `null` means "no published snapshot". An unreadable pointer target or manifest
 * yields a status whose fields are null — `unknown`, never `0`, because a zero
 * would claim a fact the reader does not have.
 */
export function readSnapshotStatus(
  options: { cacheDir?: string; now?: number } = {},
): SnapshotStatus | null {
  const cacheRoot = options.cacheDir ?? resolveCacheDir();
  const now = options.now ?? Date.now();
  const paths = cachePaths(cacheRoot);
  const id = readCurrentId(paths);
  if (id === null) return null;
  const path = join(paths.snapshots, id);
  const stored = readSnapshotManifest(path);
  const warnings: string[] = [];
  let turbopack: string[] | null = null;
  try {
    turbopack = readdirSync(join(path, 'turbopack')).filter((name) => name.startsWith('v'));
  } catch {
    turbopack = null;
  }
  if (stored === null || !stored.valid) {
    return {
      id,
      path,
      sizeBytes: null,
      fileCount: null,
      commit: null,
      createdAt: null,
      ageDays: null,
      behindCommits: null,
      turbopack,
      identity: null,
      warnings: [stored?.reason ?? 'the snapshot manifest is missing'],
    };
  }
  const { manifest } = stored;
  const createdMs = Date.parse(manifest.createdAt);
  // A clock that moved backwards must not print "-0.5 days old".
  const ageDays = Number.isNaN(createdMs) ? null : Math.max(0, now - createdMs) / 86_400_000;
  if (ageDays !== null && ageDays > SNAPSHOT_AGE_WARN_DAYS) {
    warnings.push(
      `snapshot is ${ageDays.toFixed(1)} days old (warn above ${SNAPSHOT_AGE_WARN_DAYS})`,
    );
  }
  if (
    manifest.record.behindCommits !== null &&
    manifest.record.behindCommits > SNAPSHOT_BEHIND_WARN
  ) {
    warnings.push(
      `snapshot was ${manifest.record.behindCommits} commits behind origin/main at publish (warn above ${SNAPSHOT_BEHIND_WARN})`,
    );
  }
  return {
    id,
    path,
    sizeBytes: manifest.sizeBytes,
    fileCount: manifest.fileCount,
    commit: manifest.record.commit,
    createdAt: manifest.createdAt === '' ? null : manifest.createdAt,
    ageDays,
    behindCommits: manifest.record.behindCommits,
    turbopack,
    identity: manifest.identity,
    warnings,
  };
}
