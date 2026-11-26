import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EXIT_USAGE, EnvFailure } from './exit';
import { BUILD_MODE, computeBuildFingerprint, type FingerprintInput } from './fingerprint';
import { grantPath, mintBuildGrant, type BuildAdmission, type BuildApp } from './grant';
import {
  formatAdmissionWait,
  formatBuildSlots,
  formatDuration,
  killProcessGroup,
  readBuildSlots,
  withBuildSlots,
  type BuildSlotHandle,
  type BuildSlotsOptions,
} from './locks';
import {
  collectIdentityFacts,
  isWithin,
  nextVersionOf,
  pruneForeignVersions,
  resolveCacheDir,
  stageSnapshot,
  worktreeCacheDir,
  type StagedSnapshot,
} from './build-cache';
import { stripAnsi, writeStderrLine } from './output';
import { writeEnvManifest } from './manifest';
import { REPO_ROOT } from './repo';
import {
  appendEnvLog,
  buildArtifactDir,
  buildArtifactPresent,
  invalidateBuildArtifact,
  removeBuildState,
  removeFailedBuildArtifacts,
} from './state';
import { readWebPid } from './web';

const SECRET_LINE_RE = /(?:KEY|SECRET|PASSWORD|TOKEN)\s*=\s*\S|eyJ[A-Za-z0-9_-]{10,}/;

/** The build's own budget: a wait for a slot has a separate one (ADR-0014). */
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const BUILD_PROGRESS_MS = 30_000;
/** The `spawnSync` `maxBuffer` this replaces: stop collecting, never kill. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const OOM_SCORE_ADJ = '/proc/self/oom_score_adj';
/** How much of a failed build's output a terminal gets; the rest is in the log. */
const FAILURE_TAIL_LINES = 40;
/** How many warning lines a successful build prints before pointing at the log. */
const SUCCESS_WARNING_LINES = 10;

/**
 * A line worth showing from a *successful* build: a warning or an error.
 *
 * Next marks its own progress with `✓`, and those lines are excluded by prefix
 * rather than by pattern — `✓ Compiled successfully` matches `success`-adjacent
 * words often enough that a pattern alone would keep the noise.
 */
const DIAGNOSTIC_RE = /\b(?:warning|warn|error|deprecated)\b|failed to compile|⚠/i;

/**
 * Bun's prebuild bookkeeping, not build output.
 *
 * `bun run` prints `Exited with code N` for the lifecycle hook, and in a failed
 * build that line can read `… code 0` directly above the compiler error — an
 * agent grepping the output would read the failure as success. The build's own
 * exit status already reports the outcome.
 */
const BUN_LIFECYCLE_EXIT_RE = /^Exited with code \d+$/;

export interface BuildResult {
  /**
   * Whether the build itself succeeded: a clean exit (or a completed build whose
   * process was signalled afterwards) that left `BUILD_ID` behind. The tree
   * fingerprint is not part of this — a tree that moved is a *recording* problem,
   * never a failed build (#1365).
   */
  ok: boolean;
  timedOut: boolean;
  output: string;
  /** The tree fingerprint before the build; `''` for `apps/admin`. */
  fingerprintBefore: string;
  /** The tree fingerprint after the build; `''` for admin or when git could not answer. */
  fingerprintAfter: string;
  /**
   * Whether the tree moved while the build ran, so `fingerprintAfter` describes
   * a tree that did not build the artifact. `ok` stays true; no caller may
   * record it as current (Next's `unrecorded` is the honest answer).
   */
  fingerprintMoved: boolean;
  /**
   * The slot the build held, or null in `--no-slot`/`--no-lock` mode. Optional
   * so a caller that only cares about `ok` (the rebuild transaction) can fake a
   * result without inventing admission facts.
   */
  slot?: number | null;
  /** Whether the guard consumed the grant this launcher minted. */
  grant?: 'consumed' | 'unconsumed';
  /**
   * Where a failed web build's artifact was moved, or null when it left none.
   * Set by `runProductionBuild` before the slot is released; printed by
   * `reportBuildFailure`, which both callers already use.
   */
  invalidated?: string | null;
  /** Wall time of the spawn, for the finish line. */
  durationMs?: number;
  /**
   * The staging copy this build took while it held its slot and mutex, or null.
   * `env build` publishes it after both are released; every other caller leaves
   * it null and the copy is never taken.
   */
  staged?: StagedSnapshot | null;
  /** Why the snapshot step was skipped inside the build, or null. */
  snapshotSkipped?: string | null;
}

