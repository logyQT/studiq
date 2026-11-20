# CI

GitHub Actions is the merge gate. `main` is the only long-lived branch; PRs
target it directly.

## Required checks

The `main` ruleset requires five contexts:

- `checks`
- `unit`
- `integration`
- `e2e (chromium)`
- `e2e (firefox)`

`pr-triage` is separate and currently advisory. It becomes a gate only when the
`PR_SIZE_ENFORCE` repository variable is `true` **and** the `pr-triage` check is
added to the ruleset. The check-run name is `pr-triage` because that is the job
id; the workflow is also named `pr-triage`, so the two match on purpose.

## Workflows

| File                               | Trigger                                                | Role                                                          |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `.github/workflows/verify.yml`     | every PR, nightly 03:00 UTC, manual                    | The gate: `scope` router → `checks` + unit/integration/QA/e2e |
| `.github/workflows/pr-triage.yml`  | PR opened/synchronize/reopened/ready/labeled/unlabeled | Size label; optional budget gate                              |
| `.github/workflows/cache-warm.yml` | push to `main`, manual                                 | Refreshes bun/Playwright/Next caches; not a gate              |

### `verify.yml` jobs

- `scope` — diff router. Publishes `app`, `qa_shards` and `ai_suite`; docs-only,
  `apps/admin`-only and QA-only PRs skip the jobs they cannot affect. `checks`
  is deliberately ungated (ADR-0008).
