/**
 * Demo seeder — thin entrypoint.
 *
 * Applies `supabase/seeds/demo/demo-{en,pl}.sql`: the marketing demo tenants. The
 * plan lives in `scripts/seed/demo.ts`; flags, exit codes and output follow the
 * other seeders:
 *
 *   bun scripts/demo-seed.ts --yes                       # apply (idempotent)
 *   bun scripts/demo-seed.ts --reset --yes               # drop both demo tenants
 *   bun scripts/demo-seed.ts --reset --locale pl --yes   # drop the Polish tenant only
 *   bun scripts/demo-seed.ts --dry-run                   # print the targets, touch nothing
 *   bun scripts/demo-seed.ts --json --yes                # machine-readable summary
 *
 * `--reset` without `--locale` removes both tenants; `--locale` narrows every
 * action to one. `--yes` is required because applying deletes each tenant before
 * inserting it and `--reset` only deletes.
 */
import { runDemoSeed } from './seed/demo';

await runDemoSeed();