/**
 * `12.4s` under a minute, `5m 12s` above it.
 *
 * One decimal is enough to tell a warm rebuild from a cold one, which is what
 * the line is for; the exact milliseconds are not.
 *
 * @public Exercised by the unit tests, which assert the finish line's shape.
 */
export function formatBuildDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * ANSI-free output with Bun's filter label removed.
 *
 * `bun run --filter` writes `@studiq/<app> build:` / `@studiq/<app> prebuild:`
 * as a label, sometimes on its own line and sometimes in front of the child's
 * line, so the child's own first line reads `@studiq/web build: Route (app)`.
 * Those labels are our own commands, not the compiler's output: anything that
 * looks for a line the compiler wrote has to strip them first, which is why the
 * completion marker is matched against this and not against the raw spawn.
 */
function stripBuildLabels(output: string, app: BuildApp): string {
  const label = new RegExp(`^@studiq/${app} (?:pre)?build:(?: |$)`, 'gm');
  return stripAnsi(output).replace(label, '');
}

/**
 * ANSI-free build output, one entry per line, with Bun's filter label removed.
 *
 * The `prebuild` child is this tool's own guard, so its `build:` / `env:` /
 * `build slots:` tag is dropped too — otherwise a successful build logs
 * `build: build: admitted …`.
 */
function buildOutputLines(output: string, app: BuildApp): string[] {
  const toolTag = /^(?:build slots|build|env): /;
  return stripBuildLabels(output, app)
    .split('\n')
    .map((line) => line.trimEnd())
    .map((line) => line.replace(toolTag, ''))
    .filter((line) => line !== '' && !BUN_LIFECYCLE_EXIT_RE.test(line));
}

/** Append build output to `.dev/env.log`; callers never pass secrets. */
function appendBuildLog(lines: readonly string[]): void {
  for (const line of lines) {
    if (line.trim() && !SECRET_LINE_RE.test(line)) appendEnvLog(`build: ${line.slice(0, 500)}`);
  }
}

/** The warning/error lines of a successful build, in output order. */
function diagnosticLines(lines: readonly string[]): string[] {
  return lines.filter(
    (line) => line.trim() !== '' && !line.trimStart().startsWith('✓') && DIAGNOSTIC_RE.test(line),
  );
}

function printBuildLines(lines: readonly string[]): void {
  for (const line of lines) {
    if (line.trim() !== '') writeStderrLine(`build: ${line.slice(0, 500)}`);
  }
}

export interface BuildFailure {
  /** The exit code the caller throws with: 4 failed, 5 timed out. */
  code: number;
  /** The `env:` message: what failed, its exit code, and where the log is. */
  message: string;
}

/**
 * Report a failed build to the terminal and the log.
 *
 * A compiler error is the whole point of the failure, so the last 40 lines are
 * printed here (ANSI-stripped) instead of only being appended to a file nobody
 * was told about. The full output goes to `.dev/env.log`, and the returned
 * message names it, so the `env:` line that follows is actionable on its own.
 *
 * @public Used by `env:build` and `env:ensure`'s rebuild; exercised by the tests.
 */
export function reportBuildFailure(result: BuildResult, app: BuildApp = 'web'): BuildFailure {
  const lines = buildOutputLines(result.output, app);
  appendBuildLog(lines);
  printBuildLines(lines.slice(-FAILURE_TAIL_LINES));
  if (result.invalidated != null) {
    writeStderrLine(
      `build: moved the failed build aside to ${relative(REPO_ROOT, result.invalidated)}; it is not served and not current`,
    );
  }
  const code = result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED;
  const what = result.timedOut ? 'timed out building' : 'build failed';
  return { code, message: `${what} (exit ${code}); full log: .dev/env.log` };
}

/**
 * Report the build when its process cleanup failed. The cleanup error is the result
 * of the command, so the compiler output and the build status must not be lost.
 */
function reportCleanupFailure(
  outcome: SpawnOutcome,
  app: BuildApp,
  invalidated: string | null,
): void {
  const lines = buildOutputLines(outcome.output, app);
  let ended = `ended with exit code ${outcome.status}`;
  if (outcome.signal !== null) ended = `was stopped by ${outcome.signal}`;
  if (outcome.timedOut) ended = 'did not end in the time limit';
  const status = `the build command ${ended}. Then the process cleanup failed. Full log: .dev/env.log`;
  appendBuildLog([...lines, status]);
  printBuildLines([...lines.slice(-FAILURE_TAIL_LINES), status]);
  if (invalidated !== null) {
    writeStderrLine(
      `build: moved the artifact aside to ${relative(REPO_ROOT, invalidated)}; it is not served and not current`,
    );
  }
}

