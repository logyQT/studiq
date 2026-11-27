import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { BUILD_MODE, computeBuildFingerprint } from './fingerprint';
import { writeStderrLine } from './output';
import { REPO_ROOT } from './repo';

/** `.dev/` is runtime state only; `STUDIQ_ENV_STATE_DIR` isolates tests. */
export const DEV_DIR = process.env.STUDIQ_ENV_STATE_DIR
  ? resolve(REPO_ROOT, process.env.STUDIQ_ENV_STATE_DIR)
  : join(REPO_ROOT, '.dev');

export interface StackState {
  stackName: string;
  profile: string | null;
  cold: boolean;
  updatedAt: string;
}

export interface BuildState {
  fingerprint: string;
  envHash: string;
  builtAt: string;
}

export function ensureDevDir(): void {
  mkdirSync(DEV_DIR, { recursive: true, mode: 0o700 });
  chmodSync(DEV_DIR, 0o700);
}

function atomicWrite(path: string, contents: string): void {
  ensureDevDir();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(path, 0o600);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function identityKey(projectRoot: string, branch: string, stackName: string): string {
  return createHash('sha256')
    .update(`${projectRoot}\0${branch}\0${stackName}`)
    .digest('hex')
    .slice(0, 16);
}

const STATE_FILE = join(DEV_DIR, 'stack.json');

export function readStackState(): StackState | null {
  const parsed = readJson(STATE_FILE);
  if (!parsed || typeof parsed.stackName !== 'string') return null;
  return {
    stackName: parsed.stackName,
    profile: typeof parsed.profile === 'string' ? parsed.profile : null,
    cold: parsed.cold === true,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

export function writeStackState(state: StackState): void {
  atomicWrite(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function removeStackState(): void {
  rmSync(STATE_FILE, { force: true });
}

const BUILD_FILE = join(DEV_DIR, 'build.json');

export function readBuildState(): BuildState | null {
  const parsed = readJson(BUILD_FILE);
  if (!parsed || typeof parsed.fingerprint !== 'string' || typeof parsed.envHash !== 'string') {
    return null;
  }
  return {
    fingerprint: parsed.fingerprint,
    envHash: parsed.envHash,
    builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : '',
  };
}

export function writeBuildState(state: BuildState): void {
  atomicWrite(BUILD_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Forget the recorded build. Recovery calls this before putting an older
 * artifact back: the restored `.next` must never inherit the interrupted run's
 * "this build is current" claim.
 */
export function removeBuildState(): void {
  rmSync(BUILD_FILE, { force: true });
}

/**
 * The migration set this checkout last proved applied on one stack.
 *
 * A claim, like `.dev/build.json`: `env status` reports it without opening a
 * database connection, and `env ensure` re-probes whenever the local migration
 * files no longer match it (#1186). `stackId` binds the claim to one stack, so a
 * recreated stack never inherits it.
 */
export interface MigrationsState {
  stackId: string;
  stackName: string;
  checkedAt: string;
  /** Local versions proven present in the database. */
  versions: string[];
  /** Versions the database had with no local file, at the last probe. */
  remoteOnly: string[];
}

const MIGRATIONS_FILE = join(DEV_DIR, 'migrations.json');

export function readMigrationsState(): MigrationsState | null {
  const parsed = readJson(MIGRATIONS_FILE);
  if (!parsed || typeof parsed.stackId !== 'string' || !Array.isArray(parsed.versions)) {
    return null;
  }
  return {
    stackId: parsed.stackId,
    stackName: typeof parsed.stackName === 'string' ? parsed.stackName : '',
    checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : '',
    versions: parsed.versions.filter((version): version is string => typeof version === 'string'),
    remoteOnly: Array.isArray(parsed.remoteOnly)
      ? parsed.remoteOnly.filter((version): version is string => typeof version === 'string')
      : [],
  };
}

export function writeMigrationsState(state: MigrationsState): void {
  atomicWrite(MIGRATIONS_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Where `apps/web`'s production build lands. */
export function buildArtifactDir(): string {
  return join(REPO_ROOT, 'apps', 'web', '.next');
}

/** Next's own proof that a build finished, and the file a raw build moves. */
export function buildArtifactPresent(artifactDir: string = buildArtifactDir()): boolean {
  return existsSync(join(artifactDir, 'BUILD_ID'));
}

/**
 * What the artifact on disk is worth, as reported by `env status`, `env serve`
 * and `env build` (ADR-0014, decision 8).
 *
 * `current` is the only state a serve path may use. The other three are
 * distinct on purpose: `missing` has no artifact, `unrecorded` has one that no
 * record covers (a raw `next build`, a `--no-lock` build, or a build that
 * outlived its record), and `stale` is a recorded artifact the tree has moved
 * past. `null` means the fingerprint could not be computed at all.
 */
export type BuildArtifactState = 'current' | 'stale' | 'unrecorded' | 'missing';

/** The build a caller would accept: its tree/env fingerprint and env hash. */
export interface ExpectedBuild {
  /** `computeBuildFingerprint` for the tree that would build now; null if git failed. */
  fingerprint: string | null;
  /** The inlined-env hash to match, or null to judge the tree alone. */
  envHash: string | null;
}

/**
 * Whether the artifact is newer than the record describes it.
 *
 * Next writes `BUILD_ID` at the end of every build, so an artifact whose
 * `BUILD_ID` mtime is past the record's `builtAt` is not the artifact the
 * record names — no matter how well the fingerprint happens to match. A record
 * without a readable `builtAt` cannot prove anything and is treated the same
 * way. `null` means there is no `BUILD_ID` at all.
 *
 * This is the whole mtime rule, shared by the classifier and the status
 * snapshot: it is decidable from the filesystem alone, so an artifact a raw
 * `next build` replaced never pays for a fingerprint.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function artifactOutlivesRecord(
  record: BuildState,
  artifactDir: string = buildArtifactDir(),
): boolean | null {
  let buildIdMtimeMs: number;
  try {
    buildIdMtimeMs = statSync(join(artifactDir, 'BUILD_ID')).mtimeMs;
  } catch {
    return null;
  }
  const builtAtMs = Date.parse(record.builtAt);
  // `mtimeMs` carries sub-millisecond precision while `builtAt` is an ISO
  // string, so both sides are floored to whole milliseconds: a build that lands
  // in the same millisecond as its record is still current, and a raw build
  // seconds later is still caught.
  if (Number.isNaN(builtAtMs)) return true;
  return Math.floor(buildIdMtimeMs) > builtAtMs;
}

/**
 * Classify `apps/web/.next` against the record and the expected build.
 *
 * `artifactDir` is `apps/web/.next` in production and a temporary directory in
 * the tests, which is the only way to exercise the mtime rule without touching
 * this checkout's artifact.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function classifyBuildArtifact(
  expected: ExpectedBuild,
  artifactDir: string = buildArtifactDir(),
): BuildArtifactState | null {
  if (!buildArtifactPresent(artifactDir)) return 'missing';
  const record = readBuildState();
  if (!record) return 'unrecorded';
  // `null` here means `BUILD_ID` vanished between the two stats; it is still not
  // the recorded artifact, so it reads as unrecorded rather than throwing.
  if (artifactOutlivesRecord(record, artifactDir) !== false) return 'unrecorded';
  if (expected.envHash !== null && record.envHash !== expected.envHash) return 'stale';
  if (expected.fingerprint === null) return null;
  return record.fingerprint === expected.fingerprint ? 'current' : 'stale';
}

/**
 * The artifact state `env status` reports for this checkout's recorded build,
 * judged against the record it should match.
 *
 * Status does not read the stack's keys, so it compares the tree with the
 * recorded build's **own** env hash: `current` here means "this is the recorded
 * build of this tree". `env serve` and `env build` compare the inlined
 * environment too, so an env change reads as `stale` there and is rebuilt.
 *
 * The cheap answers come first: no `BUILD_ID` is `missing`, and an artifact a
 * raw `next build` moved past the record is `unrecorded`, both decided from the
 * filesystem. Only `current` and `stale` pay for the fingerprint (two `git`
 * calls). The environment manifest reports the same answer, so it calls this
 * rather than growing a second classifier (ADR-0014, decision 8).
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function classifyRecordedArtifact(
  artifactDir: string = buildArtifactDir(),
): BuildArtifactState | null {
  const record = readBuildState();
  if (!record || !buildArtifactPresent(artifactDir)) {
    return classifyBuildArtifact({ fingerprint: null, envHash: null }, artifactDir);
  }
  // The same mtime rule the classifier applies, ahead of the fingerprint: a raw
  // `next build` after a wrapper build is the headline `unrecorded` case, and it
  // must not cost two `git` calls to answer.
  if (artifactOutlivesRecord(record, artifactDir) !== false) return 'unrecorded';
  return classifyBuildArtifact(
    { fingerprint: buildFingerprintOrNull(record.envHash), envHash: record.envHash },
    artifactDir,
  );
}

/**
 * The tree fingerprint for `envHash`, or `null` when git cannot answer.
 *
 * `classifyBuildArtifact` reads `null` as "cannot be computed", which is never
 * `current`: an unprovable fingerprint costs a rebuild (`env build`, `ensure`) or
 * a refusal (`env serve`), never a thrown git error before the command has
 * decided anything.
 *
 * @public Exercised by the unit tests through `env:build` and `env:serve`.
 */
export function buildFingerprintOrNull(envHash: string): string | null {
  try {
    return computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash });
  } catch {
    return null;
  }
}

/** One line an agent can act on, for a state the classifier returned. */
const ARTIFACT_STATE_LABELS: Record<BuildArtifactState, string> = {
  current: 'current',
  stale: 'stale (the tree or the inlined environment changed since the recorded build)',
  unrecorded:
    'unrecorded (no build record covers it: a raw next build or a --no-lock build leaves none, and a build whose tree moved while it ran is deliberately not recorded)',
  missing: 'missing (apps/web/.next has no BUILD_ID)',
};

export function artifactStateLabel(state: BuildArtifactState | null): string {
  return state === null
    ? 'unknown (the build fingerprint could not be computed)'
    : ARTIFACT_STATE_LABELS[state];
}

const FAILED_ARTIFACT_MARKER = '.failed-';

function failedArtifactPrefix(artifactDir: string): string {
  return `${basename(artifactDir)}${FAILED_ARTIFACT_MARKER}`;
}

/**
 * The `.next.failed-*` directories a failed build left behind, oldest first.
 *
 * One is kept for inspection (the next failure replaces it), so this is
 * normally empty or a single entry. `env status` reports it rather than
 * deleting it: the artifact is the only evidence of what the build wrote
 * before it died.
 */
export function failedBuildArtifacts(artifactDir: string = buildArtifactDir()): string[] {
  try {
    const prefix = failedArtifactPrefix(artifactDir);
    const parent = dirname(artifactDir);
    return readdirSync(parent)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .map((name) => join(parent, name));
  } catch {
    return [];
  }
}

/**
 * Delete every `.next.failed-*` beside the artifact.
 *
 * Called by a *successful* build: the corpse is evidence of what the failed
 * build wrote, and a green build is exactly when that period ends. Called
 * before a failed build moves a new one aside, so a tree that keeps failing
 * costs one `.next`, not one per attempt. A leftover that cannot be removed is
 * reported by `env status`, never retried here.
 */
export function removeFailedBuildArtifacts(artifactDir: string = buildArtifactDir()): void {
  for (const stale of failedBuildArtifacts(artifactDir)) {
    try {
      rmSync(stale, { recursive: true, force: true });
    } catch {
      /* reported by `env status`, not retried here */
    }
  }
}

/**
 * Make a failed build's artifact unusable and forget its claim.
 *
 * Called on every nonzero or timed-out exit, before the slot is released, and
 * by the reclaim path when the launcher itself died. The artifact is moved
 * aside — a rename on the same filesystem — so the half-written tree is never
 * served and is still there to inspect; when it cannot be moved it is deleted,
 * because an unusable `.next` must not survive a failed build. The record goes
 * either way: it was already removed before the build started, and removing it
 * again is the belt to that braces.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function invalidateBuildArtifact(
  input: { artifactDir?: string; at?: Date } = {},
): string | null {
  const artifactDir = input.artifactDir ?? buildArtifactDir();
  const stamp = (input.at ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const target = `${artifactDir}${FAILED_ARTIFACT_MARKER}${stamp}`;
  let moved: string | null = null;
  if (existsSync(artifactDir)) {
    removeFailedBuildArtifacts(artifactDir);
    try {
      renameSync(artifactDir, target);
      moved = target;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      try {
        rmSync(artifactDir, { recursive: true, force: true });
      } catch (removeError) {
        writeStderrLine(
          `warning: build: could not move or delete ${artifactDir} after a failed build (${reason}; ${
            removeError instanceof Error ? removeError.message : String(removeError)
          })`,
        );
      }
    }
  }
  try {
    removeBuildState();
  } catch (error) {
    writeStderrLine(
      `warning: build: could not remove .dev/build.json after a failed build (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  return moved;
}

/** Append one human line to `.dev/env.log`; callers never pass secrets. */
export function appendEnvLog(line: string): void {
  ensureDevDir();
  const path = join(DEV_DIR, 'env.log');
  const created = !existsSync(path);
  writeFileSync(path, `[${new Date().toISOString()}] ${line}\n`, { flag: 'a', mode: 0o600 });
  if (created) chmodSync(path, 0o600);
}
