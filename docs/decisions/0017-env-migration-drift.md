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
   (`supabase migration up`), re-probes to prove the result, and records the
   proven set in `.dev/migrations.json`. A failed apply exits 4. A failed probe
   is a warning and an `unknown` report, never a ready claim.
3. **A shared stack is reported, never mutated.** `SUPABASE_SHARED=1` never runs
   `migration up`; with no exported `SUPABASE_DB_URL` the state stays `unknown`
   instead of falling through to the CLI's local target.
4. **A mixed state is refused.** When pending local versions and remote-only
   versions exist together, the CLI's `migration up` refuses anyway. `ensure`
   stops before it spawns it and names both sets and the remedy
   (`migration repair --status reverted <version>`, or restore the file).
5. **The record is the cheap path, not the authority.** `.dev/migrations.json`
   binds the proven set to one stack id. `env:status` compares it with the local
   files without a database connection, so a merge shows `pending N` at status
   cost; a record whose local set shrank (a removed file) reads `unknown` and
   costs the next ensure a probe. `env:doctor` probes the default stack live.
   `env:reset-db` rewrites the record after `db reset` re-applies every file.
6. **Named stacks use their DB URL.** Database commands accept no `--stack`, so
   the probe and apply pass `--remote=<DB_URL>?sslmode=disable`, the same rule
   `env:reset-db` already used. A warm ensure carries no keys: it re-reads the
   stack only when a probe is actually needed.

## Consequences

- A merge no longer leaves a branch stack behind: the next `env:ensure` applies
  the missing migrations, and `env:status`/`env:doctor` name the gap before it
  becomes a 500.
- Warm `ensure` stays cheap: the record matches the local set, so no database
  connection is opened. A merge costs one `migration list` (~0.75 s) plus one
  `migration up`.
- The record can age: a database changed out of band reads as current until a
  probe runs (`env:doctor`, or an ensure whose local set moved). This is the same
  claim-not-proof rule as `.dev/build.json` (ADR-0014); a live probe remains the
  authority.
- A remote-only version is reported, not repaired. Choosing which side is stale
  needs the operator, and the CLI's own apply refuses that state.
- `STUDIQ_MIGRATIONS_DIR` is a read-only test seam; it never changes what a seed
  or a build reads.

## Rollback

Revert the PR. Delete `.dev/migrations.json` in any checkout; no stack data is
touched, and the next `env:ensure` reverts to the old behaviour of trusting the
cold-start apply.
