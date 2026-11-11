# ADR-0013: Gate code duplication with jscpd

## Status

Accepted (2026-11-11). Tooling + CI change; no product code.

## Context

Nothing in the repo looks for copy/pasted code. `bun run lint` has no clone rule,
`knip` finds dead code rather than duplicated code, and review does not reliably
catch a helper that was copied instead of extracted. The duplication that
already exists is concentrated in the usual hotspots: the largest files are
`packages/server/src/services/teacher-assignment.service.ts` (1,261 lines),
`stripe-webhook.service.ts` (1,165), `scripts/seed/qa.ts` (1,123) and
`scripts/env/commands/ensure.ts` (1,108).

Measured with jscpd at `minTokens: 50`, `minLines: 5` over product code and
tooling (`apps/web/src`, `packages`, `scripts`, 724 files): **6.01% duplicated
lines, 467 clones**. That is low enough that a whole-tree threshold would be a
brittle gate and high enough that "fail on any duplication" is not an option.

Two properties matter for the gate:

- It must be actionable on a codebase that already has duplication, so a PR is
  judged on **what it adds**, not on the state of the tree.
- It must run without GitHub Actions as well, because a hook is feedback while
  the merge gate is the authority — a `git push --no-verify` must still be
  caught.

jscpd v5 fits: a Rust binary with no runtime dependency (the npm package installs
a platform binary as an optional dependency), baseline comparison built in, a
`--changed` mode for the working tree, and exit codes designed for CI. Version
5.4.2 was resolved by the repo's 7-day `[install] minimumReleaseAge`; 5.4.3 was
three days old when this landed.

## Decision

1. **Scope** is `apps/web/src`, `packages` and `scripts`. `__tests__` and
   `apps/admin` are out: test setup repeats on purpose (12.3% duplication at the
   same settings) and admin is already outside every other product gate. The
   generated database types, vendored shadcn components, i18n message JSON and
   `.agents` are ignored. `format` is restricted to code, so JSON/Markdown/YAML
   cannot drift into the scan.
2. **One config at the repo root**, `.jscpd.json`. It holds scope and ignores
   only: `path` and `ignore` resolve relative to the config file, so it must
   stay at the root, and `threshold` must not live there because it is
   whole-tree and would fail the new-clone runs on the duplication that already
   exists.
3. **The PR gate is new clones only**: `--baseline-from-ref origin/<base>
--fail-on-new-clones 0`. jscpd scans the base branch's tree with the same
   config and compares content fingerprints, so there is no committed baseline
   to regenerate. It runs at the end of the `checks` job (so a failure cannot
   skip `typecheck`), and fetches the base ref with `--depth=1` because the job
   is otherwise a shallow checkout.
4. **The nightly/dispatch run reports and ratchets**: `--dashboard --history
--threshold 6.5`. The dashboard covers health, size, duplication, complexity
   and dead code; `--history` replays the last 30 commits from git, so the trend
   needs no stored state. The Markdown report is appended to the run summary and
   the report directory is uploaded as an artifact (90 days). Reports are
   written before the threshold is evaluated, so a red run still publishes the
   numbers that explain it. The threshold is a backstop, not the primary gate;
   lower it as the number drops.
5. **Hooks are the same comparison locally**: `pre-commit` runs
   `bun run dup:changed` (working tree vs `HEAD`, `--changed`, baseline in
   Git-ignored `.tmp/`); `pre-push` runs `bun run dup:base` (new clones vs
   `origin/main`, reusing the fetch the merge-conflict check already does).
6. **No wrapper script.** The tool needs no environment values and no external
   service, and the hooks and CI only need to choose a mode, so three
   `package.json` scripts and raw flags are enough. Keeping at least one script
   that names the binary is also what makes `knip` see the dependency.
7. **`dup` is not part of `bun run lint`.** Like `knip`, it is a sibling gate:
   it is cheap but not a formatter/linter, and it should not run in
   `cache-warm` or in workspace-level lint commands.

## Deferred: SARIF / GitHub code scanning

SARIF is the JSON findings format that GitHub Code Scanning ingests; alerts then
appear under **Security → Code scanning**, annotate the PR diff and persist until
fixed or dismissed. jscpd can emit it with `--reporters sarif`, and uploading
needs `permissions: security-events: write` plus
`github/codeql-action/upload-sarif`. The repo is public, so code scanning itself
is free.

It is deferred because jscpd's SARIF contains **every** clone, not only the new
ones: the measured run produced 467 results (3 `error` for new clones, 464
`warning` for existing ones). Enabling it now would open a 464-alert warning
backlog, which is noise rather than signal. Revisit when there is appetite to
triage that backlog, and run it on the nightly only — the PR gate stays the exit
code + the new-clone list.

## Consequences

- One more dev dependency (~47 MB platform binary, restored from the Bun cache
  in CI) and roughly one second on the `checks` job; the nightly trend scan took
  ~24 s locally for 30 commits.
- New duplication is blocked in PRs and in both hooks; old duplication is
  tolerated. Moving a clone or deleting a file does not trip the gate; adding a
  third copy of a known clone does (fingerprints are counted, not just set
  membership).
- `--changed` reads `git status`, so unstaged edits count. A partially staged
  file can therefore block a commit on a change the developer did not stage.
  This is the documented jscpd behavior and the reason the pre-commit step runs
  after the fixer.
- There is no global suppression mechanism, by design. A deliberate parallel
  implementation can be annotated with `jscpd:ignore-start` / `jscpd:ignore-end`
  comments at the site, which keeps the exception reviewable and local.
- Duplication can still grow in `__tests__` and `apps/admin` unnoticed. Revisit
  with separate scopes and thresholds if either becomes a problem.

## Alternatives considered

- **Threshold on every PR** (`--threshold 6.5`) — fails on pre-existing clones,
  so it would be red from day one and teaches people to ignore it.
- **A committed `.jscpd-baseline.json`** — works, but adds a file that must be
  regenerated on every accepted clone and rots between refactors. The base-ref
  comparison needs no maintenance.
- **The `kucherenko/jscpd` GitHub Action** — installs the binary outside
  `bun.lock`, so the version would be pinned twice (action + Dependabot) and
  bypass the lockfile-age gate. The local dev dependency fits the existing
  `knip`/`lefthook` pattern.
- **Other detectors** (PMD CPD, Simian, duplo, fallow) — weaker
  TypeScript/TSX coverage, a JVM/runtime requirement, or no new-clone mode.
- **Scanning tests and admin from day one** — high duplication that is mostly
  fixture/setup repetition, and admin is outside the product gates.

## References

- [docs/ci.md → Duplication](../ci.md#duplication)
- `.jscpd.json`, `lefthook.yml`, `.github/workflows/verify.yml`
- jscpd: [CI & pre-commit hooks](https://github.com/kucherenko/jscpd/blob/master/docs/ci-and-hooks.md),
  [baseline](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md#baseline)
