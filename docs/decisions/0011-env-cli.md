# ADR-0011: one `env` command for local environments

## Status

Proposed (2026-11-08). Phase 0 evidence recorded. The two phase-0 operator
decisions are **settled**: the `db` profile is db + auth + storage, and
`dev:admin` becomes `env:dev --admin`. Phases 1–3 are therefore unblocked. Phase
4 (port allocator) is a conditional **go** pending the cutover. See "Decisions
and remaining items".

Supersedes the local-dev command surface in ADR-0010 (which keeps the one
values-file decision) and the `dev:*` scripts documented in `AGENTS.md`.

## Context

Local provisioning is spread across `scripts/dev` (a 2,305-line Bash program)
and twelve `dev:*` package scripts plus the root `dev` script. An agent must
read several files to learn the incantation. `dev:status --json` already reports
stack identity and health, and `scripts/dev up` is idempotent and reuses a
running stack, so the cold stack, migrations, seeds and `next build` are paid
only when the checkout/stack is cold. What is missing is a single idempotent
`ensure` with a warm path and a stable agent-facing contract that composes
start/build/serve — plus a build fingerprint that goes stale after a source edit.

The 2026-11-07/08 review settled the target shape: one idempotent `ensure`
command with profiles, a warm path under a second, a stable `--json` contract,
native as the default runtime, and a per-checkout stack identity. The review
also made two things conditional:

1. the 20-port allocator waits for a recorded spike proving that explicit
   `SUPABASE_*_PORT` values are honored on **resume**, not just creation;
2. the env loader stays varlock (the CLI never parses `.env.local`).

