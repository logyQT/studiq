import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './repo';
import { computeBuildFingerprint } from './fingerprint';
import { runBuildUnderLock, type BuildRunResult } from './locks';

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
   * The source tree did not change while the build ran. A fingerprint computed
   * after the build can otherwise bless a build that does not contain those
   * edits; callers persist it only when this is true.
   */
  stable: boolean;
}

/**
 * One build with the fingerprint sampled before and after. The lock covers the
 * build only; a source edit during it makes the build stale, so the fingerprint
 * is not persisted and the caller must rebuild.
 */
const NEXT_DIR = join(REPO_ROOT, 'apps', 'web', '.next');

/** Put the pre-build output back (the shell restores it on normal failures too). */
function restoreBuildBackup(backupPath: string): void {
  if (!existsSync(backupPath)) return;
  rmSync(NEXT_DIR, { recursive: true, force: true });
  renameSync(backupPath, NEXT_DIR);
}

export function buildWithStableFingerprint(input: StableBuildInput): StableBuildResult {
  const fingerprintInput = {
    root: input.root,
    mode: input.mode,
    envHash: input.envHash,
  };
  const fingerprintBefore = computeBuildFingerprint(fingerprintInput);
  const result = runBuildUnderLock({
    env: input.env,
    waitSeconds: input.waitSeconds,
  });
  const fingerprintAfter = computeBuildFingerprint(fingerprintInput);
  const stable = result.ok && fingerprintBefore === fingerprintAfter;

  if (stable) {
    rmSync(result.backupPath, { recursive: true, force: true });
  } else if (existsSync(result.backupPath)) {
    // A failed or source-shifted build must not leave its partial output behind.
    restoreBuildBackup(result.backupPath);
  } else if (result.ok) {
    // First-ever build whose source changed mid-build: no previous output to
    // restore, so drop it rather than bless it with a fingerprint.
    rmSync(NEXT_DIR, { recursive: true, force: true });
  }

  return {
    ...result,
    fingerprintBefore,
    fingerprintAfter,
    stable,
  };
}
