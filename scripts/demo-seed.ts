/**
 * Demo seeder — thin entrypoint.
 *
 * Applies `supabase/seeds/demo/product-demo.sql`: the Northfield University
 * demo tenant used for marketing imagery. The plan lives in `scripts/seed/demo.ts`;
 * flags, exit codes and output follow the other seeders:
 *
 *   bun scripts/demo-seed.ts            # apply (idempotent)
 *   bun scripts/demo-seed.ts --reset    # drop the demo tenant only
 *   bun scripts/demo-seed.ts --json     # machine-readable summary
 */
import { runDemoSeed } from './seed/demo';

await runDemoSeed();
