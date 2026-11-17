import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EXIT_USAGE, EnvFailure } from './exit';
import { BUILD_MODE, computeBuildFingerprint } from './fingerprint';
import { grantPath, mintBuildGrant, type BuildAdmission, type BuildApp } from './grant';
import {
  formatBuildSlots,
  formatDuration,
  killProcessGroup,
  readBuildSlots,
  withBuildSlots,
  type BuildSlotHandle,
} from './locks';
import { stripAnsi, writeStderrLine } from './output';
import { REPO_ROOT } from './repo';
import { appendEnvLog } from './state';
import { readWebPid } from './web';

const BUILD_ID = join(REPO_ROOT, 'apps', 'web', '.next', 'BUILD_ID');
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

export interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintAfter: string;
  /**
   * The slot the build held, or null in `--no-slot`/`--no-lock` mode. Optional
   * so a caller that only cares about `ok` (the rebuild transaction) can fake a
   * result without inventing admission facts.
   */
  slot?: number | null;
  /** Whether the guard consumed the grant this launcher minted. */
  grant?: 'consumed' | 'unconsumed';
  /** Wall time of the spawn, for the finish line. */
  durationMs?: number;
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
 * ANSI-free build output, one entry per line, with Bun's filter label removed.
 *
 * `bun run --filter` writes `@studiq/<app> build: ` as a label, sometimes on its
 * own line and sometimes in front of the child's line. That label is our own
 * command, not the compiler's output, so it is dropped before the tool's single
 * `build: ` prefix is applied — otherwise a failed build reads
 * `build: @studiq/web build: > 8 | …`, or a bare `build: @studiq/web build:`.
 */
function buildOutputLines(output: string, app: BuildApp): string[] {
  const label = `@studiq/${app} build:`;
  return stripAnsi(output)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== label)
    .map((line) => (line.startsWith(`${label} `) ? line.slice(label.length + 1) : line));
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
  const code = result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED;
  const what = result.timedOut ? 'timed out building' : 'build failed';
  return { code, message: `${what} (exit ${code}); full log: .dev/env.log` };
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
}

const defaultBuildOptions: ProductionBuildOptions = { app: 'web', admission: 'slot' };

/** I/O seams for the production build; production uses the defaults below. */
export interface ProductionBuildDeps {
  /** This checkout's recorded server, or null when none is running. */
  readWebPid(): number | null;
  /** Spawn the build in its own process group under the slot it holds. */
  spawnBuild(slot: BuildSlotHandle | null, options: ProductionBuildOptions): Promise<SpawnOutcome>;
}

const defaultProductionBuildDeps: ProductionBuildDeps = { readWebPid, spawnBuild };

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
 */
function spawnBuild(
  slot: BuildSlotHandle | null,
  options: ProductionBuildOptions,
): Promise<SpawnOutcome> {
  const command = buildCommand(options.app);
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
    const timer = setTimeout(() => {
      timedOut = true;
      writeStderrLine(
        `build: exceeded ${Math.round(BUILD_TIMEOUT_MS / 60_000)} minutes; killing the build's process group`,
      );
      void killProcessGroup(pgid ?? 0);
    }, BUILD_TIMEOUT_MS);
    const progress = setInterval(() => {
      slot?.heartbeat();
      const elapsed = formatDuration(Date.now() - startedAt);
      const left = formatDuration(Math.max(0, BUILD_TIMEOUT_MS - (Date.now() - startedAt)));
      writeStderrLine(
        `build: building (${formatBuildSlots(readBuildSlots())}), ${elapsed} elapsed, ${left} left`,
      );
    }, BUILD_PROGRESS_MS);
    progress.unref?.();

    const finish = (status: number | null): void => {
      clearTimeout(timer);
      clearInterval(progress);
      void killProcessGroup(pgid ?? 0).then(() => {
        resolve({
          status,
          timedOut,
          output: truncated ? `${output}\n[build output truncated]` : output,
          durationMs: Date.now() - startedAt,
        });
      });
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
  const fingerprintBefore = web ? computeBuildFingerprint(input) : '';
  const outcome = await deps.spawnBuild(slot, options);
  const fingerprintAfter = web ? computeBuildFingerprint(input) : '';
  const ok =
    outcome.status === 0 &&
    (!web || (existsSync(BUILD_ID) && fingerprintAfter === fingerprintBefore));
  // The finish line belongs here, not in `commands/build.ts`: `env ensure`'s
  // rebuild reaches the same seam and must report the build it ran.
  if (ok) reportBuildSuccess(options, outcome.output, outcome.durationMs);
  return {
    ok,
    timedOut: outcome.timedOut,
    output: outcome.output,
    fingerprintAfter,
    slot: slot?.number ?? null,
    grant: existsSync(grantPath()) ? 'unconsumed' : 'consumed',
    durationMs: outcome.durationMs,
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
  if (options.admission === 'slot') {
    return withBuildSlots(async (slot) => {
      mintBuildGrant({ app: options.app, admission: 'slot', slot: slot.number, token: slot.token });
      writeStderrLine(`build: building apps/${options.app} (slot ${slot.number})`);
      return buildOnce(envHash, deps, options, slot);
    });
  }
  if (options.admission === 'no-slot') {
    writeStderrLine('build: --no-slot: no build slot or lease claimed (CI/Playwright mode)');
  } else {
    writeStderrLine('warning: build: --no-lock bypasses build admission on this machine');
  }
  mintBuildGrant({ app: options.app, admission: options.admission, slot: null });
  writeStderrLine(`build: building apps/${options.app} (${options.admission})`);
  return buildOnce(envHash, deps, options, null);
}
