/**
 * e2e tenant seeder — thin entrypoint.
 *
 * Seeds one isolated tenant per Playwright test (file × title × browser) before
 * the suite starts. The plan lives in `scripts/seed/e2e.ts`; flags, exit codes
 * and output are unchanged:
 *
 *   bun scripts/e2e-seed.ts                     # seed everything the suite runs
 *   bun scripts/e2e-seed.ts --reset             # drop e2e tenants first
 *   bun scripts/e2e-seed.ts --project chromium  # one CI leg (its own tenants only)
 *   bun scripts/e2e-seed.ts --only <key>
 */
import { runE2eSeed } from './seed/e2e';

await runE2eSeed();
