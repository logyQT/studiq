import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_TIMEOUT, EXIT_USAGE, EnvFailure } from './exit';
import { BUILD_MODE, computeBuildFingerprint } from './fingerprint';
import { withBuildLock } from './locks';
import { REPO_ROOT } from './repo';
import { appendEnvLog } from './state';

const BUILD_ID = join(REPO_ROOT, 'apps', 'web', '.next', 'BUILD_ID');
const SECRET_LINE_RE = /(?:KEY|SECRET|PASSWORD|TOKEN)\s*=\s*\S|eyJ[A-Za-z0-9_-]{10,}/;

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

/** Build under the one build lock; a zero exit without BUILD_ID is a failure. */
export async function runProductionBuild(envHash: string): Promise<BuildResult> {
  const input = { root: REPO_ROOT, mode: BUILD_MODE, envHash };
  try {
    return await withBuildLock(() => {
      const fingerprintBefore = computeBuildFingerprint(input);
      const result = spawnSync(process.execPath, ['run', '--filter', '@studiq/web', 'build'], {
        cwd: REPO_ROOT,
        env: env(),
        encoding: 'utf8',
        timeout: 30 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      const fingerprintAfter = computeBuildFingerprint(input);
      return {
        ok: result.status === 0 && existsSync(BUILD_ID) && fingerprintAfter === fingerprintBefore,
        timedOut: false,
        output,
        fingerprintAfter,
      };
    });
  } catch (error) {
    if (error instanceof EnvFailure && error.exitCode === EXIT_TIMEOUT) {
      return { ok: false, timedOut: true, output: '', fingerprintAfter: envHash };
    }
    throw error;
  }
}
