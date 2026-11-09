import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logBuildOutput, runProductionBuild, type BuildResult } from './build';
import { EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from './exit';
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

/** Discard a rebuild backup; no backup (nothing to move aside) is a no-op. */
function discardBackup(backup: string | null): void {
  if (backup) rmSync(backup, { recursive: true, force: true });
}

/** Restart the server that was serving before the rebuild, if there was one. */
async function restartPrevious(
  deps: RebuildRecoveryDeps,
  input: RebuildRecoveryInput,
  previousPid: number | null,
): Promise<boolean> {
  if (previousPid === null) return false;
  try {
    const pid = deps.startWeb({ appPort: input.appPort, appUrl: input.appUrl, env: input.env });
    const waited = await deps.waitWeb(
      input.appUrl,
      pid,
      input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      input.appPort,
    );
    if (waited.ok) return true;
    deps.stopWeb();
  } catch {
    try {
      deps.stopWeb();
    } catch {
      /* already gone */
    }
  }
  return false;
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
  const restarted =
    input.backup === null || restored
      ? await restartPrevious(input.deps, input.request, input.previousPid)
      : false;

  let message = input.message;
  if (restored) {
    message += '; restored the previous build';
  } else if (input.backup) {
    const reason =
      restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure);
    message += `; could not restore the previous build (${reason}), kept the backup at ${input.backup}`;
  }
  if (restarted) {
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
  const backup = backupArtifact(deps);

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
    discardBackup(backup);
    return { build: result, webPid: deps.readPid(), webHttp: 0, webStarted: false };
  }

  let pid: number;
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
    try {
      deps.stopWeb();
    } catch {
      /* already gone */
    }
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
    deps.stopWeb();
    return failWithRecovery({
      deps,
      request,
      previousPid,
      backup,
      code: EXIT_START_FAILED,
      message: `web did not start (${waited.reason}); see ${webLogPath()}`,
    });
  }

  discardBackup(backup);
  return { build: result, webPid: pid, webHttp: waited.http, webStarted: true };
}
