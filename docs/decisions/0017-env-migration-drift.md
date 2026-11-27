# ADR-0017: `env` reconciles stack migrations

**Status:** Accepted (2026-11-27).
**Date:** 2026-11-27
**Related:** [#1186](https://github.com/logyQT/studiq/issues/1186) (defect),
[ADR-0011](0011-env-cli.md) (the `env` surface and its read-only contract),
[ADR-0014](0014-local-build-cache-and-build-slots.md) (record-then-probe state files)

---

## Context

The Supabase CLI applies `supabase/migrations` when it **creates** a stack's
database. A resumed stack never applies them again. A branch that merges new
migrations therefore keeps an old schema, and the first symptom is a 500 in an
unrelated feature: #1186 reported `GET /api/v1/stats/student` returning
`column questions.status does not exist` because three merged migrations were
never applied.

`env:ensure` reported `ready: true` in that state. `env:doctor` surfaced only
`config.toml` drift. Nothing compared local migration files with the stack's
applied set, so the tool claimed a ready environment whose schema did not match
the code.

## Decision

1. **One comparison module.** `scripts/env/lib/migrations.ts` owns the local
   version list, the `supabase migration list --output-format json` parse, the
   report vocabulary, and the apply call. `pending` is a local version the
   database does not record; `drift` is the opposite; `unknown` means nothing
   proves either.
2. **`ensure` repairs this checkout's own stack.** After the stack is up and
   before any seed, it reads the applied set, applies pending migrations
   (`supabase migration up --include-all`), re-probes to prove the result, and
   records the proven set in `.dev/migrations.json`. A failed apply exits 4 and
   names the pending versions. A failed probe is a warning and an `unknown`
   report, never a ready claim.
3. **A shared stack is reported, never mutated.** `SUPABASE_SHARED=1` never runs
   `migration up`; with no exported `SUPABASE_DB_URL` the state stays `unknown`
   instead of falling through to the CLI's local target. `env:status` names the
   owner as the actor, not `env:ensure`.
4. **A mixed state is refused; a pure remote-only state warns and continues.**
   When pending local versions and remote-only versions exist together, `ensure`
   stops before it spawns `migration up` and names both sets and the remedy
   (`migration repair --status reverted <version>`, or restore the file). A
   remote-only set with nothing pending is the branch-switch case: `ensure`
   records it, warns on stderr, and exits 0. `env:status` and `env:doctor` report
   it as `drift`, and never claim `current`.
5. **The record is the cheap path, not the authority.** `.dev/migrations.json`
   binds the proven set to one stack id. `env:status` compares it with the local
   files without a database connection, so a merge shows `pending N` at status
   cost. Only a record that covers the local set **and** claims no remote-only
   versions is cheap; a removed file or a drift claim costs the next ensure a
   probe, so a `migration repair` is noticed and the record is rewritten.
   `env:doctor` probes the default stack live. `env:reset-db` rewrites the record
   after `db reset` re-applies every file.
6. **A pending version older than the newest applied one still applies.** A
   merge adds a migration below the newest version often, and a plain
   `migration up` refuses it ("inserted before the last migration"). `ensure`
   passes `--include-all`: the mixed state is refused first, so the flag can
   only relax ordering among local files. `applyMigrations` is the one caller.
7. **Named stacks use their DB URL.** Database commands accept no `--stack`, so
   the probe and apply pass `--remote=<DB_URL>?sslmode=disable`, the same rule
   `env:reset-db` already used. A warm ensure carries no keys: it re-reads the
   stack only when a probe is actually needed.

## Consequences

- A merge no longer leaves a branch stack behind: the next `env:ensure` applies
  the missing migrations, and `env:status`/`env:doctor` name the gap before it
  becomes a 500.
- Warm `ensure` stays cheap: the record matches the local set and claims no
  drift, so no database connection is opened. A merge costs one `migration list`
  (~0.75 s) plus one `migration up`.
- The record can age: a database changed out of band reads as current until a
  probe runs (`env:doctor`, or an ensure whose local set moved or whose record
  claims drift). This is the same claim-not-proof rule as `.dev/build.json`
  (ADR-0014); a live probe remains the authority.
- A remote-only version is reported and named, not repaired. Choosing which side
  is stale needs the operator. `env:ensure` exits 0 and warns while nothing is
  pending; `env:status` names `migration repair` as the action. Once the repair
  runs, the next `env:ensure` probes, rewrites the record without the version,
  and `env:status` reads `current`.
- `STUDIQ_MIGRATIONS_DIR` is a read-only test seam; it never changes what a seed
  or a build reads.

## Rollback

Revert the PR. Delete `.dev/migrations.json` in any checkout; no stack data is
touched, and the next `env:ensure` reverts to the old behaviour of trusting the
cold-start apply.
