# `env` — one command to a predictable local environment

Status: **phase 0 complete** (evidence + this spec + [ADR-0011](../decisions/0011-env-cli.md), 2026-11-08). Operator
decisions are settled: `db` = db + auth + storage (§3); `apps/admin` HMR/serve is deferred (§14). Phases 1–3 are
unblocked.

Replaces `scripts/dev` and the `dev:*` sprawl. Scope: local development and agent workflows; not CI, not hosted,
not production. Related: [#1077](https://github.com/logyQT/studiq/issues/1077),
[ADR-0010](../decisions/0010-env-ssot.md), [native runtime audit](../audits/supabase-native-runtime.md). Where
this document and older drafts disagree, **this document wins**.

## 0. Problem and goals

A cold checkout costs 5–10 minutes: the agent learns the incantation from `AGENTS.md`, `scripts/dev` and
`.env.schema`, then waits for the stack, migrations, seeds and `next build`. Missing: one idempotent `ensure`
with a warm path and a stable machine contract that composes start/build/serve — plus a build fingerprint that
does not go stale after a source edit.

Goals: idempotent, concurrency-safe `ensure` with a contract in < 1 s warm; native by default with no Docker and
no silent fallback; composable profiles; agents read `--json`, not files; keep the safety invariants. Non-goal: a
30 s cold full-app start — the lever is a build cache (#1078).

## 1. Fixed decisions (do not reopen)

1. **varlock is the only env loader, injector and validator.** Value-consuming commands run under `varlock run
--inject vars --`; `status`/`ports`/`doctor` run unwrapped. The CLI **never parses a dotenv file**; wrapper
   removal is a post-stability migration (after #1077 **and** #1078).
2. **One environment per checkout.** One stack and one web server; a second server for a different stack/profile
   is refused (exit 6).
3. **Native default; Docker explicit.** Every start passes `--runtime native` unless Docker is selected; no
   automatic fallback.
4. **Identity per checkout:** `projectRoot + branch + stackName`; `--attach` is future work.
5. **App port leased, stack ports discovered.** There is no port block allocator. `.env.vault` is opt-in (LLM +
   Stripe only, §10); `.env.local` is the only required values file.
6. **`db` = database + auth + storage** (no skip path).
7. **No secrets in output**, no `dev:*` aliases or back-compat layers. `scripts/dev` dies in the cutover; phases
   are serial; caching/CI are out of scope.

## 2. Command surface

Only these commands exist in v1:

```
env:ensure   --profile <name> [atoms] [--json]   # idempotent; the blessed path
env:status   [--json]                            # never mutates; works with no stack
env:down     [--all] [--yes]                     # stop web; --all also stops the stack
env:build    [--force] [--json]                  # explicit build only
env:serve    [--json]                            # serve an existing build
env:dev      [atoms]                             # human-only HMR
env:supa     <args…>                             # bunx supabase with the contract exported
env:reset-db [--yes]                             # destructive; this checkout only
env:logs     [--no-follow]                       # stack logs + .dev/web.log
env:setup    [--force]                           # human-only, mutating, idempotent
env:verify   [--full] [--json]                   # read-only, agent-safe
env:ports    [--json]                            # app port
env:doctor   [--json]                            # explain state; exit 1 on a real conflict
```

`ensure` is the only command an agent normally calls; `status`/`doctor`/`ports` are read-only. `down --all` and
`reset-db` require `--yes` when non-interactive; all commands print JSON-only stdout with `--json`.

`supa` forwards arguments unchanged, except: starts carry the **selected runtime**; `stop --all`, `destroy`, `db
reset`, `migration down` and `storage rm` exit 2; `stop`/`restart` only for this checkout's stack (exit 6);
`--json` becomes `--output-format json`; under `SUPABASE_SHARED=1` only `stack list`/`stack status`/`--version`
pass, everything else exits 6.

Exit codes: `0` ready; `2` bad usage; `3` native unavailable; `4` start failed; `5` timeout; `6` conflict.
`status`/`ports` report `ready: false` with exit 0; `verify` exits 1 when the schema cannot be read; `doctor`
exits 1 on problems.

## 3. Profiles

| Profile | Starts                              | Seed | Build / serve | Typical use                     |
| ------- | ----------------------------------- | ---- | ------------- | ------------------------------- |
| `db`    | database, auth, storage             | no   | no            | SQL, migrations, SQL-only tests |
| `api`   | db, rest, auth, storage             | no   | no            | API checks, integration tests   |
| `mail`  | api + local_smtp (Mailpit)          | no   | no            | auth e-mail specs               |
| `full`  | db, rest, auth, storage, local_smtp | no   | no            | the stack without the app       |
| `web`   | full                                | no   | build + serve | the old `dev:up --prod`         |
| `qa`    | full                                | yes  | build + serve | `__tests__/qa`                  |
| `e2e`   | full                                | yes  | build + serve | `__tests__/e2e`                 |

`db` is db + auth + storage (settled): migrations insert into `storage.buckets` and seeds need
`auth.users.email_confirmed_at` (`SQLSTATE 42P01` / `42703`); cold start is p50 7.3 s / p95 8.0 s. `qa`/`e2e` are
thin wrappers — full + tenant seed + build + serve — with no extra commands, run ids or markers.

Start contract: `database` is always on; `db` excludes `rest,studio,mail,realtime,functions,analytics,pooler`;
`api` adds `rest`; others exclude `studio,realtime,functions,analytics,pooler`. `--studio`/`--mail`/`--realtime`/
`--functions`/`--analytics` remove their entry; `--pooler` exits 2. Reject impossible combinations (exit 2).

Atoms: `--db --rest --auth --storage --studio --mail --realtime --functions --analytics --seed --no-seed
--web --build --force-build --prod --runtime <native|docker> --stack <name> --app-port <n> --wait <s>
--json --yes --quiet --verbose`. `--prod` implies build + serve; `--web` without `--prod` exits 2. `--no-seed`
wins over a profile default; `--seed` forces it.

## 4. Runtime and platform

Every start carries the **selected** runtime (`native` by default, `docker` only when selected); never rely on CLI
auto-detection. **No automatic fallback**: native unavailable or failing → exit **3** with the exact opt-in
(`bun run env:ensure --runtime docker …` or `SUPABASE_RUNTIME=docker bun run env:ensure …`). An existing stack
keeps its runtime; a Docker stack warns on observation. A runtime conversion is a manual operation: resolve the
stack's **name + branch**, verify the stack belongs to this checkout (`project_root` match) and that its branch matches
the current branch, then `bunx supabase stack destroy --stack <name>` (or `--stack-id <id>`) and `env:ensure --runtime …
--stack <name>` — `--stack` only for a named stack, so a blank name keeps branch-default selection. A first-class
command is deferred. Never mix runtimes in one stack. `status --json` reports `runtime`; CI calls `supabase stack` directly.

Native supports Linux x86_64/arm64 (glibc ≥ 2.35, `tar`, non-root) and macOS arm64; macOS x86_64, native Windows
and anything else exit 3 with the Docker opt-in (Windows is WSL2-only). The CLI is authoritative; the tool's check
makes the failure actionable. Root requires `SUPABASE_NATIVE_POSTGRES_USER`.

## 5. Identity and ports

Stack identity is the CLI's `projectRoot + "\0" + branch + "\0" + stackName` (blank = branch default); the tool
matches `stack list`/`stack status` on `project_root` + `name` + `branch_context`, and `status --json` exposes it.

The tool leases **one app port** (default 3000 if free); read-only `env:ports` never writes. Selection **atomically
reserves** it in **shared registry state**: each candidate takes an exclusive claim — a `flag 'wx'` claim file, or a
registry-wide lease lock held only for selection — and a failed claim moves to the next candidate, so two checkouts
can never pick the same port. The **per-checkout** lock serializes local lifecycle only; it does not serialize
checkouts. The lease follows the **stack** lifetime: plain `down` keeps it (`config.toml` binds auth redirects to
`APP_URL`), `down --all` releases it under the same lock only after stopping the stack; in shared mode it is a local
web lease only. Stack ports are **discovered** from `stack status --output-format json` — no port math. In stack mode
inherited `SUPABASE_*_PORT` values are cleared from the child environment; `.env.local` is never edited; `env:ports
--json` reports `{ appPort, stackPorts: "dynamic" }`.

## 6. Locks and lifecycle

**One per-checkout lock.** `locks/checkout.lock` (a simple file + `flock` in a mode-700, user-owned, non-symlink
registry) serializes `ensure`, `down`, `serve` and every lease read/write for that checkout; cross-checkout port
reservation lives in the shared registry claim (§5). The build lock stays separate and is never held while taking the
checkout lock. While `checkout.lock` is held the lease is authoritative: `down --all` releases it under that lock only
after stopping the stack, and `ensure` revalidates the lease and re-claims it if missing.

`ensure` order (phases 1–3): (0) acquire `checkout.lock` and revalidate/re-claim the app-port lease, atomically
reserving it (§5); (1) health probes, one per requested capability; (2) cold start if needed; (3) wait ready; (4) if a
build is needed, release `checkout.lock`, build under the build lock alone, then re-take `checkout.lock`; (5)
**re-probe every requested capability** before serving or reporting readiness — the pre-build probes are stale and
never reused; (6) serve/handover; (7) heartbeat and JSON while still holding the lock.

**Warm path:** one probe per requested capability + one schema read, **p95 < 1000 ms**; no `stack status` when the
heartbeat is fresh. A down requested service means `ready: false`; a capability **superset** satisfies a narrower
profile. **Missing capability:** exit **6**, then `env:down --all` and re-ensure — no in-place restart.

`down` takes `checkout.lock`, stops this checkout's web server and **keeps** the app-port lease while the stack
runs; `down --all` stops the stack and then releases the lease under the same lock. Never `supabase stop --all`,
`pkill` or an unscoped `docker rm`; the only stop is `supabase stack stop` for a stack this checkout owns.

**Shared mode (`SUPABASE_SHARED=1`):** reuse another checkout's stack and **never mutate the shared stack** — no
start/stop/destroy/reseed. Still build/serve the local web app and hold a **local app-port lease**, released by
plain `down`; `down --all` and `reset-db` exit 6, while `status`/`ports`/`verify` work. Keys come from the environment; a capability gap is reported, not fixed. `env:supa` is read-only (§2).

## 7. Building and serving

- **Never build** for `db`/`api`/`mail`/`full`; build only for `web`/`qa`/`e2e` or `env:build`.
- **Validate `APP_ENV`:** default `development` only when unset/empty; preserve `development`/`test`/`qa`; reject
  `production` or anything else (exit 2).
- **Fingerprint** covers inlined `NEXT_PUBLIC_*`, `APP_ENV`, build mode and a **working-tree content hash** (tracked
  changes + build-relevant untracked source) — not just `HEAD^{tree}` + `git status`. Build on mismatch only;
  `--force-build` overrides. The old fingerprint has no tree hash, so it serves a stale build after an edit.
- **Build lock:** one `next build` across all worktrees, held only across the build.
- **One server per checkout.** A live web PID with a different stack/profile → exit 6, naming the server and the
  remedy (`env:down` or a separate worktree). Same stack = normal handover.
- **Handover:** under `checkout.lock`, stop the tool's own server; release `checkout.lock`, build under the build
  lock alone, re-take `checkout.lock`, start and health-check. On failure leave the environment stopped (no
  rollback). `env:serve` takes `checkout.lock`; a stale fingerprint points at `env:build`; `next start` keeps
  `--keepAliveTimeout 55000` via the workspace script.

## 8. Seeding

Cold **stack** creation applies migrations + `supabase/seeds` automatically (the CLI does this); `env` never
duplicates them. **`--seed` runs the existing seeder** (`scripts/qa-tenant.ts` / `scripts/e2e-seed.ts`);
**`--no-seed` skips.** Profile defaults decide otherwise. The seeder is bound to this checkout's stack: `ensure`
verifies the endpoint's `project_root` before writing and aborts otherwise. Never tenant-seed a stack this
checkout does not own.

## 9. Safety invariants (non-negotiable)

1. **Ownership:** only the checkout that created a stack may stop/destroy it; `project_root` is checked first.
   Ownership is per checkout, not per process: a second terminal in that checkout may stop it, another checkout never can.
2. **Build lock:** one `next build` across all worktrees.
3. **Shared mode:** disables shared-stack mutation; plain `down`, local build/serve and the local lease still work.
4. **No `stop --all`, `pkill` or unscoped `docker rm`; destructive actions require `--yes` when non-interactive.**
5. **Every mutating command logs to `.dev/env.log` (mode 600).**
6. **Registry trust:** real directory, owned by the user, mode 700, not a symlink — otherwise refuse.
7. **No secrets in the registry, `.dev/`, logs or `--json`.**
8. **One server per checkout**, enforced by `checkout.lock` (§7).

## 10. Environment loading and the vault

- Value-consuming commands keep `varlock run --inject vars -- bun scripts/env/cli.ts <command>`. `status`/`ports`/
  `doctor` run **unwrapped**; `verify` invokes `varlock load` and consumes only exit status/metadata. The CLI never
  parses a dotenv file and never relies on Bun auto-load; unwrapped commands read the process environment only, so
  a setting that lives only in `.env.local` (`APP_PORT`, `SUPABASE_STACK`, `SUPABASE_SHARED`) is not guaranteed to
  reach them — export it when `status`/`ports`/`doctor` must agree with `ensure`.
- **`.env.vault` is opt-in, not required.** `.env.local` is the only required hand-edited values file. The vault
  holds only third-party refs that cannot come from the local stack — locally **LLM** (`LLM_API_KEY`, optionally
  `LLM_BASE_URL`/`LLM_PROVIDER`) and **Stripe** (`STRIPE_SECRET_KEY`, plus `STRIPE_WEBHOOK_SECRET` for webhook
  tests).
- A **human** creates it: `env:setup --vault` scaffolds refs (comment/empty refs, resolver syntax, mode 600); it is
  never auto-generated and the environment runs without it. Refs are varlock resolver calls (`op(...)`, `bwp(...)`,
  `infisical(...)`). It lives in the **primary checkout**, Git-ignored; worktrees resolve it via `STUDIQ_ENV_VAULT`
  (default `<primary>/.env.vault`). The wrapper passes `--path "$STUDIQ_ENV_VAULT" --path .` (vault first, checkout
  last, so `.env.local` wins); with no vault it passes no `--path`.
- `env:setup` is **human-only**, never writes a value and never overwrites without `--force`. `env:verify` is
  read-only and agent-safe: its default reports missing key **names** (exit status/metadata only); `--full` adds
  vault refs and provider status, one line each. New keys (`STUDIQ_ENV_VAULT`, the `SUPABASE_LOCAL_SMTP_*_PORT`
  trio) go into `.env.schema`; `scripts/env/**` has no provider code or ref parsing.

## 11. `--json` contract

Every command accepts `--json` and prints **only** JSON to stdout; the shape is a superset of `dev:status --json`.

```json
{
  "ready": true,
  "profile": "api",
  "runtime": "native",
  "cold": false,
  "stack": { "id": "…", "name": "default", "branch": "refs/heads/x", "projectRoot": "/…" },
  "ports": { "block": null, "app": 3011, "api": 20041, "db": 20042, "studio": 0, "mail": 0 },
  "urls": {
    "app": "http://localhost:3011",
    "supabase": "http://127.0.0.1:20041",
    "db": "postgresql://127.0.0.1:20042/postgres",
    "mail": null,
    "studio": null
  },
  "seeded": false,
  "build": { "present": true, "fingerprint": "…" },
  "warnings": [],
  "log": ".dev/env.log"
}
```

Legacy camelCase fields (`stackId`, `branch`, `web`, `supabase`, `dbUrl`, `mailUrl`) stay for compatibility.

- **No secrets.** No anon/service-role/publishable/secret keys, S3 names or values, or DB password. The `db` URL is
  emitted without userinfo; children still receive the CLI's full `DB_URL`.
- **Known false is `false`; `null` only for unknown.** Never omit a field. Stopped ports are `0`; `--studio` is the
  only way Studio starts. `warnings` holds short strings; `log` points at `.dev/env.log` (mode 600).

## 12. Phases, budgets and acceptance

| Phase             | Scope                                                                                                                                      | Gate                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| **0 — evidence**  | Port create/resume spike, identity, baseline timings, `dev:*` inventory, spec + ADR. No product code.                                      | Evidence in the issue; ADR reviewed |
| **1 — read-only** | `status`/`doctor`/`ports`/`supa`; stable `--json`. `scripts/dev` untouched.                                                                | Read-only parity, unit tests        |
| **2 — ensure**    | `ensure --profile api\|web`, `down`, `build`, `serve` (api/web only); varlock-injected; app-port lease; warm path. Keep `scripts/dev`.     | Acceptance 1–6, 8–10 (no `db`)      |
| **3 — cutover**   | Remaining profiles (`db`, `mail`, `full`, `qa`, `e2e`), `reset-db`, `logs`, `setup`, `verify`; delete `scripts/dev` + `dev:*`; docs sweep. | All acceptance tests; `rg` clean    |

Phases are serial (every phase touches `scripts/env/**`).

### 12.1 Latency budgets (phase-0 baseline)

Host: WSL2, Debian 12, x86_64, 16 vCPU, 19 GiB RAM, glibc 2.36, Bun 1.4.4, Supabase CLI 3.0.0, native artifact
cache warm. This is the **old-command baseline (`dev:up --prod` / `dev:status`)**, not `env:ensure`; the
`env:ensure` verdict is pending phase-2 measurement. Raw runs: the
[phase-0 evidence comment](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664).

| Path                            | Target  | p50                       | p95      | Verdict              |
| ------------------------------- | ------- | ------------------------- | -------- | -------------------- |
| warm `ensure`                   | ≤ 1 s   | 885 ms                    | 936 ms   | pending phase-2      |
| cold `db`                       | ≤ 45 s  | 7347 ms (db+auth+storage) | 7994 ms  | pass                 |
| cold `api`                      | ≤ 75 s  | 7250 ms                   | 7277 ms  | pass                 |
| cold `web`, cached, warm stack  | ≤ 120 s | 2207 ms                   | 2388 ms  | pass                 |
| cold `web`, cached, cold stack  | ≤ 120 s | 13416 ms                  | 13558 ms | pass                 |
| cold `web`, changed, warm stack | ≤ 300 s | 10184 ms                  | 11780 ms | pass                 |
| cold `web`, changed, cold stack | ≤ 300 s | 20274 ms                  | 21651 ms | pass                 |
| tenant seed                     | ≤ 20 s  | not measured              | —        | phase 3 must measure |

"Cold" = a new stack with the artifact cache warm; a first-ever download is ~46 s (one-time machine cost).

### 12.2 Acceptance tests

Pure parts live in `__tests__/unit/env/`; lifecycle tests run via `bun run env:selftest` (own stacks only).

1. **Same and different checkouts:** two `ensure` in one checkout → exit 0, same `stack.id`, one start; two
   worktrees → separate stacks and disjoint app ports.
2. **Warm ensure:** p95 < 1 s, `cold: false`, no `stack status` on a fresh heartbeat.
3. **Crash during start:** `kill -9` the holder → a waiter takes over on dead pid.
4. **Idempotent down:** `down` twice → exit 0; the lease is kept until `down --all` releases it once.
5. **Native-only:** with Docker running, default reports `native`; only `--runtime docker` produces Docker.
6. **Shared mode:** zero shared-stack mutation; `down --all`, `reset-db` and seeding exit 6.
7. **`db` profile:** succeeds and applies migrations + seeds.
8. **JSON:** schema snapshot; no key names/values or DB password.
9. **Fingerprint:** a source edit invalidates (including a second edit to the same file); `--force-build` builds.
10. **Conflicts:** a missing capability, or a live web PID with a different stack/profile, exits 6.

## 13. Command map

| Old                                      | New                                      | Notes                              |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------- |
| `bun run dev` / `dev:web`                | `bun run env:dev`                        | human-only HMR; agents build+serve |
| `bun run dev:up` / `dev:up --prod`       | `bun run env:ensure --profile web`       | behavior change: no `next dev`     |
| `dev:serve` / `dev:build` / `dev:status` | `env:serve` / `env:build` / `env:status` | `--json` preserved                 |
| `dev:down [--all]` / `dev:reset-db`      | `env:down [--all]` / `env:reset-db`      | `--yes` when non-interactive       |
| `dev:logs` / `dev:doctor` / `dev:ports`  | `env:logs` / `env:doctor` / `env:ports`  | exit 1 on a real conflict          |
| `bash scripts/dev supa …`                | `bun run env:supa …`                     | APP_URL + contract exported        |
| `scripts/dev` / `dev:*`                  | —                                        | deleted with the cutover           |

New commands with no old equivalent: `env:ensure` (composed from `dev:up`), `env:setup`, `env:verify`. Deferred:
`apps/admin` HMR/serve — run its own dev command manually until a first-class command is added.

The cutover updates every live reference (`AGENTS.md`, `README.md`, `docs/ONBOARDING.md`, ADR-0010, the native
audit, code comments, `scripts/load-test/README.md`).

## 14. Deferred and out of scope

**Deferred** (one line each, no v1 surface): `prepull` (ensure downloads on demand), `recreate` (manual destroy then
ensure), the port allocator (phase 0 GO: explicit ports survive create and resume; the operator's minimal-v1 decision defers
it, so it is not built — ports come from `status`), `apps/admin` HMR/serve, capability reconcile (`env:down --all` then
`env:ensure`), seed markers/run ids, build rollback (fail and stop), multi-lock hierarchies and provider-status ceremony.

Also out of scope: caching (#1078); CI changes; the vault provider implementation; removing the `varlock run`
wrappers (post-stability); `--attach`; `next dev` for agents; two environments per checkout; per-agent stacks;
Kubernetes/remote/production; changing the pinned CLI or backend; enabling the pooler.

## References

- [ADR-0011: `env` CLI](../decisions/0011-env-cli.md)
- [ADR-0010: one root values file](../decisions/0010-env-ssot.md)
- [Native runtime audit](../audits/supabase-native-runtime.md)
- [Issue #1077](https://github.com/logyQT/studiq/issues/1077), [Issue #1078: caching](https://github.com/logyQT/studiq/issues/1078)