- `checks` — `format:check`, `lint`, `review:static --rules-only` (the ast-grep
  tautology rules and their tests), `env:check`, `env:scan`, `knip`,
  `typecheck:all`, then the duplication gate (PR: new clones vs the base
  branch; nightly: dashboard + trend report, see [Duplication](#duplication)).
- `unit` / `integration` — gated on `scope.app`.
- `qa-suite` — one runner per shard from `scope.qa_shards`.
- `ai-suite` — the QA cases that need a model (`__tests__/qa/AI`), run against
  the fake inference server (`scripts/fake-llm`, see
  [its design](ai/fake-inference-server.md)) so no job calls a provider. Starts
  when `scope.ai_suite` is true: the AI files, the code the chat is made of, the
  nightly run and a manual dispatch. One worker: the server's reset and journal
  are global. Files that belong to it alone never start a `qa-suite` shard.
- `e2e` — always runs the chromium and firefox legs so the required names exist;
  the steps no-op when `scope.app` is false.

CI runs its own Supabase instance per job with the native runtime; see the
`env:` block and the Supabase steps in `verify.yml`. It is not the local
`bun dev:up` stack.

## Flaky tests

A test that fails and then passes on retry is a **green leg**, so nothing used to
record it: the `line` reporter put a count in the job log and artifacts were
uploaded only `if: failure()`. Every Playwright step now runs
`--reporter=line,json` and uploads `test-results/` with `always()`, and writes a
**Flaky tests** table to the job summary — a flaky attempt's trace is in the
artifact too, because `trace: 'on-first-retry'` writes it for exactly those runs.

Both `PLAYWRIGHT_JSON_OUTPUT_DIR` and `PLAYWRIGHT_JSON_OUTPUT_NAME` are set, and
that is not redundant: Playwright resolves a bare `..._NAME` against the **config
file's** directory, so the QA runner (`__tests__/qa/playwright.qa.config.ts`)
would write its report to `__tests__/qa/test-results/`, where neither the summary
step nor the upload looks. `..._DIR` is resolved against the working directory.

`bun run flaky` (`scripts/flaky-report.ts`) reads those reports and ranks what
wobbles. It is built to be called by an agent, so the exit code is the verdict and
stdout is data:

```bash
bun run flaky                       # this checkout's test-results/ → JSON verdict
bun run flaky -- --text             # same, as a table
bun run flaky -- --runs 20          # last 20 verify runs, downloaded via gh
bun run flaky -- --runs 20 --branch main   # same, restricted to one branch
bun run flaky -- --dir path/to/dir  # any directory of reports (combines with --runs)
bun run flaky -- --summary          # GitHub step summary (what CI runs)
```

| exit | meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| `0`  | no flakes in anything it could read                                        |
| `1`  | at least one flaky test, or a test that **failed** in the reports read     |
| `2`  | bad usage, or `--runs` could not list or download runs                     |
| `3`  | no Playwright report found — "clean" would be a lie, so it does not say it |

`--summary` always exits `0`: it displays on a leg that may already be red for an
unrelated reason, and it must not decide. The table above describes the query
modes (`--text`, and the default JSON).

"Failed" means the test was still red after every retry **in at least one of the
reports read** — with `--runs 20`, that can be a run from three weeks ago. The
payload dates the read: `reports.earliest`/`reports.latest` are the reports'
`stats.startTime`, and the text and summary modes print the same span. Read
`failed`/`seenIn` and `lastError` for when, rather than treating `verdict:
"failing"` as "red right now". For the same reason, a stale `test-results/` left
by an earlier run is read as current — check the span before believing a verdict.

**No local run produces a report by default** (`test:e2e` keeps the html reporter,
`test:qa` uses `list`), so a local `bun run flaky` answers `3`: nothing was
checked. Either read CI (`--runs N`, the better signal — flakes need CI's load) or
replay the suite with `--reporter=line,json` and

```bash
PLAYWRIGHT_JSON_OUTPUT_DIR=test-results PLAYWRIGHT_JSON_OUTPUT_NAME=e2e.json \
  bunx playwright test --reporter=line,json
```

Each entry carries `flaky`/`failed` counts per `seenIn` runs, the slowest failed
attempt (the signal that separates a slow-but-legitimate wait from a race) and a
`reproduce` command with `--repeat-each=5 --retries=0`, since the ledger already
knows the test is unreliable and the replay is for reproducing the failure. QA
cases replay through `-c __tests__/qa/playwright.qa.config.ts`; without it the
root config's `testDir` would not find the spec. Downloads are cached in
`.tmp/flaky/<runId>/` (only this repo's `playwright-report-*`/`qa-suite-report-*`/
`ai-suite-report` artifacts, marked complete when the download finishes so a
partial one is retried), so a repeat call re-reads instead of re-downloading.

Raising the shared action budget (see `playwright/base.ts`) moves the threshold,
it does not remove flakes — the ledger's counts across runs are what tell you
whether a spec is genuinely fast with a slow tail or waiting on something real.

## Duplication

[jscpd](https://jscpd.dev) (pinned in `devDependencies`, configured by
`.jscpd.json`) guards against copy/pasted code in `apps/web/src`, `packages` and
`scripts`. `__tests__` and `apps/admin` are deliberately out of scope for now:
their setup code repeats on purpose, and every other gate already treats admin
as outside the product. Vendored shadcn components, the generated database
types and the i18n message JSON are ignored in the config.

The gate is **new clones only**, so it works on a codebase that already has
duplication (measured at ~6% when this landed) without a baseline file to
maintain:

- **Pull request** — `scripts/dup-baseline.ts --ref origin/<base>`. The gate
  scans the base ref's tree (`git worktree`, that tree's own `.jscpd.json`) and
  the working tree with jscpd in JSON mode, then compares the reports itself. A
  clone is identified by its **normalised block** (whitespace- and
  comment-insensitive) and **the files that hold it** — never by a line number,
  and never by the file pair jscpd reported: jscpd pairs a block shared by
  several files with whichever two detection meets first, so one edit re-pairs
  it and `--baseline-from-ref` calls the new pair new. On PR #1398 that produced
  **9** "new" clones, only 1 of them real. A clone is new iff a file of its pair
  changed and the base did not already hold that block in both files, which
  keeps a copy of any existing route (duplicated or not) red while a re-pairing
  stays quiet. Measured on that PR: **9 → 1**. Exit `0` clean, `1` new clones,
  `2` the comparison could not run.
- **Nightly / manual dispatch** — `--dashboard --history --threshold 6.5`. The
  dashboard prints health, size, duplication, complexity and dead code;
  `--history` recomputes the last 30 commits' trend from git, so nothing is
  stored. The Markdown report goes to the run summary and the whole report
  directory is uploaded as the `jscpd-dashboard` artifact (90 days). Lower the
  threshold as the number drops.
- **Dead-code entry points** — the dashboard builds its import graph from
  `deadCode.entry` in `.jscpd.json`. Next.js file conventions
  (`app/**/page.tsx`, `layout.tsx`, `route.ts`, …), `proxy.ts`,
  `i18n/request.ts` and the operator scripts (`check-*.ts`, `qa-*.ts`,
  `load-test/*.ts`, …) are entry points by definition, not dead code. The globs
  are matched relative to each scan root (`proxy.ts`, not
  `apps/web/src/proxy.ts`). Without them 19 live files read as dead — 3.4%
  instead of 0.2% — and the health score shows C 64 instead of B 70.
- **Hooks** — `pre-commit` runs `bun run dup:changed` (working tree vs `HEAD`)
  and `pre-push` runs `bun run dup:base` (the same comparison as CI against
  `origin/main`); both are `scripts/dup-baseline.ts --ref <ref>`, so the local
  verdict and the CI one cannot disagree about what "new" means. Hooks are local
  feedback; the CI step is the actual gate, so `git push --no-verify` still gets
  caught.

Locally, `bun run dup` scans the whole configured scope (console report),
`bun run dup:changed` lists clones new against `HEAD`, and `bun run dup:base`
lists new clones against `origin/main`. `--threshold` is
deliberately **not** in `.jscpd.json`: it is whole-tree and would fail the
changed/new-clone runs on the duplication that already exists.

**SARIF / GitHub code scanning is deferred.** jscpd can emit SARIF
(`--reporters sarif`) for the Security tab, but it reports _every_ clone: 467
results today (3 `error`, 464 `warning`), which would open a large warning
backlog. Revisit when there is appetite to triage it, most likely on the nightly
run only.

## Repository variables

GitHub: **Settings → Secrets and variables → Actions → Variables**.

Variables are plaintext and **not masked**. Never put a secret in this tab.

| Name              | Default         | Effect                                                                                                        |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `PR_SIZE_ENFORCE` | unset (`false`) | `pr-triage` fails an over-budget PR unless it carries `size:exception`. Must be the literal string `true`.    |
| `PR_SIZE_LIMIT`   | `400`           | Reviewable-line budget passed to `scripts/pr-triage.ts` as `--limit`. Positive integer; set `300` to tighten. |

`PR_SIZE_ENFORCE` only blocks a merge when the `pr-triage` check is also
required in the `main` ruleset. A non-numeric `PR_SIZE_LIMIT` is ignored with a
workflow warning and the default `400` is used.

## Secrets

No workflow reads a repository or environment secret today. CI uses
`PAYMENT_DRIVER=mock`; Stripe secrets are local-only (see `docs/testing.md` →
"Stripe secrets in CI and forks"). A future workflow secret belongs in
**Settings → Secrets and variables → Actions → Secrets** (or an `environment:`
with reviewers), and should be documented here. Never echo it.

## Pinned versions

- Bun: `BUN_VERSION` in `verify.yml`, `cache-warm.yml` and `pr-triage.yml`.
  Keeping these in step with the version pinned in `scripts/check-bun-version.ts`
  is **manual**: that script only enforces the local minimum and does not read
  workflow files.
- Actions: pinned major versions (`actions/checkout@v7`, ...). A new
  third-party action needs a pinned version and a note explaining why.

## Local equivalents

The `checks` job is:

```bash
bun run format:check
bun run lint
bun run review:static -- --rules-only
bun run env:check
bun run env:scan
bun run knip
bun run typecheck:all
bun run dup:base
```

| CI job        | Local                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `unit`        | `bun run test:unit`                                                                                  |
| `integration` | `bun run test:integration` (local Supabase)                                                          |
| `e2e`         | `bun run test:e2e`                                                                                   |
| `qa-suite`    | `bun run test:qa`                                                                                    |
| `ai-suite`    | `bun run mock:llm`, then `bun run test:qa __tests__/qa/AI` (the `LLM_*` values in root `.env.local`) |
| `pr-triage`   | `bun run pr:size`                                                                                    |
| flake report  | `bun run flaky` (or `-- --runs 20` for the last CI runs)                                             |

`bun run pr:size` measures committed changes only (`git diff <base>...HEAD`), so
commit before checking — uncommitted work is invisible to it.

## Review labels

`pr-triage` labels every PR `size/*` from its budgeted line count. `size/XL`
always means over budget; the `XS`/`S`/`M` boundaries are absolute (10/50/200),
so `size/L` only appears when the limit is above 200.

No push or label starts a review. Normal PRs use the repo-owned
`studiq-review` skill (`.agents/skills/studiq-review/SKILL.md`), which verifies
claims in the code, docs and running app. For an over-budget (`size/XL`) or
sensitive PR, request a manual CodeRabbit pass with `@coderabbitai review`;
`.coderabbit.yaml` keeps its path instructions and repo-specific rules, with
`auto_review.enabled: false` and no label trigger. Details:
[ADR-0012](decisions/0012-pr-size-budget.md).
