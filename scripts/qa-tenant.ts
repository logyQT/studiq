/**
 * QA tenant seeder — thin entrypoint.
 *
 * Seeds (or resets) one isolated tenant per QA case. The plan lives in
 * `scripts/seed/qa.ts`; cases, profiles, attempt files, flags, exit codes and
 * output are unchanged.
 *
 *   bun scripts/qa-tenant.ts PUB-01
 *   bun scripts/qa-tenant.ts --all --run "ci$GITHUB_RUN_ID"
 *   bun scripts/qa-tenant.ts SEC-02 --profile two-org --fresh --dedicated
 */
import { runQaSeed } from './seed/qa';

await runQaSeed();
