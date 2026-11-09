import { spawnSync } from 'node:child_process';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from './exit';
import { REPO_ROOT } from './repo';
import type { SeedMode } from '../atoms';
import type { ProfileName } from '../profiles';

/** No markers: `--seed` runs the existing tenant seeder once. */
export function assertSeedingAllowed(options: { mode: SeedMode; shared: boolean }): boolean {
  if (options.shared && options.mode === 'seed') {
    throw new EnvFailure(EXIT_CONFLICT, 'SUPABASE_SHARED=1: refusing to seed a shared stack');
  }
  return options.mode === 'seed';
}

export function runSeeder(profile: ProfileName, env: NodeJS.ProcessEnv): void {
  const script = profile === 'web' ? 'scripts/e2e-seed.ts' : 'scripts/qa-tenant.ts';
  const args = profile === 'web' ? [] : ['--all'];
  const result = spawnSync('bun', [script, ...args], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', process.stderr, process.stderr],
    timeout: 600_000,
  });
  if (result.status !== 0) throw new EnvFailure(EXIT_START_FAILED, `seeder '${script}' failed`);
}