/**
 * Report a successful build: its warnings, then one line with the duration.
 *
 * `logBuildOutput` used to run only on failure, so a build with warnings looked
 * exactly like a clean one. A clean build still prints a single summary line.
 */
function reportBuildSuccess(
  options: ProductionBuildOptions,
  output: string,
  durationMs: number,
): void {
  const diagnostics = diagnosticLines(buildOutputLines(output, options.app));
  appendBuildLog(diagnostics);
  printBuildLines(diagnostics.slice(0, SUCCESS_WARNING_LINES));
  if (diagnostics.length > SUCCESS_WARNING_LINES) {
    writeStderrLine(
      `build: … ${diagnostics.length - SUCCESS_WARNING_LINES} more warning line(s) in .dev/env.log`,
    );
  }
  writeStderrLine(
    `Build complete (apps/${options.app}, ${options.admission}) in ${formatBuildDuration(durationMs)}`,
  );
}

function env(): NodeJS.ProcessEnv {
  const raw = process.env.DEV_BUILD_MEMORY_MB ?? '4096';
  const memory = Number(raw);
  if (!Number.isInteger(memory) || memory <= 0) {
    throw new EnvFailure(EXIT_USAGE, `DEV_BUILD_MEMORY_MB='${raw}' is not a positive number`);
  }
  const inherited = process.env['NODE_OPTIONS'];
  return {
    ...process.env,
    NODE_OPTIONS: inherited
      ? `${inherited} --max-old-space-size=${memory}`
      : `--max-old-space-size=${memory}`,
  };
}

interface BuildCommand {
  file: string;
  args: string[];
  /** Whether `oom_score_adj` is set before the build execs. */
  oomAdjusted: boolean;
}

/**
 * The build command, with `oom_score_adj=1000` set **before** it execs.
 *
 * Raising the score after spawn races `next build`'s worker forking: the workers
 * inherit whatever the parent had at fork time. A `sh` pre-exec wrapper writes
 * the knob and then `exec`s the real command, so the build and every worker it
 * forks carry the score. Where the knob does not exist the wrapper is skipped and
 * the skip is recorded once in the build log, not warned about per build.
 *
 * @public Exercised by the unit tests, which assert the workspace filter per app.
 */
export function buildCommand(app: BuildApp): BuildCommand {
  const args = ['run', '--filter', app === 'admin' ? '@studiq/admin' : '@studiq/web', 'build'];
  if (!existsSync(OOM_SCORE_ADJ)) {
    return { file: process.execPath, args, oomAdjusted: false };
  }
  return {
    file: 'sh',
    args: [
      '-c',
      'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; exec "$0" "$@"',
      process.execPath,
      ...args,
    ],
    oomAdjusted: true,
  };
}

interface SpawnOutcome {
  status: number | null;
  /** The signal that killed the build, when one did. */
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output: string;
  /** Wall time from spawn to exit, for the finish line. */
  durationMs: number;
}

/**
 * How one build is admitted and which app it builds.
 *
 * `slot` is the default (and the only mode `env ensure` uses). `no-slot` is for
 * an environment with no shared budget — CI and Playwright — and `no-lock` is
 * the explicit bypass for a benchmark or an incident.
 */
export interface ProductionBuildOptions {
  app: BuildApp;
  admission: BuildAdmission;
  /**
   * Take the staging copy while the build holds its slot and mutex. Only
   * `env build` sets this, and only for a checkout that can publish; every other
   * caller (the rebuild transaction) prunes the cache but never stages.
   */
  snapshot?: boolean;
}

const defaultBuildOptions: ProductionBuildOptions = { app: 'web', admission: 'slot' };

