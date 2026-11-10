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

/**
 * Marks a seeder child whose endpoint/credentials were already resolved by the
 * checked-stack `ensure`. Without it the QA seeder's `qa/env.json` overwrites
 * `NEXT_PUBLIC_SUPABASE_URL` with the shared stack and seeds the wrong database.
 * `scripts/seed/cli.ts` reads the same name.
 */
export const SEED_TARGET_LOCKED = 'STUDIQ_SEED_LOCKED_TARGET';

export function runSeeder(profile: ProfileName, env: NodeJS.ProcessEnv): void {
  const script = profile === 'web' ? 'scripts/e2e-seed.ts' : 'scripts/qa-tenant.ts';
  const args = profile === 'web' ? [] : ['--all'];
  const result = spawnSync('bun', [script, ...args], {
    cwd: REPO_ROOT,
    // The checked-stack endpoint and credentials are the target; a QA seeder
    // must not swap them for `qa/env.json`'s shared stack.
    env: { ...env, [SEED_TARGET_LOCKED]: '1' },
    stdio: ['ignore', process.stderr, process.stderr],
    timeout: 600_000,
  });
  if (result.status !== 0) throw new EnvFailure(EXIT_START_FAILED, `seeder '${script}' failed`);
}
