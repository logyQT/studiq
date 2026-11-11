# ADR-0008: Keep the `scope` gate in `verify.yml`

## Status

Accepted (2026-11-04). Resolves #1022. No workflow behaviour changes.

## Context

`verify.yml` starts `unit`, `integration`, `qa-suite` and `e2e` with
`needs: [scope]`. `scope` is a diff router: it publishes `app` (does the PR
touch anything outside `qa/`, `__tests__/`, `docs/`, `apps/admin/` and `*.md`?)
and `qa_shards` (which QA areas a PR touches). A Markdown-only docs PR (every
changed file is `*.md`, none under `qa/cases/`) selects no QA shards; a
non-Markdown `docs/` file (e.g. `docs/image.png`) is `app=false` but selects
all four, because the router cannot attribute it. An `apps/admin`-only change
is not a product change (admin is an internal tool outside the product gates
and QA — ADR-0009): it is `app=false` and selects no shard. Issue #1022 asked
whether that gate should be removed so the test/build jobs start immediately.
`checks` is already ungated; `cache-warm.yml` keeps its own
`needs: [checks]`, which is unrelated and must stay.

The constraint is the branch ruleset, not classic protection. `main` requires
exactly five contexts:

- `checks`
- `unit`
- `integration`
- `e2e (chromium)`
- `e2e (firefox)`

`strict_required_status_checks_policy` is on. The e2e names only exist once the
job's matrix expands, so the e2e job must keep running on every PR and gate its
_steps_ instead of the job — a job-level `if:` would make the two required
names disappear and stay pending.

## Decision

Keep `needs: [scope]` on `unit`, `integration`, `qa-suite` and `e2e`.
`checks` stays ungated. `cache-warm.yml` is untouched.

## Measurements

### Aggregate (36 recent `verify` runs, app-only and mixed PRs)

| Metric                                         | min  | median | mean   | max    |
| ---------------------------------------------- | ---- | ------ | ------ | ------ |
| `scope` job duration                           | 5 s  | 6 s    | 6.2 s  | 8 s    |
| `scope` end → first gated job start            | 1 s  | 3 s    | 18.4 s | 320 s  |
| first required check start (`checks`, ungated) | 3 s  | 4 s    | 23.5 s | 111 s  |
| total workflow wall clock                      | 26 s | 470 s  | 570 s  | 1814 s |

The gate's estimated critical-path cost is `scope` + scheduling: **~9 s**
(6 s median router + 3 s median delay to the first gated job). This is an
estimate from measured components, not an A/B measurement: an ungated job would
still pay the same runner queue and its own first step. It does **not** delay
the first required check: `checks` is ungated and starts at a median of 4 s.
The long tail in both columns is GitHub runner queueing, not the gate — run
[41930419380](https://github.com/logyQT/studiq/actions/runs/41930419380)
queued every job for 89 s, including ungated `checks`.

### Controlled runs

| PR class                     | Run                                                                      | `scope` | `checks` | e2e legs      | `unit` / `integration` | `qa-suite`           | Total     |
| ---------------------------- | ------------------------------------------------------------------------ | ------- | -------- | ------------- | ---------------------- | -------------------- | --------- |
| Markdown-only docs           | [41936449012](https://github.com/logyQT/studiq/actions/runs/41936449012) | 8 s     | 32 s     | 3–4 s (no-op) | skipped                | not started          | **36 s**  |
| QA-only (`__tests__/qa/STU`) | [41936509462](https://github.com/logyQT/studiq/actions/runs/41936509462) | 6 s     | 22 s     | 3–4 s (no-op) | skipped                | 244 s (`stu`)        | **256 s** |
| app-only                     | [41932039493](https://github.com/logyQT/studiq/actions/runs/41932039493) | 7 s     | 25 s     | 177 s / 378 s | 47 s / 78 s            | 210–285 s (4 shards) | **393 s** |
| app-only, queued             | [41930419380](https://github.com/logyQT/studiq/actions/runs/41930419380) | 7 s     | 21 s     | 276 s / 365 s | 51 s / 113 s           | 218–270 s (4 shards) | **464 s** |

The two throwaway PRs were branched from `main` and closed unmerged. Their
head commits still show all five required contexts:

- Markdown-only docs `d7c3c32`: `checks` success, `unit` skipped, `integration`
  skipped, `e2e (chromium)` success, `e2e (firefox)` success.
- QA-only `80fe7ce`: the same five, with the same conclusions.

Skipped jobs satisfy the ruleset (a skipped job reports a successful check),
and the e2e matrix still expands because the job has no `if:`.

### What removing the gate would cost

1. **Run everything unconditionally.** This is the only variant that starts
   real work at t=0. On a Markdown-only docs PR (the 36 s case) it adds the
   measured durations of every job that is currently skipped: `unit` 47–53 s,
   `integration` 78–141 s, `e2e` 177–378 s per leg, and four QA shards at
   210–285 s each — about **28 runner-minutes**, taking the run to roughly
   6–7 minutes. A non-Markdown `docs/` file already starts all four QA shards,
   so it adds only the two unit/integration runners and both e2e legs (~13
   runner-minutes). A QA-only PR gains the same ~13 runner-minutes and grows
   from 256 s to ~6 minutes. Rejected.
2. **Recompute the filter inside each job.** The job starts immediately, but
   still has to learn what changed before it can skip: repeating `scope`'s
   checkout + diff costs the same ~3 s (measured step timings), and a
   `gh api repos/:owner/:repo/pulls/:n/files` call costs ~0.64 s locally. So
   the variant recovers only the **~3 s scheduling gap** — about 0.8 % of a
   393 s app run — while adding two runner boots (`unit`, `integration`) on
   every docs/QA-only PR and duplicating the router in three jobs. `qa-suite`
   cannot use it at all: its matrix is `fromJSON(needs.scope.outputs.qa_shards)`.
   Rejected.
3. **Split `verify.yml` into `paths` / `paths-ignore` workflows.** The only way
   to avoid the gate without doing the work, but it requires the same five
   contexts to be emitted by two workflows. Duplicate check names are
   ambiguous to the ruleset, and a missed path pair leaves a required context
   permanently pending. Too fragile for the gain. Rejected.
4. **Ungate only `e2e`.** The e2e legs already run as no-ops on non-app PRs, so
   this saves no wall clock there (the critical path is `checks` or
   `qa-suite`); on app PRs it saves the same ~9 s as option 2 while adding an
   in-job filter dependency. Rejected.

## Consequences

- No code or workflow behaviour changes; the five required names are unchanged.
- A pre-existing `app`-filter bug found during review (a test-only change under
  `__tests__/unit`, `__tests__/integration` or `__tests__/e2e` is classified
  `app=false` and skips its suite) is tracked separately in #1027; this PR keeps
  the behaviour unchanged.
- The measured rationale is recorded in the `scope` job comment and in the
  review configuration that existed at the time (`.coderabbit.yaml`, since
  retired) so the gate is not re-litigated from intuition.
- Revisit if `scope` grows beyond ~15 s consistently, if GitHub adds job-level
  path filters (or conditionally-present required checks), or if the runner
  queue drops low enough that the ~9 s becomes material.
