import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { logBuildOutput, runProductionBuild, type BuildResult } from './build';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from './exit';
import { pidAlive } from './locks';
import { writeStderrLine } from './output';
import { REPO_ROOT } from './repo';
import { DEV_DIR, removeBuildState } from './state';
import {
  readWebPid,
  startWebServer,
  stopWebServer,
  stopWebServerForReplacement,
  waitForWeb,
  webLogPath,
  type StartWebOptions,
  type StopWebResult,
  type WaitWebResult,
} from './web';

const DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * I/O seams (and test paths) for the rebuild transaction. Production always
 * uses the defaults below; the unit tests inject a temporary artifact/backup
 * directory and a fake build so a rollback can be proven without running
 * `next build`.
 */
interface RebuildRecoveryDeps {
  build(envHash: string): Promise<BuildResult>;
  startWeb(options: StartWebOptions): number;
  waitWeb(
    appUrl: string,
    pid: number,
    timeoutSeconds: number,
    appPort: number,
  ): Promise<WaitWebResult>;
  stopWeb(): StopWebResult;
  stopForReplacement(): StopWebResult;
  readPid(): number | null;
  /** Liveness probe for the replacement server; defaults to the real `pidAlive`. */
  pidAlive?(pid: number): boolean;
  /** Remove a spent backup; defaults to `rmSync`. */
  removeBackup?(backup: string): void;
  artifactDir: string;
  backupDir: string;
}

const defaultDeps: RebuildRecoveryDeps = {
  build: runProductionBuild,
  startWeb: startWebServer,
  waitWeb: waitForWeb,
  stopWeb: stopWebServer,
  stopForReplacement: stopWebServerForReplacement,
  readPid: readWebPid,
  pidAlive,
  removeBackup: removeBackupDir,
  artifactDir: join(REPO_ROOT, 'apps', 'web', '.next'),
  backupDir: DEV_DIR,
};

export interface RebuildRecoveryInput {
  envHash: string;
  appPort: number;
  appUrl: string;
  env: NodeJS.ProcessEnv;
  /** Also start (and health-check) the web server after the build. */
  serve: boolean;
  timeoutSeconds?: number;
}

export interface RebuildRecoveryResult {
  build: BuildResult;
  webPid: number | null;
  webHttp: number;
  webStarted: boolean;
  /** Set when the new build landed but its backup could not be removed. */
  warnings?: string[];
}

/** Remove a spent backup; failure only warns because the new build is in place. */
function removeBackupDir(backup: string): void {
  rmSync(backup, { recursive: true, force: true });
}

function discardBackup(deps: RebuildRecoveryDeps, backup: string | null): string | null {
  if (backup === null) return null;
  try {
    (deps.removeBackup ?? removeBackupDir)(backup);
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeStderrLine(
      `warning: could not remove the previous build backup at ${backup} (${reason}); the new build is in place`,
    );
    return backup;
  }
}

/** Result fields for a backup that outlived a successful rebuild. */
function leftoverWarning(backup: string | null): string[] | undefined {
  return backup === null ? undefined : [`could not remove the previous build backup at ${backup}`];
}

/**
 * Settle a successful rebuild: commit the handover, then drop the spent backup
 * and only then the record. A backup that cannot be removed keeps the record,
 * so the next recovery retries the removal of a handover that is already
 * verified rather than restoring over the new build.
 */
function settleCommitted(deps: RebuildRecoveryDeps, backup: string | null): string[] | undefined {
  commitHandover();
  const leftover = discardBackup(deps, backup);
  if (leftover === null) removeHandover();
  return leftoverWarning(leftover);
}

/** Interrupted-rebuild record; `.dev/` is checkout-scoped, so recovery never crosses checkouts. */
const HANDOVER_FILE = join(DEV_DIR, 'handover.json');

/**
 * `backed-up`: the previous artifact is in the backup and nothing has verified
 * the replacement yet. `committed`: the replacement build (and, when serving,
 * its health check) succeeded, so the backup is spent. Only a committed
 * handover may discard the previous build.
 */
type HandoverPhase = 'backed-up' | 'committed';

