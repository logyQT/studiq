import { spawnSync } from 'node:child_process';

/**
 * Seeds one isolated tenant per test before the suite starts.
 *
 * Always resets first: specs mutate their own tenant (they create decks, delete
 * flashcards, spend the daily quiz budget), so a rerun that only upserts the
 * fixture graph would inherit the previous run's leftovers.
 *
 * Skip with E2E_SKIP_SEED=1 when the database already carries this run's
 * tenants (e.g. while iterating on one spec). Note that skipping is only safe
 * for read-mostly retries: specs that create rows (banks, decks, quiz attempts)
 * consume the tenant's plan limits, so a long iteration starts failing with
 * USAGE_LIMIT_EXCEEDED — re-run the seeder with --reset instead.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_SEED === '1') {
    console.log('e2e seed: skipped (E2E_SKIP_SEED=1)');
    return;
  }
  const result = spawnSync('bun', ['scripts/e2e-seed.ts', '--reset'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) throw new Error('e2e seed failed');
}
