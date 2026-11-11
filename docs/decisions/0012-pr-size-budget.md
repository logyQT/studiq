# ADR-0012: Enforce a reviewable-line budget for pull requests

## Status

Accepted (2026-11-10), partially superseded (2026-11-11). Process change only; no product code.

> **Update (2026-11-11): CodeRabbit was retired.** `.coderabbit.yaml` and the
> manual `@coderabbitai review` entry point are gone. The PR size budget,
> `size/*` labels and `size:exception` bypass in this ADR remain. PR review now
> uses the repo-owned `studiq-review` skill, with `studiq-qa` for the in-app
> verification.

## Context

Reviewing oversized PRs is slow and expensive, and an agent cannot review a
6,000-line PR without carrying the whole feature's context. Review rounds also
tend to add hardening to the same branch instead of splitting it, so a
ballooning PR grows further instead of shrinking.

CodeRabbit used to review every push on every PR. Its schema enables a broad
static toolset by default (ast-grep, semgrep, shellcheck, actionlint, squawk,
gitleaks, oxc), so a meaningful share of its comments were deterministic
findings rather than LLM judgement. Some of those are already covered twice in
this repo — `oxc` is `bun run lint`, and `gitleaks` overlaps the secret-literal
scan in `scripts/check-env-inventory.ts` plus `bun run env:scan` — but the
shell, YAML and SQL checks were only in CodeRabbit.

`verify.yml` is the merge gate; CodeRabbit is advisory
(`auto_approvals.enabled: false`). This decision does not change that split.

## Decision

1. **CodeRabbit was made manual-only, then retired (2026-11-11).** At the time,
   `reviews.auto_review.enabled` was `false` and there was no label trigger: a
   review started only when a maintainer commented `@coderabbitai review`.
   `auto_incremental_review` was also `false`, so a later push did not re-run a
   hand-requested review. No automated reviewer remains; use the repo-owned
   `studiq-review` skill.
2. **`scripts/pr-triage.ts` owns the measurement.** It counts added + deleted
   lines with Git rename detection, excluding tests, Markdown docs, generated
   files, the lockfile and vendored skills. `bun run pr:size` runs it locally;
   `.github/workflows/pr-triage.yml` runs it on every PR.
3. **The workflow labels every PR** with `size/XS|S|M|L|XL` from the measured
   budgeted line count. The label is informational; it never triggers a review.
   The buckets hold one invariant: over budget is always `size/XL`. The
   `XS`/`S`/`M` boundaries are absolute (10/50/200), so `L` only appears when
   the limit is above 200.
4. **`scripts/pr` applies the same size label at creation.**
5. **Advisory first.** Over-budget labels are informational until the repository
   variable `PR_SIZE_ENFORCE=true` is set; then the job fails unless the PR
   carries `size:exception`. The budget is the `PR_SIZE_LIMIT` repository
   variable (default 400, passed to the script as `--limit`; set it to 300 to
   tighten without a code change). Setup: [docs/ci.md](../ci.md#repository-variables).

### What counts

- **Budget:** all changed lines except the exclusions below.
- **Excluded from the budget, still reported:** `__tests__/**`, `*.test.*`,
  `*.spec.*`, `*.md`, `*.mdx`, `bun.lock`,
  `packages/server/src/types/database.ts` (generated),
  `eslint-suppressions.json`, `skills-lock.json`, `.agents/skills/**`.
- **Renames** use Git's rename detection, so a move is not counted as churn.
- **Tests and docs are excluded on purpose:** a large test suite or design doc is
  still reviewable and still reported, but it should not consume the
  production-code budget.
- **Still counted:** code and i18n message JSON. i18n is data, but key symmetry
  is review surface; add it to the exclusions only with a measurement.

## Consequences

- Nothing reviews a PR automatically, and CodeRabbit has since been retired
  along with its deterministic toolset. The follow-up is to add shellcheck (bash), actionlint
  (workflows) and squawk (migrations) to CI, scoped to changed files; tracking
  issue #1100 covers it.
- The retired `review:deep` label has been deleted from the repository. No label
  gates or starts a review now.
- CodeRabbit's pre-merge checks (title, description, linked issue, English-only)
  now run only on reviews requested by hand. They were warnings, not gates; the
  hard gates remain in `verify.yml`.
- A huge test-only or docs-only PR passes the budget. That is accepted: the
  budget targets production-code risk, and both are still review surface.
- The budget can be gamed by splitting a feature into artificial PRs. That is
  the intended behaviour — stacked PRs are easier to review than one large one.
- `size:exception` is the explicit operator bypass. It should carry a reason in
  the PR body, not be used as a default.

## Follow-ups

- Add shellcheck, actionlint and squawk to the `checks` job (changed-file
  scoped) or to a local `bun run review` command — tracked in #1100.
- Collect ~20 recent CodeRabbit findings and encode the recurring deterministic
  ones as `scripts/check-*.ts` rules; do not add semgrep/ast-grep wholesale.
- Revisit the limit after a few weeks of data: 400 reviewable lines is the
  starting point; 300 is a one-variable change if reviews still feel heavy.