interface HandoverRecord {
  artifactDir: string;
  backupPath: string;
  previousPid: number | null;
  /**
   * The process that owns this in-flight handover (the rebuild). `checkout.lock`
   * is deliberately free while that process builds, so only its death releases
   * the artifact to another recovery.
   */
  ownerPid: number | null;
  phase: HandoverPhase;
  at: string;
}

/**
 * Persist the handover atomically (mode 600).
 *
 * `create` links a complete temp file into place, which *fails* when a record
 * already exists: exactly one rebuild can own the in-flight handover, even
 * though `checkout.lock` is free while it builds. The default replaces the
 * record (commit).
 */
function writeHandover(record: HandoverRecord, create = false): void {
  mkdirSync(DEV_DIR, { recursive: true, mode: 0o700 });
  const temp = `${HANDOVER_FILE}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (create) linkSync(temp, HANDOVER_FILE);
    else renameSync(temp, HANDOVER_FILE);
  } finally {
    rmSync(temp, { force: true });
  }
}

function removeHandover(): void {
  try {
    rmSync(HANDOVER_FILE, { force: true });
  } catch {
    /* best effort: a stale record resolves itself on the next recovery */
  }
}

function readHandover(): HandoverRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(HANDOVER_FILE, 'utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.artifactDir !== 'string' || typeof record.backupPath !== 'string') return null;
  return {
    artifactDir: record.artifactDir,
    backupPath: record.backupPath,
    previousPid: typeof record.previousPid === 'number' ? record.previousPid : null,
    ownerPid: typeof record.ownerPid === 'number' ? record.ownerPid : null,
    // Anything else (including a record from an older run) is unverified by
    // definition: only the exact committed marker may discard the backup.
    phase: record.phase === 'committed' ? 'committed' : 'backed-up',
    at: typeof record.at === 'string' ? record.at : '',
  };
}

/**
 * Mark the in-flight handover committed once the replacement build — and, when
 * serving, its required health check — has succeeded. Best effort: a record
 * that cannot be rewritten leaves the handover uncommitted, so a later recovery
 * conservatively restores the previous build instead of discarding it.
 */
function commitHandover(): void {
  const record = readHandover();
  if (!record || record.phase === 'committed') return;
  try {
    writeHandover({ ...record, phase: 'committed' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeStderrLine(
      `warning: could not mark the build handover committed (${reason}); the previous build is restored if recovery runs`,
    );
  }
}

/**
 * Liveness seams for handover recovery. The replacement server started by
 * `rebuildWithRecovery` is the process that owns `.next`, so while it is alive
 * nothing may be restored over (or moved out of) that directory.
 */
interface HandoverRecoveryDeps {
  /** PID recorded for this checkout's web server (the replacement), or null. */
  readPid(): number | null;
  /**
   * Liveness probe for a recorded PID (the replacement server or the process
   * that owns the handover); defaults to the real `pidAlive`.
   */
  pidAlive?(pid: number): boolean;
}

const defaultHandoverDeps: HandoverRecoveryDeps = {
  readPid: readWebPid,
  pidAlive,
};

/**
 * What `recoverHandover` found and did.
 *
 * - `none`: there was no record.
 * - `settled`: the record was recovered, cleaned up or is gone.
 * - `in-flight`: another live process owns the rebuild, so the artifact must not
 *   be touched; with `checkout.lock` free for that build, only this record names
 *   the owner.
 * - `serving`: the unverified replacement server still owns the artifact.
 * - `kept`: a cleanup step failed, so the record stays for the next attempt; the
 *   artifact itself is intact.
 */
export type HandoverRecovery =
  | { status: 'none' }
  | { status: 'settled' }
  | { status: 'in-flight'; ownerPid: number }
  | { status: 'serving'; pid: number }
  | { status: 'kept' };

/**
 * Settle a handover left by an interrupted rebuild.
 *
 * Runs inside the checkout lock, before the lease/build, so the artifact is
 * consistent before `ensure` decides whether it needs to build.
 *
 * - a record owned by another live process is never touched: its owner is the
 *   in-flight build, which owns `.next` even though `checkout.lock` is
 *   deliberately free, so recovery reports `in-flight` and the caller refuses
 *   instead of stopping the server or backing up the artifact.
 * - `committed` with an artifact present: the replacement completed and was
 *   verified, so the spent backup and the record are removed.
 * - `backed-up` while the replacement is still alive: the process serving the
 *   unverified artifact still owns `.next`, so recovery is deferred (record and
 *   backup untouched) and a later `ensure` retries once it stops.
 * - anything else with a backup: the previous build was never verified as
 *   replaced, so it is restored over `.next` — even when an unverified
 *   artifact is present — and the record is removed afterwards. The build state
 *   is invalidated first, so the restored artifact is never reported current.
 * - no backup left: there is nothing to restore or clean up, so the record is
 *   cleared.
 *
 * A restore that cannot land keeps the record (and its backup path) for the
 * next attempt, and the record is only ever removed after the backup is gone.
 * A build-state invalidation that fails aborts before `.next` is touched.
 *
 * @public Used by `env:ensure`/`env:build` and exercised by the unit tests.
 */
export function recoverHandover(
  deps: HandoverRecoveryDeps = defaultHandoverDeps,
): HandoverRecovery {
  const record = readHandover();
  if (!record) return { status: 'none' };
  const owner = record.ownerPid;
  if (owner !== null && owner !== process.pid && (deps.pidAlive?.(owner) ?? pidAlive(owner))) {
    // `checkout.lock` is deliberately free while the owner builds, so a live
    // owner — not the lock — is what keeps `.next` and the backup untouched.
    // The owner check comes before the backup check: a build that claimed the
    // record and has not moved the artifact yet is still in flight.
    writeStderrLine(
      `warning: the build that owns the handover record (pid ${owner}) is still running; deferring recovery of the interrupted build until it exits (kept the handover record and backup at ${record.backupPath})`,
    );
    return { status: 'in-flight', ownerPid: owner };
  }
  if (!existsSync(record.backupPath)) {
    // The backup is gone, so there is nothing left to restore or clean up.
    removeHandover();
    return { status: 'settled' };
  }
  if (record.phase === 'committed' && existsSync(join(record.artifactDir, 'BUILD_ID'))) {
    // Only a committed handover may drop the previous build; a removal that
    // fails keeps the record so the next recovery retries it.
    try {
      rmSync(record.backupPath, { recursive: true, force: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      writeStderrLine(
        `warning: could not remove the stale handover backup at ${record.backupPath} (${reason}); keeping the handover record`,
      );
      return { status: 'kept' };
    }
    removeHandover();
    return { status: 'settled' };
  }
  if (record.phase !== 'committed') {
    // The replacement server was started with this checkout's worktree marker,
    // so `readWebPid` can only return a replacement that owns the port and the
    // unverified `.next`. Restoring under it would yank the artifact it serves,
    // so defer without touching the record or the backup.
    const replacement = deps.readPid();
    const alive = replacement !== null && (deps.pidAlive?.(replacement) ?? pidAlive(replacement));
    if (alive) {
      writeStderrLine(
        `warning: the replacement web server (pid ${replacement}) is still running; deferring recovery of the interrupted build until it stops (kept the handover record and backup at ${record.backupPath})`,
      );
      return { status: 'serving', pid: replacement };
    }
  }
  try {
    // The artifact about to be restored is the *previous* build, so the build
    // state that described the interrupted run must not survive the restore. An
    // invalidation that fails aborts before `.next` is touched: the record and
    // its backup stay, and the next recovery retries both steps.
    removeBuildState();
    rmSync(record.artifactDir, { recursive: true, force: true });
    renameSync(record.backupPath, record.artifactDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EnvFailure(
      EXIT_START_FAILED,
      `could not restore the interrupted build from ${record.backupPath} (${reason}); kept the handover record`,
      { cause: error },
    );
  }
  removeHandover();
  return { status: 'settled' };
}

/** A fresh, unique backup path for the artifact a rebuild moves aside. */
function nextBackupPath(deps: RebuildRecoveryDeps): string {
  const stamp = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return join(deps.backupDir, `next-backup-${stamp}`);
}

function handoverRecord(
  deps: RebuildRecoveryDeps,
  backupPath: string,
  previousPid: number | null,
): HandoverRecord {
  return {
    artifactDir: deps.artifactDir,
    backupPath,
    previousPid,
    ownerPid: process.pid,
    phase: 'backed-up',
    at: new Date().toISOString(),
  };
}

/**
 * Resolve a record whose owner is gone so this rebuild can take the artifact.
 *
 * Recovery already ran under the checkout lock, so a record still here belongs
 * to a process that died inside this prelude or to a live replacement server
 * this rebuild is about to replace. Its artifact is therefore superseded: keep
 * the previous build only when `.next` is missing, otherwise the backup is
 * spent (the unverified `.next` is moved aside and restored on failure).
 */
function settleAbandonedHandover(deps: RebuildRecoveryDeps, record: HandoverRecord): void {
  if (existsSync(record.backupPath)) {
    if (existsSync(join(record.artifactDir, 'BUILD_ID'))) {
      discardBackup(deps, record.backupPath);
    } else {
      try {
        restoreArtifact({ ...deps, artifactDir: record.artifactDir }, record.backupPath);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new EnvFailure(
          EXIT_START_FAILED,
          `could not restore the interrupted build from ${record.backupPath} (${reason}); kept the handover record`,
          { cause: error },
        );
      }
    }
  }
  removeHandover();
}

/**
 * Take ownership of the artifact before the server is stopped or `.next` is
 * moved aside.
 *
 * `checkout.lock` is deliberately released for the build, so the handover
 * record — not the lock — is what keeps a second ensure from stopping the same
 * server and backing up the same `.next` while this rebuild runs. Creating the
 * record is the exclusion primitive (a whole file is linked into place, so
 * exactly one rebuild wins), and a live foreign owner is refused before any
 * mutation. Ownership is held until `settleCommitted`/`failWithRecovery`
 * resolves the record.
 */
function claimHandover(deps: RebuildRecoveryDeps, previousPid: number | null): string {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const backupPath = nextBackupPath(deps);
    try {
      writeHandover(handoverRecord(deps, backupPath, previousPid), true);
      return backupPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const existing = readHandover();
    if (!existing) continue;
    const owner = existing.ownerPid;
    // A record this process left behind is spent (a rebuild that failed to
    // discard its backup, or a test-level re-run): rebuilds are not re-entrant,
    // so it is never an *in-flight* build of ours.
    if (owner !== null && owner !== process.pid && (deps.pidAlive?.(owner) ?? pidAlive(owner))) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `another env process (pid ${owner}) is rebuilding apps/web/.next; retry once its build handover settles (kept the handover record and backup at ${existing.backupPath})`,
      );
    }
    settleAbandonedHandover(deps, existing);
  }
  throw new EnvFailure(
    EXIT_CONFLICT,
    'could not take ownership of the build handover; re-run env:ensure',
  );
}

/** Move the previous build aside; the handover record already names where. */
function moveArtifactAside(deps: RebuildRecoveryDeps, backup: string): string | null {
  if (!existsSync(join(deps.artifactDir, 'BUILD_ID'))) return null;
  mkdirSync(deps.backupDir, { recursive: true, mode: 0o700 });
  try {
    // A rename is atomic and stays on the same filesystem (`.dev/` is inside the
    // checkout). The web server was stopped before this runs.
    renameSync(deps.artifactDir, backup);
  } catch (error) {
    // The artifact was not moved, so there is nothing to hand over.
    removeHandover();
    throw error;
  }
  return backup;
}

function restoreArtifact(deps: RebuildRecoveryDeps, backup: string): void {
  rmSync(deps.artifactDir, { recursive: true, force: true });
  renameSync(backup, deps.artifactDir);
}

/** What a rollback restart achieved: a serving server, or a PID that outlived it. */
interface RestartOutcome {
  restarted: boolean;
  /** The restart attempt's PID when it survived its stop, else null. */
  survivor: number | null;
}

/**
 * Stop the failed restart attempt and report its PID only when it is still
 * alive: a stop that cannot be proven must never be reported as stopped.
 */
function containRestartAttempt(deps: RebuildRecoveryDeps, attempt: number | null): number | null {
  try {
    deps.stopWeb();
  } catch {
    /* already gone */
  }
  if (attempt === null) return null;
  const alive = deps.pidAlive?.(attempt) ?? pidAlive(attempt);
  return alive ? attempt : null;
}

/** Restart the server that was serving before the rebuild, if there was one. */
async function restartPrevious(
  deps: RebuildRecoveryDeps,
  input: RebuildRecoveryInput,
  previousPid: number | null,
): Promise<RestartOutcome> {
  if (previousPid === null) return { restarted: false, survivor: null };
  let attempt: number | null = null;
  try {
    attempt = deps.startWeb({ appPort: input.appPort, appUrl: input.appUrl, env: input.env });
    const waited = await deps.waitWeb(
      input.appUrl,
      attempt,
      input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      input.appPort,
    );
    if (waited.ok) return { restarted: true, survivor: null };
  } catch {
    /* a thrown start/wait is a failed restart: contain the attempt below */
  }
  return { restarted: false, survivor: containRestartAttempt(deps, attempt) };
}

/**
 * Stop the replacement server and prove it is gone. A live process after the
 * stop must not be restored over or replaced by a second server; the reported
 * PID tells the operator which process still owns the port.
 */
function containReplacement(
  deps: RebuildRecoveryDeps,
  newPid: number | null,
  previousPid: number | null,
): number | null {
  try {
    deps.stopWeb();
  } catch {
    /* already gone */
  }
  const recorded = deps.readPid();
  const candidate = newPid ?? (recorded !== null && recorded !== previousPid ? recorded : null);
  if (candidate === null) return null;
  const alive = deps.pidAlive?.(candidate) ?? pidAlive(candidate);
  return alive ? candidate : null;
}

/**
 * A failed rollback restart must never be reported as a stopped environment:
 * the surviving process still owns the port, and its PID record is the only
 * thing that can stop it later.
 */
function restartSurvivorFailure(
  survivor: number,
  kept: string,
  original: string,
  cause?: unknown,
): EnvFailure {
  const message = `web server (pid ${survivor}) is still running after its rollback restart; refusing to report the environment as stopped (${original}; ${kept})`;
  return cause === undefined
    ? new EnvFailure(EXIT_CONFLICT, message)
    : new EnvFailure(EXIT_CONFLICT, message, { cause });
}

/** Fail without touching the surviving process, its PID record, or the backup. */
function survivingReplacementFailure(
  survivor: number,
  backup: string | null,
  cause?: unknown,
): EnvFailure {
  const kept =
    backup === null
      ? 'there is no previous build backup'
      : `kept the previous build backup at ${backup}`;
  const message = `web server (pid ${survivor}) is still running after stop; refusing to restore or restart another server (${kept})`;
  return cause === undefined
    ? new EnvFailure(EXIT_CONFLICT, message)
    : new EnvFailure(EXIT_CONFLICT, message, { cause });
}

/**
 * Undo a failed rebuild: put the previous `.next` back (when there was one) and
 * restart the server that was serving before, then fail with the build/start
 * exit code. Without a backup this keeps the previous fail-and-stop behavior.
 */
async function failWithRecovery(input: {
  deps: RebuildRecoveryDeps;
  request: RebuildRecoveryInput;
  previousPid: number | null;
  backup: string | null;
  code: number;
  message: string;
  cause?: unknown;
}): Promise<never> {
  let restored = false;
  let restoreFailure: unknown;
  if (input.backup) {
    try {
      restoreArtifact(input.deps, input.backup);
      // The previous build is back, so the inherited handover is resolved.
      removeHandover();
      restored = true;
    } catch (error) {
      // A restore that cannot land must keep the backup: it is the only copy
      // of the previous build, and the caller has to be told where it is.
      restoreFailure = error;
    }
  }

  // Never start the previous server over an unrestored/half-restored `.next`.
  const restart: RestartOutcome =
    input.backup === null || restored
      ? await restartPrevious(input.deps, input.request, input.previousPid)
      : { restarted: false, survivor: null };
  // A restart that left a live process behind is a conflict, not a stopped
  // environment: keep the backup and report the PID instead of hiding it.
  if (restart.survivor !== null) {
    const kept = restored
      ? `the previous build is restored at ${input.deps.artifactDir}`
      : input.backup
        ? `kept the previous build backup at ${input.backup}`
        : 'there is no previous build backup';
    throw restartSurvivorFailure(restart.survivor, kept, input.message, input.cause);
  }

  let message = input.message;
  if (restored) {
    message += '; restored the previous build';
  } else if (input.backup) {
    const reason =
      restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure);
    message += `; could not restore the previous build (${reason}), kept the backup at ${input.backup}`;
  }
  if (restart.restarted) {
    message += '; previous web server restarted';
  } else if (input.previousPid !== null) {
    message +=
      input.backup && !restored
        ? '; the previous web server was not restarted'
        : `; the previous web server did not restart (environment stopped, port ${input.request.appPort} retained)`;
  } else if (!input.backup) {
    message += '; environment is stopped';
  }
  throw input.cause === undefined
    ? new EnvFailure(input.code, message)
    : new EnvFailure(input.code, message, { cause: input.cause });
}

/**
 * Rebuild `apps/web/.next` with a recoverable transaction.
 *
 * The rebuild owns the handover record before it stops the running server, so a
 * second ensure in this checkout refuses instead of stopping the same server or
 * backing up the same artifact (the checkout lock is free for the build). The
 * previous build is then moved aside and the build runs under the existing
 * build lock. Any failure restores that build (and restarts the previous server
 * when it was serving); only a fully successful build/start discards the backup
 * and releases the record.
 *
 * @public Used by `env:ensure` and exercised by the unit tests, which load this
 * module by computed URL.
 */
export async function rebuildWithRecovery(
  request: RebuildRecoveryInput,
  deps: RebuildRecoveryDeps = defaultDeps,
): Promise<RebuildRecoveryResult> {
  const previousPid = deps.readPid();
  // Claim before the stop: nothing is mutated until this rebuild owns the
  // handover, and a rebuild that already owns it makes this one refuse.
  const claimed = claimHandover(deps, previousPid);
  if (previousPid !== null) deps.stopForReplacement();

  let backup: string | null;
  try {
    backup = moveArtifactAside(deps, claimed);
  } catch (error) {
    // The previous server was already stopped, so a backup that cannot be
    // created must restore service (not build) and keep the original cause.
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup: null,
      code: EXIT_START_FAILED,
      message: `could not move the previous build aside (${error instanceof Error ? error.message : String(error)})`,
      cause: error,
    });
  }

  let result: BuildResult;
  try {
    result = await deps.build(request.envHash);
  } catch (error) {
    // A thrown build (not a `{ ok: false }` result) would otherwise skip
    // recovery entirely and leave the previous build stranded in the backup.
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: EXIT_START_FAILED,
      message: `build failed (${error instanceof Error ? error.message : String(error)})`,
      cause: error,
    });
  }
  if (!result.ok || result.timedOut) {
    logBuildOutput(result.output);
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED,
      message: result.timedOut ? 'timed out waiting for the build lock' : 'build failed',
    });
  }

  if (!request.serve) {
    // The build is complete and `--no-serve` has no health check to wait for,
    // so the handover is committed before the previous artifact is discarded.
    const warnings = settleCommitted(deps, backup);
    return {
      build: result,
      webPid: deps.readPid(),
      webHttp: 0,
      webStarted: false,
      ...(warnings ? { warnings } : {}),
    };
  }

  let pid: number | null = null;
  let waited: WaitWebResult;
  try {
    pid = deps.startWeb({ appPort: request.appPort, appUrl: request.appUrl, env: request.env });
    waited = await deps.waitWeb(
      request.appUrl,
      pid,
      request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      request.appPort,
    );
  } catch (error) {
    const survivor = containReplacement(deps, pid, previousPid);
    if (survivor !== null) {
      // The new build is in place and deliberately kept with its backup: the
      // handover is no longer actionable, so it must not restore on a later run.
      removeHandover();
      throw survivingReplacementFailure(survivor, backup, error);
    }
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: EXIT_START_FAILED,
      message: `web did not start (${error instanceof Error ? error.message : String(error)})`,
      cause: error,
    });
  }
  if (!waited.ok) {
    const survivor = containReplacement(deps, pid, previousPid);
    if (survivor !== null) {
      removeHandover();
      throw survivingReplacementFailure(survivor, backup);
    }
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: EXIT_START_FAILED,
      message: `web did not start (${waited.reason}); see ${webLogPath()}`,
    });
  }

  // The replacement build answered its health check, so the handover is
  // committed and only now may the previous build be discarded.
  const warnings = settleCommitted(deps, backup);
  return {
    build: result,
    webPid: pid,
    webHttp: waited.http,
    webStarted: true,
    ...(warnings ? { warnings } : {}),
  };
}
