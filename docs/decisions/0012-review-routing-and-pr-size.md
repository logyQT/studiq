# ADR-0012: Route reviews by size and risk; enforce a reviewable-line budget

## Status

Accepted (2026-11-10). Process change only; no product code.

## Context

CodeRabbit reviewed every push on every PR. Its schema enables a broad static
toolset by default (ast-grep, semgrep, shellcheck, actionlint, squawk, gitleaks,
oxc), so a meaningful share of its comments were deterministic findings rather
than LLM judgement. Some of those are already covered twice in this repo —
`oxc` is `bun run lint`, and `gitleaks` overlaps the secret-literal scan in
`scripts/check-env-inventory.ts` plus `bun run env:scan` — but the shell, YAML
and SQL checks were only in CodeRabbit.

At the same time, every PR paid for a full LLM review, and the mechanical
findings arrived as inline comments instead of a blocking CI result. The repo
wants to move to a strict review budget (target 400 lines, possibly 300), which
makes small PRs cheap for the operator's agents to review themselves. The LLM
pass is most valuable on large or risky PRs, not on every 40-line change.

`verify.yml` is the merge gate; CodeRabbit is advisory
(`auto_approvals.enabled: false`). This decision does not change that split.

## Decision

1. **CodeRabbit is on demand.** `reviews.auto_review.enabled` is `false`; a PR
   is reviewed when it carries `review:deep`, or when a maintainer comments
   `@coderabbitai review`. `path_instructions` and the `assertive` profile stay
   — they are what make a deep review worth paying for.
2. **`scripts/pr-triage.ts` owns the measurement.** It counts added + deleted
   lines with Git rename detection, excluding tests, Markdown docs, generated
   files, the lockfile and vendored skills. `bun run pr:size` runs it locally;
   `.github/workflows/pr-triage.yml` runs it on every PR.
3. **The workflow labels every PR** with `size/XS|S|M|L|XL` and adds
   `review:deep` when the PR is over budget **or** touches a sensitive path
   (auth, tenancy, Supabase clients, migrations/schemas, billing/Stripe,
   `apps/admin`, workflows, guard scripts). A small auth PR gets reviewed even
   when the size is fine.
4. **`scripts/pr` applies the same labels at creation** and accepts `--deep`
   for a risk the heuristic misses.
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
- **Contract and decision docs stay sensitive:** `AGENTS.md` and
  `docs/decisions/**` are in the deep-review path even though Markdown is outside
  the size budget.

## Consequences

- The deterministic checks CodeRabbit used to run on every PR are no longer
  automatic. The follow-up is to add shellcheck (bash), actionlint (workflows)
  and squawk (migrations) to CI, scoped to changed files.
- CodeRabbit's pre-merge checks (title, description, linked issue, English-only)
  now run only on deep-reviewed PRs. They were warnings, not gates; the hard
  gates remain in `verify.yml`.
- A huge test-only or docs-only PR passes the budget. That is accepted: the
  budget targets production-code risk, and both are still review surface.
  Contract and decision docs still trigger a deep review by path.
- The budget can be gamed by splitting a feature into artificial PRs. That is
  the intended behaviour — stacked PRs are easier to review than one large one.
- `size:exception` is the explicit operator bypass. It should carry a reason in
  the PR body, not be used as a default.

## Follow-ups

- Add shellcheck, actionlint and squawk to the `checks` job (changed-file
  scoped) or to a local `bun run review` command.
- Collect ~20 recent CodeRabbit findings and encode the recurring deterministic
  ones as `scripts/check-*.ts` rules; do not add semgrep/ast-grep wholesale.
- Revisit the limit after a few weeks of data: 400 reviewable lines is the
  starting point; 300 is a one-variable change if reviews still feel heavy.
