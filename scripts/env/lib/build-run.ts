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
  return {
    ...result,
    fingerprintBefore,
    fingerprintAfter,
    stable: fingerprintBefore === fingerprintAfter,
  };
}
