# Bun-native toolchain: two-phase migration

Status: **phase 1 implemented**, phase 2 deferred.

PR #173 (`experimental/bun-native-linter`) bundled two different changes:

1. swapping Biome + `tsc` for Bun's native `fmt` / `check` / `lint`, and
2. tightening the rule set (type-aware rules, `jsx-a11y`, `suspicious` categories,
   `maxWarnings = 0`, a baseline of 557 suppressed errors and ~3,800 warnings).

Those have very different risk profiles, so they are split.

## Phase 1 — parity swap (this change)

Goal: same developer-visible behaviour, different engine. No new rules are turned on, no
existing gate is weakened, no product code changes beyond two lint findings the new engine
reports and the formatter's own output.

- Bun **1.4.4** (currently `1.4.4-canary`, see below) provides the three tools; `engines.bun` is
  `>=1.4.4-canary` because the canary sorts *below* `1.4.4` in semver.
- `biome.json` and `@biomejs/biome` are gone; `bunfig.toml` is the single config.
- `bun fmt` replaces the Biome formatter:
  - `printWidth = 100`, `singleQuote = true` (Prettier defaults for everything else match the
    old Biome settings: 2-space indent, semicolons, `trailingComma = "all"`,
    `arrowParens = "always"`).
  - Markdown, YAML, TOML, HTML and JSONC are excluded, because Biome never formatted them.
- `bun check` replaces `tsc --noEmit` in every workspace `typecheck` script. It reads the same
  `tsconfig.json`, follows project references and reports tsc-shaped errors.
- `bun lint` replaces `biome ci`. Rule mapping:

  | Biome | Bun lint |
  | --- | --- |
  | `correctness/noUnusedVariables`, `noUnusedImports` | `@typescript-eslint/no-unused-vars` (default) |
  | `correctness/useExhaustiveDependencies` (error) | `react-hooks/exhaustive-deps` (error) |
  | `style/noRestrictedImports` (`./**`, `../**`) | `no-restricted-imports` patterns, off for `packages/**` |
  | `performance/noBarrelFile` | `oxc/no-barrel-file` with `threshold = 0` so any `export *` counts (off for `packages/*/src/index.ts`) |
  | `performance/noReExportAll` | covered by `oxc/no-barrel-file` |
  | `suspicious/noExplicitAny` off | `@typescript-eslint/no-explicit-any` off |
  | `a11y/*` off, `useButtonType` off | `jsx-a11y/*` off, `react/button-has-type` off |
  | `suspicious/useIterableCallbackReturn` off | `array-callback-return` off |
  | `suspicious/noEmptyBlockStatements` off | `no-empty` off |
  | `useHookAtTopLevel` off in `__tests__` | `react-hooks/rules-of-hooks` off in `__tests__` |

  The dedicated `scripts/check-import-paths.ts` and
  `scripts/check-migration-timestamps.ts` guards still run in `bun run lint`, so alias and
  migration rules are enforced by the same command as before.
- Hooks keep the same shape: pre-commit `bun fmt --staged` + `lint` + `typecheck:all`,
  pre-push `format:check` + `lint` + `typecheck:all` + `test:unit` + merge-conflict check.
- `scripts/check-bun-version.ts` fails fast, with upgrade instructions, when the running Bun
  lacks `bun lint`.

### Bun version caveat

`bun fmt` and `bun check` shipped in stable **1.4.4**. `bun lint` is still canary-only, so the
repo requires a 1.4.4 canary until 1.4.5 ships it (`bun upgrade --canary`). The devcontainer
does this in `postCreateCommand`. There is no CI workflow in the repo; hooks are the gate.

### Output differences

`bun fmt` is Prettier-compatible; Biome 2.x is close but not identical. Against the pre-change
tree the diff is **34 files (~300 insertions / ~230 deletions)**, of which:

- **13 files are pure formatter output** (25 insertions / 47 deletions, no logic): union types
  that fit on one line are collapsed (`| A | B` → `A | B`), `supabase.from(…).select(…)` chains
  re-wrap, `await import(...)` destructuring wraps differently, and CSS string quotes become
  single quotes (CSS only; values unchanged).
- **3 files carry comment-only edits**: `chart.tsx` rewrites the old
  `// biome-ignore lint/security/noDangerouslySetInnerHtml` into
  `// eslint-disable-next-line react/no-danger` (and `react/no-danger` is enabled at `error`, so
  the suppression still covers the only raw-HTML injection site);
  `report-thread-screen.tsx` **drops** its old `biome-ignore` for
  `useExhaustiveDependencies` because the new engine does not report that site;
  `scripts/fix-all-imports.ts` updates a comment.
- **2 files carry the lint fixes** listed below.
- the rest is config/docs (`bunfig.toml`, package manifests, lockfile, hooks, devcontainer,
  AGENTS/README/project-structure, this plan, `scripts/check-bun-version.ts`).

Nothing else changed.

Two lint findings appeared that Biome did not report. Both are behaviour-preserving:

- `topic-dialogs.tsx`: `getTopicIds` was a pure closure-free helper, so it moved to module scope
  and left the `useCallback` dependency list. No behaviour change.
- `detail-client.tsx`: the save-debounce effect listed `setTargetsMutation.mutate`; the new
  engine wants the owner of that property. Listing the mutation *object* would be a bug — its
  identity changes every render, so the effect (and its 500 ms `mutate`) would re-arm in a loop.
  Instead the stable `mutate` reference is captured once (`const saveTargets = …mutate`) and the
  effect depends on `saveTargets`.

### Behavioural deltas worth knowing

- **Pre-commit safe fixes are preserved; import sorting is not.** On `main`,
  `bunx biome check --write {staged_files}` formatted *and* applied Biome's safe lint fixes and
  organized imports. The hook now runs `bun fmt --staged` plus
  `bun lint --no-script --staged --fix` (both `stage_fixed: true`), which restores the safe lint
  fixes. Bun has no import-sort assist, so import ordering is no longer auto-applied on commit —
  `bun lint` does not enforce order either.
- **`format:check` is formatting-only now.** `biome ci .` used to lint as well; `bun run lint`
  is the separate gate, which is how the hooks already called them.
- **`typescript/prefer-optional-chain` stays a warning**, matching Biome, which reported
  `complexity/useOptionalChain` as a warning on `main`. Phase 2 turns on `maxWarnings = 0`.
- **`bun lint` on its own lints more than the gate.** The gate scopes are passed by the scripts
  (apps/*/src, packages, `__tests__`); a bare `bun lint` also walks scripts and configs.
- `typescript` remains a dependency because Next.js uses it for its own build-time checks, but
  no script invokes `tsc`.

## Phase 2 — stricter config (deferred, was the body of PR #173)

Not in this change, deliberately:

- `[lint] typeAware = true` and type-aware rules (`no-floating-promises`, `no-unsafe-*`, …),
- `[lint.categories] suspicious = "warn"`, then `perf`, then `style`,
- re-enabling the `jsx-a11y` rules and `react/button-has-type`,
- `--max-warnings 0` so warnings fail the run,
- driving the baseline of 557 errors / ~3,800 warnings to zero and deleting
  `eslint-suppressions.json` (which phase 1 does not introduce).

Phase 2 is a product-quality effort with its own PR(s) and should land only after phase 1 has
proven stable in day-to-day use.
