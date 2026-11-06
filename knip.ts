import type { KnipConfig } from 'knip';

/**
 * Knip reads these settings through `bun run knip`, which always passes
 * `--treat-config-hints-as-errors`: a suppression that is no longer needed
 * becomes a failing gate, so the baseline below cannot silently rot.
 *
 * Every remaining suppression must name a package that is genuinely used but
 * statically invisible to knip (CSS-only, peer-provided, or spawned by path) —
 * never a duplicate that another manifest already declares.
 */
const config: KnipConfig = {
  // TODO(knip-baseline): vendored shadcn/ui components are upstream copies, not
  // this repo's code — removed in the dead-code/unused-package cleanup PR once
  // the vendored surface is re-reviewed.
  ignore: ['packages/ui/src/components/ui/**'],

  // Policy, not a baseline suppression: an export that is still used inside its
  // own file is not dead code. Only interfaces and types are covered here.
  ignoreExportsUsedInFile: { interface: true, type: true },

  ignoreIssues: {
    // TODO(knip-baseline): generated Supabase types file, converted to a
    // documented policy in the follow-up PR.
    'packages/server/src/types/database.ts': ['exports', 'types'],
    // TODO(knip-baseline): unused exports/types whose declarations are still
    // referenced or are kept for a follow-up — deleting them would change a
    // declaration, which this pass deliberately avoids.
    '__tests__/integration/helpers.ts': ['exports'],
    'apps/admin/src/server/models/feature-flag.model.ts': ['types'],
    'apps/admin/src/server/models/plan-feature.model.ts': ['exports', 'types'],
    'apps/admin/src/server/models/plan-limit.model.ts': ['exports', 'types'],
    'apps/admin/src/server/models/platform-stats.model.ts': ['types'],
    'apps/admin/src/server/models/user-admin.model.ts': ['types'],
    'apps/admin/src/server/models/user-feature-override.model.ts': ['types'],
    'apps/web/src/lib/color-utils.ts': ['exports'],
    'apps/web/src/lib/datetime.ts': ['exports'],
    'apps/web/src/lib/query-keys.ts': ['exports'],
  },

  // `__tests__/e2e/global-setup.ts` spawns the seeder as a bare path argument
  // (`spawnSync('bun', ['scripts/e2e-seed.ts', …])`), which knip resolves
  // relative to the spawning file instead of the repo root, so the specifier
  // never resolves. The file itself is still an entry (derived from
  // `verify.yml`); this only silences that unroutable string.
  ignoreUnresolved: ['scripts/e2e-seed.ts'],

  workspaces: {
    '.': {
      entry: [
        // Documented operator command (docs/deployment.md), not a package.json
        // script, so knip cannot discover it on its own.
        'scripts/stripe-bootstrap.ts',
        // Live operator/dev scripts: run by hand or spawned by path (the e2e
        // global setup spawns `e2e-seed.ts`), so they are entry points.
        'scripts/admin-sign.ts',
        'scripts/dev-registry.ts',
        'scripts/qa-issue.ts',
        'scripts/storage-orphan-sweep.ts',
        // `scripts/e2e-seed.ts` is also a live entry, but knip already derives
        // it from `verify.yml` (`bun scripts/e2e-seed.ts …`); listing it here
        // would be a redundant entry pattern and fail the gate.
      ],
    },
    'packages/ui': {
      // Optional peerDependencies provided by the consuming app: `next-themes`
      // and `next-intl` are imported only by the vendored shadcn/ui components
      // that `ignore` above keeps out of the graph.
      ignoreDependencies: ['next-intl', 'next-themes'],
    },
  },
};

export default config;
