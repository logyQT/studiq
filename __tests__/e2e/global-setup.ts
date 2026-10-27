import { spawnSync } from 'node:child_process';

/**
 * Seeds one isolated tenant per test before the suite starts.
 * Skip with E2E_SKIP_SEED=1 when the database already carries this run's tenants.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_SEED === '1') {
    console.log('e2e seed: skipped (E2E_SKIP_SEED=1)');
    return;
  }
  const result = spawnSync('bun', ['scripts/e2e-seed.ts'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) throw new Error('e2e seed failed');
}
