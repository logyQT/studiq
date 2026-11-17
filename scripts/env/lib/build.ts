import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_USAGE, EnvFailure } from './exit';
import { BUILD_MODE, computeBuildFingerprint } from './fingerprint';
import {
  formatBuildSlots,
  formatDuration,
  killProcessGroup,
  readBuildSlots,
  withBuildSlots,
  type BuildSlotHandle,
} from './locks';
import { writeStderrLine } from './output';
import { REPO_ROOT } from './repo';
import { appendEnvLog } from './state';

const BUILD_ID = join(REPO_ROOT, 'apps', 'web', '.next', 'BUILD_ID');
const SECRET_LINE_RE = /(?:KEY|SECRET|PASSWORD|TOKEN)\s*=\s*\S|eyJ[A-Za-z0-9_-]{10,}/;

/** The build's own budget: a wait for a slot has a separate one (ADR-0014). */
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const BUILD_PROGRESS_MS = 30_000;
/** The `spawnSync` `maxBuffer` this replaces: stop collecting, never kill. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const OOM_SCORE_ADJ = '/proc/self/oom_score_adj';

export interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintAfter: string;
}

export function logBuildOutput(output: string): void {
  for (const line of output.split('\n').slice(-40)) {
    if (line.trim() && !SECRET_LINE_RE.test(line)) appendEnvLog(`build: ${line.slice(0, 500)}`);
  }
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
 */
function buildCommand(): BuildCommand {
  const args = ['run', '--filter', '@studiq/web', 'build'];
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
}

/**
 * Spawn the build as its own process group and enforce the build budget.
 *
 * `spawnSync`'s `timeout` kills only the direct child; `next build`'s workers
 * survive it and keep writing `.next`. Here the child is a group leader
 * (`detached`), its `pgid` is recorded in the slot so a reclaim can find it, and
 * every exit path — success, failure, timeout — SIGTERMs the group, waits the
 * grace, then SIGKILLs before the slot is released.
 */
function spawnBuild(slot: BuildSlotHandle): Promise<SpawnOutcome> {
  const command = buildCommand();
  if (!command.oomAdjusted) {
    appendEnvLog('build: oom_score_adj is not available on this platform; skipped');
  }
  return new Promise<SpawnOutcome>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: REPO_ROOT,
      env: env(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pgid = child.pid;
    if (pgid !== undefined) slot.setProcessGroup(pgid);

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
    const startedAt = Date.now();
    const progress = setInterval(() => {
      slot.heartbeat();
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
 * Build under a build slot; a zero exit without `BUILD_ID` is a failure.
 *
 * This is the single admission seam: `env build` and `env ensure`'s rebuild both
 * reach `next build` through here, so neither can bypass the slot, the
 * per-worktree mutex or the memory gate.
 */
export async function runProductionBuild(envHash: string): Promise<BuildResult> {
  const input = { root: REPO_ROOT, mode: BUILD_MODE, envHash };
  return withBuildSlots(async (slot) => {
    const fingerprintBefore = computeBuildFingerprint(input);
    const outcome = await spawnBuild(slot);
    const fingerprintAfter = computeBuildFingerprint(input);
    return {
      ok: outcome.status === 0 && existsSync(BUILD_ID) && fingerprintAfter === fingerprintBefore,
      timedOut: outcome.timedOut,
      output: outcome.output,
      fingerprintAfter,
    };
  });
}