Phase 0 recorded the spike and the baseline on the pinned CLI (`supabase@3.0.0`,
Bun 1.4.4, WSL2 Debian 12, x86_64: 16 vCPU, 19 GiB RAM, glibc 2.36, Docker
29.9.1 running). The full evidence is [the phase-0 comment on
#1077](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664);
local `.dev/` logs are supplementary only and are not readable from other
checkouts. The corrected spec is
[`docs/plans/env-tool.md`](../plans/env-tool.md).

## Decision

1. **Adopt `env` as the single local-environment command.** `env:ensure` is the
   only command an agent normally calls. The full surface is `ensure`, `status`,
   `down`, `build`, `serve`, `recreate`, `doctor`, `ports`, `supa`, `dev`,
   `reset-db`, `logs`, `prepull`, `setup`, `verify`. The `supa` passthrough
   validates destructive or stop-capable subcommands before forwarding:
   `stop --all`, `db reset` and `stack destroy` are rejected, and every
   stop/restart form (`stop`, `stack stop`, `restart`, `stack restart`) must
   target a stack whose `project_root` is this checkout (usage errors exit 2,
   ownership conflicts exit 6). Starts are normalized instead: `stack start …`
   always carries the selected runtime (`--runtime native` by default, injected
   when absent; an explicit value is preserved).
2. **Delete `scripts/dev` and every `dev:*` script** in the cutover (phase 3);
   no aliases and no back-compat layer. Root `build`/`start` and the low-level
   `build:web`/`start:web`/`build:admin`/`start:admin` scripts stay.
3. **varlock is the loader, the injector and the validator.** Value-consuming
   commands keep `varlock run --inject vars --`; `status`/`ports`/`doctor` run
   unwrapped so a locked vault cannot block them. The CLI never parses a dotenv
   file. varlock also stays the validator (`env:check`, `env:scan`, the
   inventory guard) — it is not "validator-only". **The wrappers stay for the
   whole of #1077:** removing them is a deliberate post-stability migration only
   once #1077 **and** #1078 are stable, through a framework integration
   (Next/Bun) or `env`-owned injection. Plugins resolve provider values; they do
   not remove wrappers. No phase of this plan drops them.
4. **Native is the default and the only auto-selected runtime.** Every start
   passes the **selected** runtime explicitly (`native` by default, `docker`
   only when selected); Docker is `--runtime docker` / `SUPABASE_RUNTIME=docker`
   only, and there is no silent fallback. An existing stack is warned about when
   it uses Docker and continues to work; a capability restart passes the
   stack's **persisted** runtime, never the default. The only Docker→native
   conversion is `env:recreate --runtime native --yes`.
5. **Identity is per checkout.** Stack identity is the CLI's
   `projectRoot + branch + stackName`; `--attach` is future work. Under
   `SUPABASE_SHARED=1` this checkout reuses another checkout's stack without any
   stack mutation; `down --all`, `recreate`, `reset-db` and `--reseed` refuse
   with exit 6, while plain `down` still stops only the local web server.
6. **The app port is the only lease until phase 4.** Stack ports are discovered
   from `stack status`. The app-port lease follows the **stack** lifetime: plain
   `down` keeps it, because `supabase/config.toml` binds the auth redirect URLs
   to `APP_URL`; `down --all` (or a stopped stack) releases it. The 20-port block
   allocator lands after the cutover and stays conditional on the recorded
   create **and** resume port evidence.
7. **`env:dev` is human-only HMR.** It starts web/admin HMR with `next dev`;
   agents never run `next dev` and use build + serve instead.
8. **`env:setup` mutates, `env:verify` observes.** Setup is human-only,
   idempotent and never writes a value. Verify is read-only and agent-safe:
   its default checks `.env.local` + the schema only (fast, unauthenticated) and
   reports missing key _names_; `--full` adds `.env.vault` refs and provider
   status.
9. **The vault seam belongs to varlock.** `.env.vault` lives in the primary
   checkout, is Git-ignored, and `STUDIQ_ENV_VAULT` defaults to
   `<primary>/.env.vault`, where `<primary>` is the first entry of
   `git worktree list --porcelain` — a directory, so the file name is appended.
   It is passed as `varlock run --path "$STUDIQ_ENV_VAULT" --path .` (vault
   first, checkout last, so `.env.local` wins; verified that `--path` replaces
   the default entry point and that the last path wins on a duplicate key).
   Without `.env.vault` the wrapper passes no `--path`. `scripts/env/**` contains
   no provider code and no ref parsing.
10. **Caching is out of scope** (#1078); CI is untouched and keeps calling
    `supabase stack` directly with `SUPABASE_EXPERIMENTAL_STACK=1`, the native
    runtime and CLI-assigned ports per runner.
11. **The `db` profile is db + auth + storage.** Confirmed by the operator: the
    repo's migrations need `storage.buckets` and its seeds need
    `auth.users.email_confirmed_at`, so a database-only stack cannot be
    provisioned. No migration/seed-skip path is added.
12. **`dev:admin` becomes `env:dev --admin`.** Human-only admin HMR on :4000,
    symmetric with `env:dev` for web; `apps/admin` stays out of `env:ensure`
    defaults. Because the admin app is internal and unauthenticated, admin HMR
    and admin build/serve bind loopback only (`127.0.0.1`), never `0.0.0.0`.
13. **`ensure` reconciles capabilities only on request.** A running capability
    superset satisfies a narrower profile; only **adding** capabilities can need
    a restart. That restart requires `--reconcile` (plus `--yes` when
    non-interactive); without it, exit 6 with a message naming the missing
    capability. It runs under the start lock, keeps the stack's persisted
    runtime and the currently observed API/DB/Studio/mail endpoints
    (read-then-pin, not the phase-4 block), never destroys data, and re-probes
    every requested capability (phase-0: ≈1.7 s stop + 5.0 s resume). A failed
    reconcile restores the previous capability set and never moves the block or
    endpoints; only a cold start or `env:recreate` may take a different block.
14. **Local posture is explicit and validated.** Before build/serve/HMR
    (`ensure` build/serve, `serve`, `build`, `dev`) the tool sets
    `APP_ENV=development` only when it is unset or empty, preserves an explicit
    `development`/`test`/`qa` (normalized like `scripts/dev`), and rejects
    `production` or any other value with exit 2 before acting. `APP_ENV` is part
    of the build fingerprint.

> **Superseded wording.** The issue's pre-review appendix and its "varlock is
> validator-only" acceptance line are superseded by item 3. varlock remains the
> loader/injector for value-consuming commands and the validator; the
> `varlock run` wrappers are removed only in a post-stability migration after
> #1077 **and** #1078 — never inside this issue.

### Platform matrix

Native supports Linux x86_64/arm64 (glibc ≥ 2.35, `tar`, non-root) and macOS
arm64. Everything else exits **3** with the exact opt-in
(`SUPABASE_RUNTIME=docker bun run env:ensure …` or `--runtime docker`); Windows
is supported through WSL2 only, never native Windows. The CLI is the
authoritative check; the tool's check exists so the failure is actionable. CI
stays on Linux x86_64 native.

## Evidence

### Port spike (decides phase 4)

A scratch stack (`phase0-spike`, non-default name, this worktree only) was
created, stopped, resumed with the same ports, resumed with different ports,
resumed with no port env, and destroyed. Only that stack was touched:
`stack list` filtered to this `project_root` was empty afterwards.

| Question                                                    | Answer                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Do pinned ports stick on resume?                            | **Yes**, when the same overrides are passed. With no overrides the CLI re-rolls API/DB/Studio.                                                                                                                                                         |
| Does `SUPABASE_*_PORT` apply on create/resume/both/neither? | API/DB/Studio: **both**. `SUPABASE_MAIL_PORT`: **neither** (dead legacy name). Real mail overrides: `SUPABASE_LOCAL_SMTP_PORT`, `_SMTP_PORT`, `_POP3_PORT`: **both**. pgmeta: not pinnable.                                                            |
| Are keys fixed demo JWTs or per-stack?                      | **Fixed constants across stacks.** `ANON_KEY`/`SERVICE_ROLE_KEY` are the demo JWTs (`iss=supabase-demo`); `PUBLISHABLE_KEY`/`SECRET_KEY` and the S3 access keys are also identical across stacks. Only URLs differ. Names only; values never recorded. |
| Runtime                                                     | `--runtime native` explicitly; native available (Linux x86_64, glibc 2.36, `tar`, non-root); Docker 29.9.1 was running; no fallback.                                                                                                                   |

Exact commands and outputs: the [phase-0 evidence
comment](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664)
(Task 1); local `.dev/` logs are supplementary only.

**Phase-4 verdict: GO**, with one caveat: `pgmeta.http` has no config section
and cannot be pinned. The phase-4 PR must either accept one unpredictable
internal port or reserve/probe a slot; the block is not "fully pinned" until
that is decided. The allocator must pass its ports on every `start`, not only on
create.

### Baseline vs §12 budgets

Host as above; native artifact cache warm; "cold" = new stack. Raw runs are in the [phase-0 evidence
comment](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664)
(Task 2); local `.dev/` logs are supplementary only.

| Path                     | Budget  | p50                                                                      | p95                 | Verdict                                |
| ------------------------ | ------- | ------------------------------------------------------------------------ | ------------------- | -------------------------------------- |
| warm `ensure`            | ≤ 1 s   | 885 ms (`dev:up --prod`) / 855 ms (`dev:status`)                         | 936 ms / 928 ms     | pass (tight; heartbeat cache required) |
| cold `db`                | ≤ 45 s  | 7347 ms (db+auth+storage)                                                | 7994 ms             | pass (db-only **fails**)               |
| cold `api`               | ≤ 75 s  | 7250 ms                                                                  | 7277 ms             | pass                                   |
| cold `web`, build cached | ≤ 120 s | 2207 ms (warm stack) / 13416 ms (cold stack)                             | 2388 ms / 13558 ms  | pass                                   |
| cold `web`, code changed | ≤ 300 s | 10184 ms (explicit build+serve) / 20274 ms (cold stack + forced rebuild) | 11780 ms / 21651 ms | pass                                   |
| tenant seed              | ≤ 20 s  | not measured                                                             | —                   | phase 3                                |

The current warm path still spawns `stack status`; the new heartbeat cache is
what gives the 1 s budget margin. The current build fingerprint has no git tree
hash, so `dev:up --prod` serves a stale build after a source edit (measured:
2.1 s, `BUILD_ID` unchanged). The new fingerprint must hash the working-tree
contents (tracked changes plus build-relevant untracked source), because
`HEAD^{tree}` + `git status --porcelain` do not change on a second edit to the
same modified file.

### `db` profile (settled: db + auth + storage)

A database-only stack cannot apply this repo's migrations and seeds:

- `supabase/migrations/20260713000001_teacher_assignments.sql` inserts into
  `storage.buckets` → `SQLSTATE 42P01` without `storage`;
- `supabase/seeds/01_seed.sql` needs `auth.users.email_confirmed_at` →
  `SQLSTATE 42703` without `auth`.

The minimum viable database profile is **db + auth + storage** (measured p50
~7.3 s / p95 ~8.0 s, inside the ≤45 s `db` budget). The operator confirmed this
composition; no `--no-migrate`/`--no-seed` skip path is added.

### `dev:admin` (settled: `env:dev --admin`)

`bun run dev:admin` was a `dev:*` script with no replacement in the corrected
command map. Resolved: **`bun run env:dev --admin`** — human-only admin HMR on
:4000, symmetric with `env:dev` for web. `--profile admin` (build + serve)
remains the non-HMR path, and `apps/admin` is not part of `env:ensure` defaults.
The alternatives (`env:ensure --profile admin` only, keeping `dev:admin`) were
rejected: the first has no HMR, the second violates the no-`dev:*` rule.

## Command map

| Old                        | New                                |
| -------------------------- | ---------------------------------- |
| `bun run dev` / `dev:web`  | `bun run env:dev` (human-only HMR) |
| `dev:up` / `dev:up --prod` | `bun run env:ensure --profile web` |
| `dev:serve`                | `bun run env:serve`                |
| `dev:build`                | `bun run env:build`                |
| `dev:status`               | `bun run env:status`               |
| `dev:down [--all]`         | `bun run env:down [--all]`         |
| `dev:doctor`               | `bun run env:doctor`               |
| `dev:ports`                | `bun run env:ports`                |
| `dev:reset-db`             | `bun run env:reset-db`             |
| `dev:logs`                 | `bun run env:logs`                 |
| `dev:prepull`              | `bun run env:prepull`              |
| `scripts/dev supa …`       | `bun run env:supa …`               |
| `dev:admin`                | `bun run env:dev --admin`          |

New commands with no old equivalent: `env:ensure` (the composed blessed path),
`env:recreate`, `env:setup`, `env:verify`.

## Consequences

- **One command, one contract.** Agents call `env:ensure --profile <name>
--json` and branch on ports/readiness instead of reading files. The JSON
  contract preserves the current `dev:status` camelCase fields and adds
  profile/runtime/cold/build/seed fields; unknown states are `null`.
- **No Docker on the happy path.** Native is explicit, so a stopped Docker
  daemon cannot silently create a Docker stack and a running daemon cannot
  silently be preferred. Docker remains available for unsupported platforms and
  compatibility.
- **Per-checkout isolation stays.** The CLI's identity is the same as today, so
  parallel worktrees keep separate stacks and data.
- **Fewer moving parts.** Deleting `scripts/dev` removes the env rendering,
  port math, duplicated lifecycle/health logic and Docker-first defaults. The
  build lock, ownership checks, shared-mode refusal and `supa` passthrough are
  ported.
- **Secrets stay out of output.** The tool relays discovered stack keys to
  children but never prints, logs or stores them; `--json` excludes stack key
  names and values and omits the DB password. `.env.local` key names may appear
  only in `env:verify`.
- **Cost:** a new phase 4 (allocator) and a docs sweep. The allocator is
  deferred until after the cutover so the warm path ships first.
- **Risk:** the warm path's 1 s budget is tight on WSL2 (p95 936 ms today); the
  heartbeat cache is load-bearing, not an optimization. Weakening it re-opens
  the budget failure.
- **Risk:** `pgmeta` remains CLI-assigned; the allocator cannot claim a fully
  pinned block until that is resolved.
- **Risk:** the `db` profile starts three capabilities (database, auth, storage)
  instead of one, so a "DB-only" use case pays a slightly longer cold start
  (~7.3 s p50). That is the minimum that can apply this repo's migrations and
  seeds, and there is no skip path.
- **Risk:** `env:dev --admin` is the only HMR surface left for `apps/admin`, so
  the docs sweep must keep marking it human-only. `env:ensure --profile admin`
  stays the build + serve path.

## Rollback

Revert the phase PR. Phases 1–2 keep `scripts/dev` alive, so reverting is a
normal revert with no data migration. Phase 3 is the cutover: reverting it
restores `scripts/dev` and the `dev:*` scripts; stacks and `.dev/` state are
runtime-only and are not migrated. Phase 4's leases are runtime state outside
the repo (the registry). Remove only **this checkout's** entries/leases when
rolling back; never delete the shared registry directory, because other
checkouts' live leases and locks live there. Stale entries are reclaimed by the
TTL + dead-pid rules, and live entries/locks are preserved. The CLI's own stack
state (`~/.supabase/stacks/<id>`) is untouched.

## Decisions and remaining items

**Settled in phase 0 (operator, 2026-11-08):**

1. `db` profile = db + auth + storage. Migrations need `storage.buckets` and the
   seeds need `auth.users.email_confirmed_at`; cold start p50 ~7.3 s / p95 ~8.0 s.
   No `--no-migrate`/`--no-seed` skip path.
2. `dev:admin` → `env:dev --admin` (human-only admin HMR on :4000);
   `apps/admin` stays out of `env:ensure` defaults.

**Remaining (implementation notes, not blockers — each is resolved in the phase
that owns it):**

3. Phase 4: how to handle the unpinnable `pgmeta` port.
4. Phase 2: add `.env.vault` to `.gitignore` and `STUDIQ_ENV_VAULT` to
   `.env.schema`.
5. Phase 3: remove/repurpose the dead `SUPABASE_MAIL_PORT` and add the
   `SUPABASE_LOCAL_SMTP_*_PORT` trio to `.env.schema`.
6. Phase 3: decide how `qa` (`:3010`) and `e2e` (`:3000`) learn the app URL
   when the profile leases a different port.
7. Unchanged by this ADR: the auth e-mail template workaround (stack projects
   cannot serve `content_path`, upstream `supabase/cli#7200`).

## References

- [Spec: `docs/plans/env-tool.md`](../plans/env-tool.md)
- [ADR-0010: one root values file](0010-env-ssot.md)
- [Native runtime audit](../audits/supabase-native-runtime.md)
- [Issue #1077](https://github.com/logyQT/studiq/issues/1077),
  [Issue #1078](https://github.com/logyQT/studiq/issues/1078)
