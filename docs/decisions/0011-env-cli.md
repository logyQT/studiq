# ADR-0011: one `env` command for local environments

## Status

Proposed (2026-11-08). Phase 0 evidence recorded; phases 1–3 are ready to
implement. Phase 4 (port allocator) is a conditional **go** pending the
cutover. Two phase-0 STOP items remain for the operator: the `db` profile
composition and the `dev:admin` replacement (see "Open decisions").

Supersedes the local-dev command surface in ADR-0010 (which keeps the one
values-file decision) and the `dev:*` scripts documented in `AGENTS.md`.

## Context

Local provisioning is spread across `scripts/dev` (a 2,305-line Bash program)
and twelve `dev:*` package scripts plus the root `dev` script. An agent must
read several files to learn the incantation, and every task pays for a cold
stack, migrations, seeds and `next build` even when it only needs an API
endpoint or a database. Nothing tells a second agent that a healthy stack
already exists in the same checkout.

The 2026-11-07/08 review settled the target shape: one idempotent `ensure`
command with profiles, a warm path under a second, a stable `--json` contract,
native as the default runtime, and a per-checkout stack identity. The review
also made two things conditional:

1. the 20-port allocator waits for a recorded spike proving that explicit
   `SUPABASE_*_PORT` values are honored on **resume**, not just creation;
2. the env loader stays varlock (the CLI never parses `.env.local`).

Phase 0 recorded the spike and the baseline on the pinned CLI (`supabase@3.0.0`,
Bun 1.4.4, WSL2 Debian 12, x86_64: 16 vCPU, 19 GiB RAM, glibc 2.36, Docker
29.9.1 running). The full evidence is `.dev/phase0-evidence.md`; the corrected
spec is [`docs/plans/env-tool.md`](../plans/env-tool.md).

## Decision

1. **Adopt `env` as the single local-environment command.** `env:ensure` is the
   only command an agent normally calls. The full surface is `ensure`, `status`,
   `down`, `build`, `serve`, `recreate`, `doctor`, `ports`, `supa`, `dev`,
   `reset-db`, `logs`, `prepull`, `setup`, `verify`.
2. **Delete `scripts/dev` and every `dev:*` script** in the cutover (phase 3);
   no aliases and no back-compat layer. Root `build`/`start` and the low-level
   `build:web`/`start:web`/`build:admin`/`start:admin` scripts stay.
3. **varlock is the only loader.** Value-consuming commands keep
   `varlock run --inject vars --`; `status`/`ports`/`doctor` run unwrapped so a
   locked vault cannot block them. The CLI never parses a dotenv file.
4. **Native is the default and the only auto-selected runtime.** Docker is
   `--runtime docker` / `SUPABASE_RUNTIME=docker` only; no silent fallback.
   An existing Docker stack is warned about and continues to work;
   `env:recreate --runtime native --yes` converts it.
5. **Identity is per checkout.** Stack identity is the CLI's
   `projectRoot + branch + stackName`; `--attach` is future work.
6. **The app port is the only lease until phase 4.** Stack ports are discovered
   from `stack status`. The 20-port block allocator lands after the cutover.
7. **`env:dev` is human-only HMR.** Agents use build + serve; the tool never
   runs `next dev`.
8. **`env:setup` mutates, `env:verify` observes.** Setup is human-only,
   idempotent and never writes a value. Verify is read-only and agent-safe,
   reports missing key _names_, and can resolve the vault with `--full`.
9. **The vault seam belongs to varlock.** `.env.vault` lives in the primary
   checkout, is Git-ignored, resolved through `STUDIQ_ENV_VAULT` (default: the
   first entry of `git worktree list --porcelain`), and is passed with
   `varlock run --path`. `scripts/env/**` contains no provider code and no ref
   parsing.
10. **Caching is out of scope** (#1078); CI is untouched and keeps calling
    `supabase stack` directly.

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

Exact commands and outputs: `.dev/phase0-evidence.md` §Task 1.

**Phase-4 verdict: GO**, with one caveat: `pgmeta.http` has no config section
and cannot be pinned. The phase-4 PR must either accept one unpredictable
internal port or reserve/probe a slot; the block is not "fully pinned" until
that is decided. The allocator must pass its ports on every `start`, not only on
create.

### Baseline vs §12 budgets

Host as above; native artifact cache warm; "cold" = new stack. Raw runs in
`.dev/phase0-evidence.md` §Task 2.

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
2.1 s, `BUILD_ID` unchanged). The new fingerprint must include the tree hash.

### `db` profile (STOP)

A database-only stack cannot apply this repo's migrations and seeds:

- `supabase/migrations/20260713000001_teacher_assignments.sql` inserts into
  `storage.buckets` → `SQLSTATE 42P01` without `storage`;
- `supabase/seeds/01_seed.sql` needs `auth.users.email_confirmed_at` →
  `SQLSTATE 42703` without `auth`.

The minimum viable database profile is **db + auth + storage** (~7.3 s p50).
The spec adopts that definition; the operator must confirm it or choose a
migration/seed-skip path before phase 2.

### `dev:admin` (STOP)

`bun run dev:admin` is a `dev:*` script with no replacement in the corrected
command map. Options: `env:dev --admin` (recommended), `env:ensure --profile
admin` (no HMR), or keep it as the one exception (not recommended). Phase 3 is
blocked on the choice.

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
| `dev:admin`                | **unmapped — STOP**                |

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
- **Risk:** the `db` profile and `dev:admin` are open decisions; phases 2 and 3
  are blocked on them respectively.

## Rollback

Revert the phase PR. Phases 1–2 keep `scripts/dev` alive, so reverting is a
normal revert with no data migration. Phase 3 is the cutover: reverting it
restores `scripts/dev` and the `dev:*` scripts; stacks and `.dev/` state are
runtime-only and are not migrated. Phase 4's leases are runtime state outside
the repo (the registry); deleting the registry directory reclaims everything,
and the CLI's own stack state (`~/.supabase/stacks/<id>`) is untouched.

## Open decisions

1. Confirm `db = db + auth + storage` (or choose a migration/seed-skip path).
2. Choose the `dev:admin` replacement (`env:dev --admin` recommended).
3. Phase 4: how to handle the unpinnable `pgmeta` port.
4. Phase 2: add `.env.vault` to `.gitignore` and `STUDIQ_ENV_VAULT` to
   `.env.schema`.
5. Phase 3: remove/repurpose the dead `SUPABASE_MAIL_PORT` and add the
   `SUPABASE_LOCAL_SMTP_*_PORT` trio to `.env.schema`.
6. Phase 3: decide how `qa` (`:3010`) and `e2e` (`:3000`) learn the app URL
   when the profile leases a different port.

## References

- [Spec: `docs/plans/env-tool.md`](../plans/env-tool.md)
- [ADR-0010: one root values file](0010-env-ssot.md)
- [Native runtime audit](../audits/supabase-native-runtime.md)
- [Issue #1077](https://github.com/logyQT/studiq/issues/1077),
  [Issue #1078](https://github.com/logyQT/studiq/issues/1078)
