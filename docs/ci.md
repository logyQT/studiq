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
added to the ruleset.

## Workflows

| File                               | Trigger                                                | Role                                                          |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `.github/workflows/verify.yml`     | every PR, nightly 03:00 UTC, manual                    | The gate: `scope` router → `checks` + unit/integration/QA/e2e |
| `.github/workflows/pr-triage.yml`  | PR opened/synchronize/reopened/ready/labeled/unlabeled | Size label + `review:deep`; optional budget gate              |
| `.github/workflows/cache-warm.yml` | push to `main`, manual                                 | Refreshes bun/Playwright/Next caches; not a gate              |

### `verify.yml` jobs

- `scope` — diff router. Publishes `app` and `qa_shards`; docs-only,
  `apps/admin`-only and QA-only PRs skip the jobs they cannot affect. `checks`
  is deliberately ungated (ADR-0008).
- `checks` — `format:check`, `lint`, `env:check`, `env:scan`, `knip`,
  `typecheck:all`.
- `unit` / `integration` — gated on `scope.app`.
- `qa-suite` — one runner per shard from `scope.qa_shards`.
- `e2e` — always runs the chromium and firefox legs so the required names exist;
  the steps no-op when `scope.app` is false.

CI runs its own Supabase instance per job with the native runtime; see the
`env:` block and the Supabase steps in `verify.yml`. It is not the local
`bun dev:up` stack.

## Repository variables

GitHub: **Settings → Secrets and variables → Actions → Variables**.

Variables are plaintext and **not masked**. Never put a secret in this tab.

| Name              | Default         | Effect                                                                                                        |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `PR_SIZE_ENFORCE` | unset (`false`) | `pr-triage` fails an over-budget PR unless it carries `size:exception`. Must be the literal string `true`.    |
| `PR_SIZE_LIMIT`   | `400`           | Reviewable-line budget passed to `scripts/pr-triage.ts` as `--limit`. Positive integer; set `300` to tighten. |

`PR_SIZE_ENFORCE` only blocks a merge when the `pr-triage` check is also
required in the `main` ruleset.

## Secrets

No workflow reads a repository or environment secret today. CI uses
`PAYMENT_DRIVER=mock`; Stripe secrets are local-only (see `docs/testing.md` →
"Stripe secrets in CI and forks"). A future workflow secret belongs in
**Settings → Secrets and variables → Actions → Secrets** (or an `environment:`
with reviewers), and should be documented here. Never echo it.

## Pinned versions

- Bun: `BUN_VERSION` in `verify.yml`, `cache-warm.yml` and `pr-triage.yml`;
  keep in step with `scripts/check-bun-version.ts`.
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
```

| CI job        | Local                                       |
| ------------- | ------------------------------------------- |
| `unit`        | `bun run test:unit`                         |
| `integration` | `bun run test:integration` (local Supabase) |
| `e2e`         | `bun run test:e2e`                          |
| `qa-suite`    | `bun run test:qa`                           |
| `pr-triage`   | `bun run pr:size`                           |

## Review routing

`pr-triage` labels every PR `size/*` and adds `review:deep` when it is over
budget or touches a sensitive path. CodeRabbit does not auto-review; it runs
when `review:deep` is present or a maintainer comments `@coderabbitai review`.
Details: [ADR-0012](decisions/0012-review-routing-and-pr-size.md).
