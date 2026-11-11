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

- `scope` — diff router. Publishes `app` and `qa_shards`; docs-only,
  `apps/admin`-only and QA-only PRs skip the jobs they cannot affect. `checks`
  is deliberately ungated (ADR-0008).
- `checks` — `format:check`, `lint`, `env:check`, `env:scan`, `knip`,
  `typecheck:all`, then the duplication gate (PR: new clones vs the base
  branch; nightly: dashboard + trend report, see [Duplication](#duplication)).
- `unit` / `integration` — gated on `scope.app`.
- `qa-suite` — one runner per shard from `scope.qa_shards`.
- `e2e` — always runs the chromium and firefox legs so the required names exist;
  the steps no-op when `scope.app` is false.

CI runs its own Supabase instance per job with the native runtime; see the
`env:` block and the Supabase steps in `verify.yml`. It is not the local
`bun dev:up` stack.

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

- **Pull request** — `--baseline-from-ref origin/<base> --fail-on-new-clones 0`.
  jscpd scans the base branch's tree with the same config and fails only on
  clones whose fingerprint is absent there. At most one duplicated block is
  reported per new clone, with file, line range and token count.
- **Nightly / manual dispatch** — `--dashboard --history --threshold 6.5`. The
  dashboard prints health, size, duplication, complexity and dead code;
  `--history` recomputes the last 30 commits' trend from git, so nothing is
  stored. The Markdown report goes to the run summary and the whole report
  directory is uploaded as the `jscpd-dashboard` artifact (90 days). Lower the
  threshold as the number drops.
- **Hooks** — `pre-commit` runs `bun run dup:changed` (working tree vs `HEAD`,
  baseline kept in Git-ignored `.tmp/`); `pre-push` runs `bun run dup:base`
  (the same comparison as CI). Hooks are local feedback; the CI step is the
  actual gate, so `git push --no-verify` still gets caught.

Locally, `bun run dup` scans the whole configured scope (console report),
`bun run dup:changed` lists clones that touch uncommitted files, and
`bun run dup:base` lists new clones vs `origin/main`. `--threshold` is
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
bun run env:check
bun run env:scan
bun run knip
bun run typecheck:all
bun run dup:base
```

| CI job        | Local                                       |
| ------------- | ------------------------------------------- |
| `unit`        | `bun run test:unit`                         |
| `integration` | `bun run test:integration` (local Supabase) |
| `e2e`         | `bun run test:e2e`                          |
| `qa-suite`    | `bun run test:qa`                           |
| `pr-triage`   | `bun run pr:size`                           |

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
