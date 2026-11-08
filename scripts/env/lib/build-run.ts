import { spawnSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EXIT_TIMEOUT, EXIT_USAGE, EnvFailure } from './exit';
import { REPO_ROOT } from './repo';
import { computeBuildFingerprint } from './fingerprint';
import { withBuildLock, type BuildRunResult } from './locks';
import { appendEnvLog } from './state';

export interface StableBuildInput {
  root: string;
  mode: string;
  envHash: string;
  env: NodeJS.ProcessEnv;
  waitSeconds?: number;
}

export interface StableBuildResult extends BuildRunResult {
  fingerprintBefore: string;
  fingerprintAfter: string;
  /**
   * The source tree and artifact were verified before the lock was released:
   * fingerprint unchanged, build exit 0, and `BUILD_ID` present.
   */
  stable: boolean;
}

const NEXT_DIR = join(REPO_ROOT, 'apps', 'web', '.next');
const BUILD_ID = join(NEXT_DIR, 'BUILD_ID');
const SECRET_LINE_RE = /(?:KEY|SECRET|PASSWORD|TOKEN)\s*=\s*\S|eyJ[A-Za-z0-9_-]{10,}/;

/** Append filtered build output to `.dev/env.log` without key material. */
export function logBuildOutput(output: string): void {
  const lines = output
    .split('\n')
    .filter((line) => line.trim().length > 0 && !SECRET_LINE_RE.test(line));
  for (const line of lines.slice(-40)) appendEnvLog(`build: ${line.slice(0, 500)}`);
}

function restoreBuildBackup(backupPath: string): void {
  if (!existsSync(backupPath)) return;
  rmSync(NEXT_DIR, { recursive: true, force: true });
  renameSync(backupPath, NEXT_DIR);
}

function buildEnvWithHeap(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const raw = process.env.DEV_BUILD_MEMORY_MB ?? '4096';
  const memory = Number(raw);
  if (!Number.isInteger(memory) || memory <= 0) {
    throw new EnvFailure(
      EXIT_USAGE,
      `DEV_BUILD_MEMORY_MB='${raw}' is not a positive number of megabytes`,
    );
  }
  const inherited = process.env['NODE_OPTIONS'];
  const nodeOptions = inherited
    ? `${inherited} --max-old-space-size=${memory}`
    : `--max-old-space-size=${memory}`;
  return { ...env, NODE_OPTIONS: nodeOptions };
}

/**
 * One stable build with fingerprint validation, artifact verification, backup
 * and restore/cleanup all inside the cross-worktree build lock.
 */
export async function buildWithStableFingerprint(
  input: StableBuildInput,
): Promise<StableBuildResult> {
  const fingerprintInput = {
    root: input.root,
    mode: input.mode,
    envHash: input.envHash,
  };
  const backupPath = join(
    REPO_ROOT,
    'apps',
    'web',
    `.next-build-backup-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  const waitSeconds = input.waitSeconds ?? 1800;

  try {
    return await withBuildLock(waitSeconds, () => {
      const fingerprintBefore = computeBuildFingerprint(fingerprintInput);
      let backupMoved = false;
      let buildRan = false;

      try {
        if (existsSync(NEXT_DIR)) {
          renameSync(NEXT_DIR, backupPath);
          backupMoved = true;
        }

        buildRan = true;
        const result = spawnSync(process.execPath, ['run', '--filter', '@studiq/web', 'build'], {
          cwd: REPO_ROOT,
          env: buildEnvWithHeap(input.env),
          encoding: 'utf8',
          timeout: (waitSeconds + 120) * 1000,
          maxBuffer: 32 * 1024 * 1024,
        });
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        const buildTimedOut =
          (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
        const fingerprintAfter = computeBuildFingerprint(fingerprintInput);
        const artifact = existsSync(BUILD_ID);
        const stable =
          !result.error &&
          result.status === 0 &&
          artifact &&
          fingerprintBefore === fingerprintAfter;

        if (stable) {
          rmSync(backupPath, { recursive: true, force: true });
        } else if (backupMoved) {
          restoreBuildBackup(backupPath);
        } else {
          // No previous output to preserve; never leave a partial new build.
          rmSync(NEXT_DIR, { recursive: true, force: true });
        }

        return {
          ok: !result.error && result.status === 0,
          timedOut: false,
          buildTimedOut,
          exitCode: result.status,
          output,
          backupPath,
          fingerprintBefore,
          fingerprintAfter,
          stable,
        };
      } catch (error) {
        if (backupMoved) restoreBuildBackup(backupPath);
        else if (buildRan) rmSync(NEXT_DIR, { recursive: true, force: true });
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof EnvFailure && error.exitCode === EXIT_TIMEOUT) {
      return {
        ok: false,
        timedOut: true,
        buildTimedOut: false,
        exitCode: null,
        output: '',
        backupPath,
        fingerprintBefore: '',
        fingerprintAfter: '',
        stable: false,
      };
    }
    throw error;
  }
}
