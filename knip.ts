import type { KnipConfig } from 'knip';

/**
 * Knip reads these settings through `bun run knip`, which always passes
 * `--treat-config-hints-as-errors`: a suppression that is no longer needed
 * becomes a failing gate, so the baseline below cannot silently rot.
 *
 * Every suppression block in the baseline ledger is prefixed with
 * `TODO(knip-baseline):` so the dead-code/unused-package cleanup PR can grep
 * the marker and remove the matching block together with the code or packages
 * it covers. Homogeneous arrays (one package per line) share one marker; delete
 * the entry and, when the array is empty, its marker. Do not add new entries
 * without a matching finding.
 *
 * Most options are covered by `--treat-config-hints-as-errors`: a stale `ignore`,
 * `ignoreFiles`, `ignoreDependencies`, `ignoreBinaries` or `ignoreUnresolved`
 * entry fails the gate. `ignoreIssues` entries are NOT hint-checked, so the
 * cleanup PR must remove them by hand when it deletes the matching export.
 */
const config: KnipConfig = {
  // TODO(knip-baseline): vendored shadcn/ui components are upstream copies, not
  // this repo's code — removed in the dead-code/unused-package cleanup PR once
  // the vendored surface is re-reviewed.
  ignore: ['packages/ui/src/components/ui/**'],

  // Policy, not a baseline suppression: an export that is still used inside its
  // own file is not dead code. Only interfaces and types are covered here.
  ignoreExportsUsedInFile: { interface: true, type: true },

  ignoreFiles: [
    // TODO(knip-baseline): operator scripts knip cannot discover as entry
    // points — manifest entry points arrive in the follow-up PR.
    'scripts/admin-sign.ts',
    'scripts/dev-registry.ts',
    'scripts/qa-issue.ts',
    'scripts/storage-orphan-sweep.ts',
  ],

  ignoreIssues: {
    // TODO(knip-baseline): unused exports/types in a generated Supabase types
    // file — removed in the dead-code/unused-package cleanup PR.
    'packages/server/src/types/database.ts': ['exports', 'types'],
    // TODO(knip-baseline): unused test fixture/helper exports — removed in the
    // dead-code/unused-package cleanup PR.
    '__tests__/e2e/fixtures/profiles.ts': ['exports'],
    '__tests__/integration/helpers.ts': ['exports'],
    // TODO(knip-baseline): unused admin controller export — removed in the
    // dead-code/unused-package cleanup PR.
    'apps/admin/src/server/controllers/organization-admin.controller.ts': ['exports'],
    // TODO(knip-baseline): unused admin model exports/types — removed in the
    // dead-code/unused-package cleanup PR.
    'apps/admin/src/server/models/feature-flag.model.ts': ['types'],
    'apps/admin/src/server/models/plan-feature.model.ts': ['exports', 'types'],
    'apps/admin/src/server/models/plan-limit.model.ts': ['exports', 'types'],
    'apps/admin/src/server/models/platform-stats.model.ts': ['types'],
    'apps/admin/src/server/models/user-admin.model.ts': ['exports', 'types'],
    'apps/admin/src/server/models/user-feature-override.model.ts': ['types'],
    // TODO(knip-baseline): unused web exports — removed in the
    // dead-code/unused-package cleanup PR.
    'apps/web/src/hooks/use-notifications.ts': ['exports'],
    'apps/web/src/lib/color-utils.ts': ['exports'],
    'apps/web/src/lib/datetime.ts': ['exports'],
    'apps/web/src/lib/landing-pricing.ts': ['exports'],
    'apps/web/src/lib/pricing-limits.ts': ['exports'],
    'apps/web/src/lib/query-keys.ts': ['exports'],
  },

  ignoreUnresolved: [
    // TODO(knip-baseline): the e2e global setup spawns this script by path, so
    // knip cannot resolve the import specifier — removed in the
    // dead-code/unused-package cleanup PR.
    'scripts/e2e-seed.ts',
  ],

  workspaces: {
    // Root dependencies are duplicated by the workspaces and are unused at the
    // root (knip v6 isolates workspaces). Removing the duplicates is the
    // follow-up PR's job; until then each name below is a real finding.
    '.': {
      // Documented operator command (docs/deployment.md), not a package.json
      // script, so knip cannot discover it on its own.
      entry: ['scripts/stripe-bootstrap.ts'],
      // TODO(knip-baseline): dependencies and devDependencies that only
      // workspaces (or PostCSS tooling) use and that are unused at root, plus
      // the `stripe` import from root tests/scripts that root package.json does
      // not list — removed in the dead-code/unused-package cleanup PR.
      ignoreDependencies: [
        '@ai-sdk/openai',
        '@ai-sdk/react',
        '@dicebear/core',
        '@dicebear/styles',
        '@dnd-kit/core',
        '@dnd-kit/sortable',
        '@dnd-kit/utilities',
        '@hookform/resolvers',
        '@opentelemetry/auto-instrumentations-node',
        '@opentelemetry/exporter-trace-otlp-http',
        '@opentelemetry/resources',
        '@opentelemetry/sdk-node',
        '@opentelemetry/semantic-conventions',
        '@radix-ui/react-accordion',
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-aspect-ratio',
        '@radix-ui/react-avatar',
        '@radix-ui/react-checkbox',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-context-menu',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-hover-card',
        '@radix-ui/react-label',
        '@radix-ui/react-menubar',
        '@radix-ui/react-navigation-menu',
        '@radix-ui/react-popover',
        '@radix-ui/react-progress',
        '@radix-ui/react-radio-group',
        '@radix-ui/react-scroll-area',
        '@radix-ui/react-select',
        '@radix-ui/react-separator',
        '@radix-ui/react-slider',
        '@radix-ui/react-slot',
        '@radix-ui/react-switch',
        '@radix-ui/react-tabs',
        '@radix-ui/react-toast',
        '@radix-ui/react-toggle',
        '@radix-ui/react-toggle-group',
        '@radix-ui/react-tooltip',
        '@tailwindcss/postcss',
        '@tiptap/core',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-underline',
        '@tiptap/pm',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@types/turndown',
        'autoprefixer',
        'class-variance-authority',
        'clsx',
        'cmdk',
        'date-fns',
        'embla-carousel-react',
        'highlight.js',
        'input-otp',
        'katex',
        'lucide-react',
        'marked',
        'motion',
        'next-themes',
        'playwright-core',
        'postcss',
        'postcss-load-config',
        'react-day-picker',
        'react-markdown',
        'rehype-highlight',
        'rehype-katex',
        'rehype-raw',
        'rehype-sanitize',
        'remark-gfm',
        'remark-math',
        'sonner',
        'stripe',
        'tailwind-merge',
        'tailwindcss',
        'turndown',
        'tw-animate-css',
        'vaul',
      ],
    },
    'apps/admin': {
      // TODO(knip-baseline): unused workspace dependencies — removed in the
      // dead-code/unused-package cleanup PR.
      ignoreDependencies: ['zod'],
    },
    'apps/web': {
      // TODO(knip-baseline): unused workspace dependencies, devDependencies and
      // unlisted imports — removed in the dead-code/unused-package cleanup PR.
      ignoreDependencies: [
        '@ai-sdk/openai',
        '@ai-sdk/openai-compatible',
        '@radix-ui/react-accordion',
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-aspect-ratio',
        '@radix-ui/react-avatar',
        '@radix-ui/react-checkbox',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-context-menu',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-hover-card',
        '@radix-ui/react-label',
        '@radix-ui/react-menubar',
        '@radix-ui/react-navigation-menu',
        '@radix-ui/react-popover',
        '@radix-ui/react-progress',
        '@radix-ui/react-radio-group',
        '@radix-ui/react-scroll-area',
        '@radix-ui/react-select',
        '@radix-ui/react-separator',
        '@radix-ui/react-slider',
        '@radix-ui/react-slot',
        '@radix-ui/react-switch',
        '@radix-ui/react-tabs',
        '@radix-ui/react-toast',
        '@radix-ui/react-toggle',
        '@radix-ui/react-toggle-group',
        '@radix-ui/react-tooltip',
        '@tiptap/core',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-underline',
        '@tiptap/pm',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@types/turndown',
        'class-variance-authority',
        'date-fns',
        'embla-carousel-react',
        'highlight.js',
        'input-otp',
        'marked',
        'react-day-picker',
        'react-resizable-panels',
        'remark-parse',
        'remark-stringify',
        'turndown',
        'unified',
        'unpdf',
        'vaul',
      ],
    },
    'packages/authz': {
      // TODO(knip-baseline): unused workspace dependencies — removed in the
      // dead-code/unused-package cleanup PR.
      ignoreDependencies: ['@supabase/supabase-js', 'zod'],
    },
    'packages/server': {
      // TODO(knip-baseline): unused workspace dependency — removed in the
      // dead-code/unused-package cleanup PR.
      ignoreDependencies: ['consola'],
    },
    'packages/ui': {
      // TODO(knip-baseline): unused dependency and referenced optional peer
      // dependencies — removed in the dead-code/unused-package cleanup PR.
      ignoreDependencies: ['next-intl', 'next-themes', 'tw-animate-css'],
    },
  },
};

export default config;
