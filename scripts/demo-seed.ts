/**
 * Demo seeder — thin entrypoint.
 *
 * Applies `supabase/seeds/demo/demo-{en,pl}.sql`: the marketing demo tenants. The
 * plan lives in `scripts/seed/demo.ts`; flags, exit codes and output follow the
 * other seeders:
 *
 *   bun scripts/demo-seed.ts --yes              # apply (idempotent)
 *   bun scripts/demo-seed.ts --reset --yes      # drop the demo tenant only
 *   bun scripts/demo-seed.ts --dry-run          # print the targets, touch nothing
 *   bun scripts/demo-seed.ts --json --yes       # machine-readable summary
 *
 * `--yes` is required because applying deletes each tenant before inserting it and
 * `--reset` only deletes.
 */
import { runDemoSeed } from './seed/demo';

await runDemoSeed();