/** I/O seams for the production build; production uses the defaults below. */
export interface ProductionBuildDeps {
  /** This checkout's recorded server, or null when none is running. */
  readWebPid(): number | null;
  /** Spawn the build in its own process group under the slot it holds. */
  spawnBuild(slot: BuildSlotHandle | null, options: ProductionBuildOptions): Promise<SpawnOutcome>;
  /**
   * The artifact a failed web build invalidates. Tests point this at a
   * temporary directory; production uses `apps/web/.next`.
   */
  artifactDir?: string;
  /**
   * Test seam: called **after** a failed web build's artifact was invalidated,
   * still inside the slot it held. A test that asserts both facts here — the
   * slot record is present, and the corpse already exists — fails if either
   * side of the invalidation moves past the slot's release.
   */
  onInvalidate?(): void;
  /**
   * Test seam: admission options for the slot wait (`waitMs`, `decide`, …).
   * Production uses the defaults in `withBuildSlots`.
   */
  slots?: BuildSlotsOptions;
  /**
   * Test seam: the tree fingerprint reader. Production reads the working tree
   * (two `git` calls); a test that needs the tree to move *during* the build —
   * the reported false failure — returns a different value on the second call
   * without touching this checkout.
   */
  fingerprint?: FingerprintReader;
}

const defaultProductionBuildDeps: ProductionBuildDeps = { readWebPid, spawnBuild };

/** The result that `spawnBuild` had when its cleanup failed, by cleanup error. */
const resultsBeforeCleanupError = new WeakMap<Error, SpawnOutcome>();

