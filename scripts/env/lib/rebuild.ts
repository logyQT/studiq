import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logBuildOutput, runProductionBuild, type BuildResult } from './build';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from './exit';
import { pidAlive } from './locks';
import { writeStderrLine } from './output';
import { REPO_ROOT } from './repo';
import { DEV_DIR } from './state';
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

function backupArtifact(deps: RebuildRecoveryDeps): string | null {
  if (!existsSync(join(deps.artifactDir, 'BUILD_ID'))) return null;
  mkdirSync(deps.backupDir, { recursive: true, mode: 0o700 });
  const stamp = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const backup = join(deps.backupDir, `next-backup-${stamp}`);
  // A rename is atomic and stays on the same filesystem (`.dev/` is inside the
  // checkout). The web server was stopped before this runs.
  renameSync(deps.artifactDir, backup);
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
 * The running server is stopped first, the previous build is moved aside, and
 * the build runs under the existing build lock. Any failure restores that build
 * (and restarts the previous server when it was serving); only a fully
 * successful build/start discards the backup.
 *
 * @public Used by `env:ensure` and exercised by the unit tests, which load this
 * module by computed URL.
 */
export async function rebuildWithRecovery(
  request: RebuildRecoveryInput,
  deps: RebuildRecoveryDeps = defaultDeps,
): Promise<RebuildRecoveryResult> {
  const previousPid = deps.readPid();
  if (previousPid !== null) deps.stopForReplacement();

  let backup: string | null;
  try {
    backup = backupArtifact(deps);
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
    // The new build is complete; the previous artifact is no longer needed.
    const leftover = discardBackup(deps, backup);
    const warnings = leftoverWarning(leftover);
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
    if (survivor !== null) throw survivingReplacementFailure(survivor, backup, error);
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: EXIT_START_FAILED,
      message: `web did not start (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  if (!waited.ok) {
    const survivor = containReplacement(deps, pid, previousPid);
    if (survivor !== null) throw survivingReplacementFailure(survivor, backup);
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: EXIT_START_FAILED,
      message: `web did not start (${waited.reason}); see ${webLogPath()}`,
    });
  }

  const leftover = discardBackup(deps, backup);
  const warnings = leftoverWarning(leftover);
  return {
    build: result,
    webPid: pid,
    webHttp: waited.http,
    webStarted: true,
    ...(warnings ? { warnings } : {}),
  };
}