/** Test seams of `spawnBuild`; production uses the defaults. */
export interface SpawnBuildSeams {
  command?: BuildCommand;
  killGroup?: (pgid: number) => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Spawn the build as its own process group and enforce the build budget.
 *
 * `spawnSync`'s `timeout` kills only the direct child; `next build`'s workers
 * survive it and keep writing `.next`. Here the child is a group leader
 * (`detached`), its `pgid` is recorded in the slot so a reclaim can find it, and
 * every exit path — success, failure, timeout — SIGTERMs the group, waits the
 * grace, then SIGKILLs before the slot is released. Without a slot
 * (`--no-slot`/`--no-lock`) the group is still killed on every exit path; there
 * is just no record for another process to reclaim.
 *
 * If the cleanup fails, the promise rejects with the cleanup error, so the build
 * always ends.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function spawnBuild(
  slot: BuildSlotHandle | null,
  options: ProductionBuildOptions,
  seams: SpawnBuildSeams = {},
): Promise<SpawnOutcome> {
  const {
    command = buildCommand(options.app),
    killGroup = killProcessGroup,
    timeoutMs = BUILD_TIMEOUT_MS,
  } = seams;
  if (!command.oomAdjusted) {
    appendEnvLog('build: oom_score_adj is not available on this platform; skipped');
  }
  return new Promise<SpawnOutcome>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command.file, command.args, {
      cwd: REPO_ROOT,
      env: env(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pgid = child.pid;
    if (pgid !== undefined) slot?.setProcessGroup(pgid);

    let output = '';
    let truncated = false;
    const collect = (chunk: Buffer | string): void => {
      if (output.length >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      output += String(chunk);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    let timedOut = false;
    const outcomeNow = (status: number | null, signal: NodeJS.Signals | null): SpawnOutcome => ({
      status,
      signal,
      timedOut,
      output: truncated ? `${output}\n[build output truncated]` : output,
      durationMs: Date.now() - startedAt,
    });
    const failCleanup = (error: unknown, outcome: SpawnOutcome): void => {
      if (error instanceof Error) resultsBeforeCleanupError.set(error, outcome);
      reject(error);
    };
    /** The cleanup of a build that ran too long failed: end without the child. */
    const abandon = (error: unknown): void => {
      clearInterval(progress);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      failCleanup(error, outcomeNow(null, null));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      writeStderrLine(
        `build: exceeded ${Math.round(BUILD_TIMEOUT_MS / 60_000)} minutes; killing the build's process group`,
      );
      killGroup(pgid ?? 0).catch(abandon);
    }, timeoutMs);
    const progress = setInterval(() => {
      slot?.heartbeat();
      const elapsed = formatDuration(Date.now() - startedAt);
      const left = formatDuration(Math.max(0, BUILD_TIMEOUT_MS - (Date.now() - startedAt)));
      writeStderrLine(
        `build: building (${formatBuildSlots(readBuildSlots())}), ${elapsed} elapsed, ${left} left`,
      );
    }, BUILD_PROGRESS_MS);
    progress.unref?.();

    const finish = (status: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      clearInterval(progress);
      killGroup(pgid ?? 0).then(
        () => resolve(outcomeNow(status, signal)),
        (error: unknown) => failCleanup(error, outcomeNow(status, signal)),
      );
    };
    child.on('error', (error) => {
      clearTimeout(timer);
      clearInterval(progress);
      reject(error);
    });
    child.on('close', finish);
  });
}

/**
 * Move a failed build's artifact aside, and return where it went.
 *
 * The path is reported by `reportBuildFailure` after the compiler tail, because
 * it is the only copy of what the build wrote before it died and a leftover
 * `.next.failed-*` is otherwise a mystery directory. `env status` lists it too.
 */
function invalidateFailedArtifact(deps: ProductionBuildDeps): string | null {
  return invalidateBuildArtifact(
    deps.artifactDir === undefined ? {} : { artifactDir: deps.artifactDir },
  );
}

/**
 * Prune foreign Turbopack version directories — only while the cache is inside
 * this checkout.
 *
 * `STUDIQ_WORKTREE_CACHE_DIR` redirects what a snapshot *reads*; it must never
 * redirect a recursive delete. A redirected cache outside the worktree is left
 * alone (ADR-0014: a bad override costs a cold build, not a file the operator
 * did not nominate), and the line says so instead of pruning in silence.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function pruneCacheVersions(
  nextVersion: string | null,
  keepDirectory?: string | null,
): string[] {
  if (nextVersion === null || nextVersion === '') return [];
  const cacheDir = worktreeCacheDir();
  if (!isWithin(cacheDir, REPO_ROOT)) {
    writeStderrLine(
      `build: not pruning ${cacheDir} (outside this checkout; STUDIQ_WORKTREE_CACHE_DIR is a read override)`,
    );
    return [];
  }
  // The resolved directory is passed explicitly: a pre-release version compares
  // on its numeric prefix, and this name must never be the thing deleted.
  return pruneForeignVersions(join(cacheDir, 'turbopack'), nextVersion, keepDirectory);
}

/** Clock/mtime granularity allowance for "this build wrote `BUILD_ID`". */
const BUILD_ID_FRESH_SLOP_MS = 2_000;

/**
 * Next prints the route table as the last thing a successful build does, after
 * every file it writes. Its header is the compiler's own completion marker.
 */
const BUILD_COMPLETE_RE = /^\s*Route \((?:app|pages)\)/m;

function shortFingerprint(value: string): string {
  return value === '' ? 'unreadable' : `${value.slice(0, 8)}…`;
}

/** How the fingerprint is read; production reads the working tree via git. */
type FingerprintReader = (input: FingerprintInput) => string;

/**
 * The tree fingerprint, before or after the build.
 *
 * Before the build a failure is an honest precondition failure — nothing has
 * been built yet, so it says that instead of surfacing later as a "build failed"
 * that never ran a compiler. After it, the fingerprint only decides whether the
 * finished artifact may be recorded, so a git failure (a timeout under load)
 * degrades to `''` ("unprovable") instead of failing a build that succeeded.
 */
function readTreeFingerprint(
  read: FingerprintReader,
  input: FingerprintInput,
  phase: 'before' | 'after',
): string {
  try {
    return read(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // After the build, `''` means "unprovable": the caller reports it once, in
    // the place that also says what the artifact's state therefore is.
    if (phase === 'after') return '';
    throw new EnvFailure(
      EXIT_START_FAILED,
      `could not read the build fingerprint before building (${reason}); nothing was built`,
      { cause: error },
    );
  }
}

/**
 * Which `BUILD_ID` a build left: none, one this spawn wrote, or the previous
 * run's. A failed build over an existing artifact leaves the old file untouched,
 * so presence alone is not evidence — the mtime has to fall inside this spawn's
 * window (a small slop covers clock granularity).
 */
function buildIdState(artifactDir: string, startedAt: number): 'missing' | 'fresh' | 'left-over' {
  try {
    const written = statSync(join(artifactDir, 'BUILD_ID')).mtimeMs;
    return written >= startedAt - BUILD_ID_FRESH_SLOP_MS ? 'fresh' : 'left-over';
  } catch {
    return 'missing';
  }
}

/**
 * Whether a build whose process did not exit 0 still finished.
 *
 * `next build` writes `.next/BUILD_ID` only after static generation succeeded and
 * then prints the route table as its final action, so a fresh `BUILD_ID` plus
 * that table is the compiler's own completion evidence — an OOM kill (the build
 * runs at `oom_score_adj=1000`) or a group kill racing the exit lands here. The
 * table is matched on label-stripped output: `bun run --filter` prefixes every
 * child line with `@studiq/<app> build:`, so the raw spawn never starts a line
 * with `Route (`.
 */
function completedDespiteExit(
  outcome: SpawnOutcome,
  artifactDir: string,
  startedAt: number,
  app: BuildApp,
): boolean {
  if (outcome.timedOut) return false;
  // Only a *signal* can end a finished build without a clean exit: a numeric
  // exit is the compiler's own answer — a `next build` that throws after
  // `printTreeView` (route-bundle stats, telemetry/flush, shutdown) exits 1 with
  // the table already printed — and must never be read as success.
  if (outcome.status !== null || !outcome.signal) return false;
  if (!BUILD_COMPLETE_RE.test(stripBuildLabels(outcome.output, app))) return false;
  return buildIdState(artifactDir, startedAt) === 'fresh';
}

export interface BuildVerdictFacts {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /**
   * The artifact's `BUILD_ID` as evidence: `missing`, `fresh` (written by this
   * build) or `left-over` (the previous run's). `null` for `apps/admin`, which
   * makes no artifact claim.
   */
  artifact: 'missing' | 'fresh' | 'left-over' | null;
  fingerprintBefore: string;
  fingerprintAfter: string;
}

/**
 * Why a build was reported as failed, one fact per condition.
 *
 * `build failed` cannot tell "the compiler said no" from "the compiler said yes
 * and the wrapper could not verify it", and those need opposite responses. Each
 * condition behind `ok` is named with the evidence it was judged on, so the next
 * occurrence is diagnosable from the terminal.
 *
 * @public Exercised by the unit tests, which assert the evidence lines.
 */
export function describeBuildVerdict(facts: BuildVerdictFacts): string[] {
  const exit =
    facts.status === null
      ? `no exit status${facts.signal === null ? '' : ` (signal ${facts.signal})`}`
      : `exit ${facts.status}${facts.signal === null ? '' : ` (signal ${facts.signal})`}`;
  const lines = [
    facts.timedOut
      ? `${exit}; the build exceeded its budget and was killed`
      : `${exit}; expected a clean exit 0`,
  ];
  if (facts.artifact === 'missing') {
    lines.push('apps/web/.next/BUILD_ID is missing: the build never wrote it');
  } else if (facts.artifact === 'left-over') {
    lines.push('apps/web/.next/BUILD_ID is present but was written before this build');
  } else if (facts.artifact === 'fresh') {
    lines.push('apps/web/.next/BUILD_ID is present and this build wrote it');
  }
  if (facts.fingerprintBefore !== '' || facts.fingerprintAfter !== '') {
    lines.push(
      facts.fingerprintAfter === ''
        ? `tree fingerprint unreadable after the build (before ${shortFingerprint(facts.fingerprintBefore)})`
        : facts.fingerprintAfter === facts.fingerprintBefore
          ? `tree fingerprint unchanged (${shortFingerprint(facts.fingerprintBefore)})`
          : `tree fingerprint moved (${shortFingerprint(facts.fingerprintBefore)} → ${shortFingerprint(facts.fingerprintAfter)})`,
    );
  }
  return lines;
}

function reportBuildVerdict(facts: BuildVerdictFacts): void {
  for (const line of describeBuildVerdict(facts)) {
    writeStderrLine(`build: ${line}`);
    appendEnvLog(`build: ${line}`);
  }
}

/**
 * A finished build the tree no longer matches: not a failure and not a record.
 * `.next` is kept (it is a real build), nothing claims it is current, and the
 * next `env build` rebuilds and records it.
 */
function reportUnrecordedBuild(before: string, after: string): void {
  const reason =
    after === ''
      ? 'the tree fingerprint could not be read after the build'
      : `the tree changed while it built (${shortFingerprint(before)} → ${shortFingerprint(after)})`;
  writeStderrLine(
    `warning: build: ${reason}; apps/web/.next is kept and is NOT recorded as current — run 'bun run env:build' again to record this tree`,
  );
  appendEnvLog(`build: not recorded — ${reason}`);
}

/**
 * A warning, not a failure: the artifact is complete but its process did not end
 * cleanly, so the exit is named rather than thrown away with the build.
 */
function reportCompletedAfterSignal(outcome: SpawnOutcome): void {
  const signal = outcome.signal ?? null;
  const how =
    outcome.status === null
      ? `signal ${signal ?? 'unknown'}`
      : `exit ${outcome.status}${signal === null ? '' : ` (signal ${signal})`}`;
  writeStderrLine(
    `warning: build: the build process ended with ${how} after printing its route table; the artifact is complete and is kept`,
  );
  appendEnvLog(`build: kept a completed artifact after ${how}`);
}

/**
 * The staging copy, taken before the slot and mutex are released.
 *
 * The copy is the one thing that must happen while the cache is quiescent — a
 * later read could race `next dev` or a raw build — so it lives inside
 * `buildOnce`, not in the command. Publication is deliberately elsewhere: it
 * must run with no build lock held.
 */
async function stageInsideBuild(
  envHash: string,
): Promise<{ staged: StagedSnapshot | null; skipped: string | null }> {
  const identity = await collectIdentityFacts(REPO_ROOT, envHash);
  const nextVersion = identity.next ?? '';
  const pruned = pruneCacheVersions(nextVersion, identity.turbopackDir);
  if (pruned.length > 0) {
    writeStderrLine(`build: pruned foreign Turbopack cache director(ies): ${pruned.join(', ')}`);
  }
  const result = await stageSnapshot({
    cacheRoot: resolveCacheDir(),
    worktreeCacheDir: worktreeCacheDir(),
    identity,
    nextVersion,
  });
  return 'staged' in result
    ? { staged: result.staged, skipped: null }
    : { staged: null, skipped: result.skipped };
}

/**
 * One build, under whatever admission the caller already took.
 *
 * The web-only facts stay web-only (ADR-0014, decision 6): the fingerprint, the
 * `.next/BUILD_ID` check and the "no web server" check describe `apps/web`'s
 * artifact and its server. `apps/admin` has no fingerprint of its own — this
 * change does not invent one — and it serves on 4000, so a running web server
 * neither owns nor blocks `apps/admin/.next`.
 */
async function buildOnce(
  envHash: string,
  deps: ProductionBuildDeps,
  options: ProductionBuildOptions,
  slot: BuildSlotHandle | null,
): Promise<BuildResult> {
  const web = options.app === 'web';
  const artifactDir = deps.artifactDir ?? buildArtifactDir();
  if (web) {
    const webPid = deps.readWebPid();
    if (webPid !== null) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `a web server (pid ${webPid}) is running; run 'env:down' before building`,
      );
    }
  }
  const input = { root: REPO_ROOT, mode: BUILD_MODE, envHash };
  // The fingerprint is evidence for *recording*, never a success condition: a
  // tree that moves under a build (a commit, a neighbour writing a file, an
  // editor) says nothing about whether `next build` worked. Failing to read it
  // before the build is still an honest precondition failure — nothing has been
  // built yet — but after the build it degrades to "unrecorded".
  const readFingerprint = deps.fingerprint ?? computeBuildFingerprint;
  const fingerprintBefore = web ? readTreeFingerprint(readFingerprint, input, 'before') : '';
  // From here on the build may overwrite `.next`, so the previous run's
  // "current" claim must already be gone: an interrupted or failed build never
  // inherits it (ADR-0014, decision 6). `apps/admin` has no record to delete.
  if (web) removeBuildState();
  const startedAt = Date.now();
  let outcome: SpawnOutcome;
  let invalidated: string | null = null;
  try {
    outcome = await deps.spawnBuild(slot, options);
  } catch (error) {
    // A spawn that threw still may have written part of `.next`.
    let moved: string | null = null;
    if (web) {
      moved = invalidateFailedArtifact(deps);
      deps.onInvalidate?.();
    }
    const unfinished = error instanceof Error ? resultsBeforeCleanupError.get(error) : undefined;
    if (unfinished) reportCleanupFailure(unfinished, options.app, moved);
    throw error;
  }
  const fingerprintAfter = web ? readTreeFingerprint(readFingerprint, input, 'after') : '';
  const artifactPresent = !web || buildArtifactPresent(artifactDir);
  const artifact = web ? buildIdState(artifactDir, startedAt) : null;
  const completed =
    outcome.status === 0 ||
    (web && completedDespiteExit(outcome, artifactDir, startedAt, options.app));
  const ok = !outcome.timedOut && completed && artifactPresent;
  const fingerprintMoved =
    web && (fingerprintAfter === '' || fingerprintAfter !== fingerprintBefore);
  // Before the slot is released: a nonzero or timed-out build leaves an
  // artifact no serve path may report as current (ADR-0014, decision 7). Only an
  // artifact that is actually broken is moved aside — a build that finished is
  // kept even when its fingerprint could not be recorded.
  if (!ok) {
    if (web) {
      invalidated = invalidateFailedArtifact(deps);
      deps.onInvalidate?.();
    }
    reportBuildVerdict({
      status: outcome.status,
      signal: outcome.signal ?? null,
      timedOut: outcome.timedOut,
      artifact,
      fingerprintBefore,
      fingerprintAfter,
    });
  }
  // A green build is when the previous corpse stops being evidence: the tree it
  // described has been replaced by one that builds.
  if (ok && web) removeFailedBuildArtifacts(artifactDir);
  // Decision 4's worktree prune runs after every successful web build, whether
  // or not this checkout can publish: the build key rejects a foreign version
  // directory, so the prune buys disk, never correctness.
  let staged: StagedSnapshot | null = null;
  let snapshotSkipped: string | null = null;
  if (ok && web) {
    if (options.snapshot === true) {
      const snapshot = await stageInsideBuild(envHash);
      staged = snapshot.staged;
      snapshotSkipped = snapshot.skipped;
    } else {
      pruneCacheVersions(nextVersionOf(REPO_ROOT));
    }
  }
  // The finish line belongs here, not in `commands/build.ts`: `env ensure`'s
  // rebuild reaches the same seam and must report the build it ran.
  if (ok) {
    reportBuildSuccess(options, outcome.output, outcome.durationMs);
    if (fingerprintMoved) reportUnrecordedBuild(fingerprintBefore, fingerprintAfter);
    else if (outcome.status !== 0) reportCompletedAfterSignal(outcome);
  }
  return {
    ok,
    timedOut: outcome.timedOut,
    output: outcome.output,
    fingerprintBefore,
    fingerprintAfter,
    fingerprintMoved,
    slot: slot?.number ?? null,
    grant: existsSync(grantPath()) ? 'unconsumed' : 'consumed',
    invalidated,
    durationMs: outcome.durationMs,
    staged,
    snapshotSkipped,
  };
}

/**
 * Build under a build slot; a zero exit without `BUILD_ID` is a failure.
 *
 * This is the single admission seam: `env build` and `env ensure`'s rebuild both
 * reach `next build` through here, so neither can bypass the slot, the
 * per-worktree mutex or the memory gate — and both mint the single-use grant the
 * `prebuild` guard demands. The grant is minted in **every** mode, immediately
 * before the spawn, so `--no-slot` and `--no-lock` are still authorised builds
 * rather than unguarded ones.
 *
 * The "no server" check is repeated **under the mutex**, immediately before the
 * spawn. `env build` checks it before queueing, but that check runs before this
 * mutex is taken, so a server started while the build waited for a slot — and
 * `env serve` is excluded only by this mutex, which it reads — would be invisible
 * to it, and the build would overwrite the artifact that server is serving.
 */
export async function runProductionBuild(
  envHash: string,
  deps: ProductionBuildDeps = defaultProductionBuildDeps,
  options: ProductionBuildOptions = defaultBuildOptions,
): Promise<BuildResult> {
  try {
    if (options.admission === 'slot') {
      return await withBuildSlots(async (slot) => {
        mintBuildGrant({
          app: options.app,
          admission: 'slot',
          slot: slot.number,
          token: slot.token,
          queuedMs: slot.queuedMs,
        });
        // The wait belongs on the line rather than only in the timestamp: the
        // build's wall time includes it, so a wall comparison from two builds on a
        // busy machine is not a build-speed comparison.
        writeStderrLine(
          `build: building apps/${options.app} (slot ${slot.number}, after ${formatAdmissionWait(slot.queuedMs)})`,
        );
        // The worktree mutex and the slot are held from here on, so the manifest
        // can name this build. `env:ensure`'s rebuild reaches this same seam.
        writeEnvManifest();
        return buildOnce(envHash, deps, options, slot);
      }, deps.slots);
    }
    if (options.admission === 'no-slot') {
      writeStderrLine('build: --no-slot: no build slot or lease claimed (CI/Playwright mode)');
    } else {
      writeStderrLine('warning: build: --no-lock bypasses build admission on this machine');
    }
    mintBuildGrant({ app: options.app, admission: options.admission, slot: null });
    writeStderrLine(`build: building apps/${options.app} (${options.admission})`);
    return await buildOnce(envHash, deps, options, null);
  } finally {
    // The mutex is released by now, so this clears `building` even when the
    // build failed or was killed; the caller records the new build afterwards.
    writeEnvManifest();
  }
}
