# `env` — one command to a predictable local environment

Status: **phase 0 complete** (evidence + this spec + [ADR-0011](../decisions/0011-env-cli.md),
2026-11-08). The two phase-0 operator decisions are **settled**: `db` is
db + auth + storage (§3) and `dev:admin` becomes `env:dev --admin` (§14.2), so
phases 1–3 are unblocked. Phase 4 is conditional on the phase-0 port spike and is
a **go** (see §6.4).

Replaces: `scripts/dev` and the `dev:*` script sprawl.
Scope: local development and agent workflows. Not CI provisioning, not hosted,
not production.
Related: [#1077](https://github.com/logyQT/studiq/issues/1077),
[ADR-0010](../decisions/0010-env-ssot.md),
[`docs/audits/supabase-native-runtime.md`](../audits/supabase-native-runtime.md).

Where this document and the issue's appended draft (the old `ENV-TOOL-SPEC.md`)
disagree, **this document wins** — it encodes the "Corrections applied after
review (2026-11-08)" and the phase-0 measurements.

---

## 0. Problem and goals

An agent currently spends 5–10 minutes on a task when the checkout's stack is
cold: it reads `AGENTS.md`, `scripts/dev` and `.env.schema` to learn the
incantation, then waits for the cold stack, migrations, seeds and `next build`.
The cost is not port discovery, and `dev:status --json` already reports stack
identity and health. `scripts/dev up` is idempotent and reuses a running stack,
so the cold path is paid once per cold checkout/stack. What is missing is a
single idempotent `ensure` with a warm path and a stable agent-facing contract
that composes start/build/serve and says what is ready — plus a build
fingerprint that does not go stale after a source edit (a source change can be
served by an old build).

Goals, in priority order:

1. **Idempotent `ensure`.** One command, safe to call concurrently, returns a
   machine-readable contract in < 1 s when warm.
2. **Native by default.** No Docker daemon on the happy path; no silent
   fallback.
3. **Composable profiles.** One blessed command per use case; orthogonal atoms
   underneath.
4. **No file archaeology.** The agent reads `--json`, not `.env`, `scripts/dev`
   or port tables.
5. **Keep the three real safety invariants** (ownership, cross-worktree build
   lock, shared-stack refusal).

Non-goal: making a cold full-app start take 30 s. `next build` dominates; the
lever there is a build cache ([#1078](https://github.com/logyQT/studiq/issues/1078)),
not this tool.

---

## 1. Fixed decisions (do not reopen)

These were settled in the 2026-11-07/08 review, confirmed by the phase-0
measurements, and (items 13–14) by the operator on 2026-11-08. They are
constraints on every phase.

1. **Target is per checkout, not per branch.** Stack identity stays
   `projectRoot + branch + stackName`. `--attach` (cross-checkout reuse) is
   future work.
2. **varlock is the only env loader, injector and validator.**
   Value-consuming commands (`ensure`, `serve`, `build`, tests) keep
   `varlock run --inject vars --`. `status`, `ports` and `doctor` run
   **unwrapped** so a locked vault never blocks them. The `env` CLI **never
   parses a dotenv file**. Removing the wrappers is a post-stability migration
   (after #1077 **and** #1078), never part of this issue.
3. **Ports: evidence before allocation.** The 20-port allocator is conditional
   on the phase-0 spike. Until it lands, the tool leases **only the app port**
   and discovers stack ports from `stack status`. The allocator is **phase 4**,
   after the cutover — not phase 2.
4. **No "reads no secrets" invariant.** The tool relays the stack's discovered
   keys to children. The invariant is that it **never prints, logs or stores**
   them, and `--json` excludes them.
5. **Nothing is dropped silently.** `env:dev` (human-only HMR),
   `env:reset-db`, `env:logs`, `env:prepull`, `env:setup` and `env:verify` are
   part of the cutover. §14 is the complete command map.
6. **Platform matrix is explicit.** Native supports Linux x86_64/arm64 and
   macOS arm64 only. Elsewhere `ensure` exits **3** with the exact Docker
   opt-in. Windows is WSL2-only.
7. **Phases are serial:** 0 → 1 → 2 → 3 → (4). Every phase touches
   `scripts/env/**`; parallel branches would conflict.
8. **No `dev:*` aliases and no back-compat layers.** `scripts/dev` is deleted in
   the cutover PR (phase 3). Repo policy: delete old code paths cleanly.
9. **Caching is out of scope.** Stack artifacts, build output and provider value
   caches are [#1078](https://github.com/logyQT/studiq/issues/1078).
10. **CI does not depend on the tool.** CI keeps calling `supabase stack`
    directly with `SUPABASE_EXPERIMENTAL_STACK=1` and the native runtime; the
    CLI assigns ports per runner (CI does not supply fixed stack ports).
11. **`env:setup` mutates; `env:verify` observes.** `env:setup` is human-only
    and idempotent; `env:verify` is read-only and agent-safe.
12. **One values file.** Root `.env.local` is the only hand-edited values file
    (ADR-0010). `.env.schema` stays value-free. The vault pointer (phase 2) is
    `.env.vault` in the primary checkout, Git-ignored, resolved through
    `STUDIQ_ENV_VAULT`.
13. **`db` = database + auth + storage.** Confirmed by the operator. Migrations
    need `storage.buckets` and the repo seeds need `auth.users.email_confirmed_at`,
    so a database-only stack cannot be provisioned; no `--no-migrate`/`--no-seed`
    skip path is added. See §3.
14. **`dev:admin` → `env:dev --admin`.** Confirmed by the operator. Admin HMR
    (port 4000) stays human-only; `apps/admin` is not part of `env:ensure`
    defaults. See §14.2.

---

## 2. Command surface

```
env:ensure   --profile <name> [atoms] [--json]      # idempotent; the blessed path
env:status   [--json]                               # never mutates; works with no stack
env:down     [--all] [--yes]                        # stop the web server; --all also stops the Supabase stack
env:build    [--force] [--json]                     # explicit build only
env:serve    [--json]                               # serve an existing build
env:recreate --runtime <native|docker> --yes        # destroy + create
env:doctor   [--json]                               # explain state; exit 1 on a real conflict
env:ports    [--json]                               # app port (+ block in phase 4)
env:supa     <args…>                                # bunx supabase with the contract exported
env:dev      [--admin] [atoms]                      # human-only next dev HMR (web, or admin with --admin)
env:reset-db [--yes]                                # destructive; this checkout only
env:logs     [--no-follow]                          # stack logs + .dev/web.log
env:prepull                                         # download artifacts without starting
env:setup    [--force]                              # human-only, mutating, idempotent
env:verify   [--full] [--json]                      # read-only, agent-safe
```

Rules:

- `ensure` is the only command an agent normally calls. Everything else is for
  humans or recovery.
- `status` / `doctor` / `ports` are read-only and work with **no stack running**.
- Destructive commands (`down --all`, `reset-db`, `recreate`, `--reseed`) refuse
  to run non-interactively without `--yes`.
- Every command accepts `--json` and prints **nothing but JSON** to stdout
  (human diagnostics go to stderr). `supa` is a passthrough: `--json` is passed
  to the CLI, not interpreted by the tool. Long-running commands (`dev`,
  `serve`, `logs`) treat `--json` as a **startup** contract: one JSON object
  when ready, then output on stderr.
- `supa` forwards arguments unchanged **except for destructive or stop-capable
  subcommands**, which it validates before forwarding — it never spawns the CLI
  on a rejected call:
  - `stop --all` is always rejected (exit 2, message naming the hard rule);
    there is no override.
  - `db reset` is rejected (exit 2): a database reset goes through the guarded
    `env:reset-db --yes` path (phase 3), which also invalidates the seed marker.
  - `stack destroy` / `destroy` is rejected outright (exit 2). Stack deletion is
    owned by `env:recreate --yes` / `env:down --all --yes`, which perform the
    ownership check.
  - Every stop-capable form — `stop`, `stack stop`, `restart`, `stack restart` —
    must name a stack (`--stack <name>` or `--stack-id <id>`) whose
    `project_root` is this checkout, matched from
    `stack list --output-format json`; otherwise exit **6**. `restart` (stop then
    start) gets the same ownership check.
  - Usage-shaped rejections exit 2; ownership conflicts exit 6.
- This passthrough policy lands in phase 1 (the spec is the contract).
- `env --help` and `env <command> --help` document the surface; `dev:help` is
  not replaced by a command.

### 2.1 Exit codes

Lifecycle commands (`ensure`, `down`, `build`, `serve`, `recreate`,
`reset-db`, `setup`, `prepull`) use:

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `0`  | ready / success                                                       |
| `2`  | bad usage (unknown flag, invalid profile, incompatible atoms)         |
| `3`  | native unavailable on this platform (message names the Docker opt-in) |
| `4`  | start failed (CLI error, migrations/seeds failed, port bind failed)   |
| `5`  | timeout waiting for readiness / build lock / start lock               |
| `6`  | conflict (another checkout owns the stack, shared-mode refusal)       |

Read-only commands:

- `status` / `ports`: `0` success, `2` bad usage; they do **not** use `4`/`5`
  for "not ready" — they report `ready: false` and exit `0`.
- `verify`: `0` when the schema loads (missing optional keys are reported, not
  fatal), `2` bad usage, `1` when the schema/inventory itself cannot be read.
- `doctor`: `0` no problems, `1` problems found (kept for compatibility with
  the current `dev:doctor`), `2` bad usage.

---

## 3. Profiles and atoms

Profiles are the contract. Atoms exist so a profile can be composed and a human
can hand-craft one.

| Profile | Starts (capabilities)                     | Tenant seed | Build / serve       | Typical use                     |
| ------- | ----------------------------------------- | ----------- | ------------------- | ------------------------------- |
| `db`    | database, auth, storage                   | no          | no                  | SQL, migrations, SQL-only tests |
| `api`   | db, rest, auth, storage                   | no          | no                  | API checks, integration tests   |
| `mail`  | api + local_smtp (Mailpit HTTP/SMTP/POP3) | no          | no                  | auth e-mail specs               |
| `full`  | db, rest, auth, storage, local_smtp       | no          | no                  | the stack without the app       |
| `web`   | full                                      | no          | build + serve       | the old `dev:up --prod`         |
| `qa`    | full                                      | yes         | build + serve       | `__tests__/qa`                  |
| `e2e`   | full                                      | yes         | build + serve       | `__tests__/e2e`                 |
| `admin` | full                                      | no          | admin build + serve | `apps/admin`                    |

**`db` = db + auth + storage (settled).** This table is the operator-confirmed
definition: `db` starts the database together with `auth` and `storage`, not the
database alone. A database-only stack cannot apply this repo's migrations and
seeds:

- `supabase/migrations/20260713000001_teacher_assignments.sql` inserts into
  `storage.buckets` (requires the `storage` capability);
- `supabase/seeds/01_seed.sql` inserts into `auth.users` and needs
  `email_confirmed_at` (requires the `auth` capability).

Both failures were reproduced in phase 0 (exit 1, `SQLSTATE 42P01` and
`SQLSTATE 42703`). With that minimum viable set a cold start is comfortably
inside the §12 budget: p50 **7.3 s**, p95 **8.0 s**. No `--no-migrate` /
`--no-seed` skip path is being added — `stack start` exposes no such switch, and
a profile that cannot apply the repo's own migrations and seeds is not useful.

Exact `supabase stack start -x` lists (the runtime contract; the table above is
the human view):

| Profile | `-x` (excluded capabilities)                           |
| ------- | ------------------------------------------------------ |
| `db`    | `rest,studio,mail,realtime,functions,analytics,pooler` |
| `api`   | `studio,mail,realtime,functions,analytics,pooler`      |
| `mail`  | `studio,realtime,functions,analytics,pooler`           |
| `full`  | `studio,realtime,functions,analytics,pooler`           |
| `web`   | `studio,realtime,functions,analytics,pooler`           |
| `qa`    | `studio,realtime,functions,analytics,pooler`           |
| `e2e`   | `studio,realtime,functions,analytics,pooler`           |
| `admin` | `studio,realtime,functions,analytics,pooler`           |

`database` is always on. `db` keeps `auth` and `storage` because migrations and
seeds need them (settled above); `api` adds `rest`. `studio`
is excluded from every default profile; `--studio` removes it from the list.
`--mail` enables `local_smtp`; `full`/`web`/`qa`/`e2e` include it because the
app's auth flows use Mailpit. `--realtime`/`--functions`/`--analytics` remove the
corresponding entry. `--pooler` is **rejected (exit 2)**: `supabase/config.toml`
sets `[db.pooler] enabled = false`, and removing `pooler` from `-x` does not
enable it — enabling the pooler needs a config change tracked elsewhere. The
parser must reject impossible combinations at usage time (exit 2) rather than
let the CLI fail later — notably `studio` without `rest` (the CLI errors with
"Studio cannot be started without the REST API capability").

Atoms (all idempotent, all composable):

```
--db --rest --auth --storage --studio --mail --functions --analytics --realtime
--seed --no-seed --reseed --reconcile --web --build --force-build --prod --admin
--runtime <native|docker> --stack <name> --port-block <n> --app-port <n>
--wait <s> --json --yes --quiet --verbose
```

- Capability names map 1:1 to `supabase stack start -x` names
  (`rest`, `auth`, `realtime`, `storage`, `functions`, `studio`, `mail`,
  `analytics`, `pooler`). The profile table is the single source of truth for
  the exclude list.
- `--prod` implies build + serve. `--web` without `--prod` is rejected (exit 2):
  `next dev` belongs to the human-only `env:dev`; agents build and serve.
- `--no-seed` wins over a profile default; `--reseed` forces tenant seeding.
- `--reconcile` permits an in-place capability restart (see §5.2); without it a
  capability change exits 6.
- `--admin` targets `apps/admin` on port 4000: with `env:dev` it starts the admin
  app's HMR, with `--prod` it builds and serves it (see §14.2). It is
  human-only either way.

---

## 4. Runtime policy

### 4.1 Native is the default and the only auto-selected runtime

- Every stack start passes the **selected** runtime explicitly — `--runtime native`
  by default, `--runtime docker` only when selected. Never rely on the CLI's
  auto-detection (it prefers Docker when available).
- **No automatic fallback.** If native is unavailable or fails, exit **3** with
  a diagnostic and the exact opt-in:
  `SUPABASE_RUNTIME=docker bun run env:ensure …` or
  `bun run env:ensure --runtime docker …`.
- Docker is an explicit escape hatch. When used, print one line to stderr:
  `runtime=docker (explicit; expect slower boots)`.
- An existing stack keeps the runtime it was created with (matching
  `AGENTS.md`). `ensure` warns on every call when it finds a Docker stack and
  continues to use it; `env:recreate --runtime native --yes` converts it (local
  data is deleted). A capability restart (§5.2) passes the stack's **persisted**
  runtime, never the default.
- `env:status --json` always reports `runtime`, so agents and CI can assert.
- CI stays native and keeps calling `supabase stack` directly.

### 4.2 Platform matrix

| Platform                      | Native | Notes                         |
| ----------------------------- | ------ | ----------------------------- |
| Linux x86_64 / amd64          | ✅     | glibc ≥ 2.35, `tar`, non-root |
| Linux arm64 / aarch64         | ✅     | glibc ≥ 2.35, `tar`, non-root |
| macOS arm64 (Apple silicon)   | ✅     | `tar`                         |
| macOS x86_64                  | ❌     | exit 3 + Docker opt-in        |
| Windows (native)              | ❌     | unsupported; use WSL2         |
| Windows Subsystem for Linux 2 | ✅     | treat as the Linux row        |
| Anything else                 | ❌     | exit 3 + Docker opt-in        |

The CLI performs the authoritative platform check; the tool's check is an early
hint so the failure message is actionable. Running as root is allowed only with
`SUPABASE_NATIVE_POSTGRES_USER` set to a non-root account (the CLI cannot run
Postgres as root).

### 4.3 Docker compatibility

- `--runtime docker` / `SUPABASE_RUNTIME=docker` is the only way to get a Docker
  stack. It is documented as compatibility, not the default.
- Warn on every command that observes a Docker stack:
  `this stack uses runtime=docker (explicit); recreate with --runtime native to convert`.
- Never silently mix runtimes in one stack; the CLI persists the runtime and
  refuses conversion without `destroy`.

---

## 5. Identity, lifecycle and concurrency

### 5.1 Identity

Stack identity is the CLI's: **`projectRoot + "\0" + branch + "\0" + stackName`**
(`stackName` blank means the branch's default stack). The tool does not derive
its own project id; it asks `stack list`/`stack status` and matches on
`project_root` + `name` + `branch_context` (the current `scripts/dev` already
does this).

- `env:status --json` exposes `stack.id`, `stack.name`, `stack.branch`,
  `stack.projectRoot`.
- `--attach` is **future work** (cross-checkout reuse). Do not implement it in
  phases 1–4.
- The registry (below) may record the identity, but the CLI remains the source
  of truth for "does this stack exist?".

### 5.2 Start lock and warm path

- **Start lock per stack identity**, separate from the port lock (phase 4) and
  the build lock (existing). Lock directory:
  `${STUDIQ_DEV_REGISTRY:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/studiq-dev-$(id -u)}/locks/`.
  The directory must be private (mode 700), owned by the current user, not a
  symlink; refuse otherwise.
- Lock holder writes `pid` + a heartbeat every 2 s. The **port lease** reclaims
  after the TTL (default 15 min). The **start lock** can take over immediately
  when the holder pid is dead: there is no healthy stack to protect, and the
  waiter re-checks `stack status` before starting.
- `ensure` order:

  1. registry claim (if phase 4)
  2. start lock
  3. health probes (one per requested capability)
  4. capability check
  5. start (cold, or restart on a capability mismatch)
  6. wait ready
  7. seed-marker check
  8. build-fingerprint check
  9. serve if requested
  10. heartbeat + JSON

- **Warm path:** one probe per requested capability + one schema read;
  **p95 < 1000 ms covers the whole set**. Do not spawn `stack status` on the
  warm path when the heartbeat is fresh; each probe is a local HTTP call (auth
  `GET /auth/v1/health`, the API root, storage health, Mailpit HTTP when `mail`
  is requested, Studio when `--studio` is — the minimal `api` profile is just
  auth/API root). Take the running capability set from the record written at
  start (only a missing or stale record costs one `stack status`). The phase-0
  baseline for the current warm `dev:up --prod` is p50 885 ms / p95 936 ms (it
  still spawns `stack status`), so the budget is achievable but tight on WSL2 —
  the heartbeat cache is required for margin.
- **Probe every requested capability.** Readiness requires each service the
  profile asks for: REST/API root, auth health, storage health, Mailpit HTTP
  when `mail` is requested, and Studio when `--studio` is requested. A requested
  service that is down means `ready: false`. Invalidate the cached capability
  record when a service exits, so the next call re-probes.
- **A capability superset is ready.** A running stack with more capabilities
  than the profile requests satisfies it: never remove capabilities to match a
  narrower profile. Only **adding** capabilities can need a restart.
- **Adding capabilities needs `--reconcile`.** Without it, exit 6 with a message
  naming the missing capability and the flag (plus `--yes` when
  non-interactive). This is deliberate: another agent in the same checkout may
  be using the stack, and `AGENTS.md` already forbids stopping a stack you do
  not own — a reconcile never touches another checkout's stack.
- **A reconcile restart is in-place.** It runs under the start lock, keeps the
  stack's **persisted runtime** (a Docker→native conversion is only
  `env:recreate --runtime native --yes`), never destroys data, and passes the
  **currently observed** API/DB/Studio/mail ports as overrides so active callers
  keep their endpoints (read-then-pin in phases 1–3; the phase-4 block replaces
  the read). It then re-probes and reports. Phase 0 measured stop + resume at
  ≈1.7 s + 5.0 s, so a warm `ensure --profile web --reconcile` after
  `ensure --profile api` adds `mail` without moving endpoints.
- `down` stops only the web server and is idempotent. It **keeps** the app-port
  lease (and, in phase 4, the block) while the Supabase stack still runs:
  `supabase/config.toml` binds the auth `site_url` / `additional_redirect_urls`
  to `APP_URL`, so the stack must stay on the port it was started with. The
  lease is released by `down --all` or once the stack is stopped. This is a
  deliberate correction to the issue's "down releases the lease" wording.
- Hard rules: never `supabase stop --all`, never `pkill`, never an unscoped
  `docker rm`. The only stop is `supabase stack stop --stack <name>` for a stack
  this checkout owns.

### 5.3 Shared mode (`SUPABASE_SHARED=1`)

- `SUPABASE_SHARED=1` means this checkout reuses a stack another checkout owns.
  `ensure` never starts/stops/destroys/reseeds/reconciles; it reads explicit
  `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
  from `.env.local` (or the process environment). A capability gap is reported,
  not fixed.
- Plain `down` is allowed: it stops only this checkout's local web server and
  never touches the shared stack. `down --all`, `recreate`, `reset-db` and
  `--reseed` fail with exit 6; `status` / `ports` / `verify` still work.
- The shared QA stack (`:3010` / `:54421`) is protected: `ensure` refuses
  `APP_URL`/`SUPABASE_URL` on those ports unless `DEV_ALLOW_SHARED=1` or
  `SUPABASE_SHARED=1`.

---

## 6. Port policy

### 6.1 Phases 1–3: app port only, stack ports discovered

- The tool leases **one app port** (default 3000 if free) in the existing
  registry. It is a single-port lease, never carved from a stack block. The
  lease follows the **stack** lifetime, not the web server's: plain `down` keeps
  it (see §5.2) and `down --all` (or a stopped stack) releases it.
- Stack ports are **discovered** from `supabase stack status --output-format json`
  after start. The tool never does port math or assumes a base port.
- In stack mode the tool **clears inherited `SUPABASE_*_PORT` values from the
  child environment** in phases 1–3, so a **cold** start lets the CLI assign
  ports rather than honoring a stale fixed-port contract from another checkout
  (the current `scripts/dev` does the same). A capability restart is the
  exception: it pins the currently observed ports (read-then-pin, §5.2) so
  active callers keep their endpoints. The tool never edits `.env.local`. Phase
  4 re-introduces the variables only when the lease provides them.
- `env:ports --json` reports `{ appPort, block: null, stackPorts: "dynamic" }`
  until phase 4.

### 6.2 Phase 4 (conditional): 20-port block lease

The unit is a **20-port block per stack**, pool `20000–32767` inclusive
(636 blocks as specified; the range has room for 638, so 48 ports stay as
unallocated margin), never the ephemeral range. The CLI itself does not allocate
blocks; the block is a tool-side reservation so two checkouts cannot be handed
the same port.

- Base block = `fnv1a64(projectRoot + "\0" + branch + "\0" + stackName) % 636`,
  then linear probe to the first unleased block **inside a mutex**.
- Registry: extend the existing dev registry. Recommended: **one JSON file per
  lease + `flock` on a registry lock file, atomic read-modify-write
  (temp + rename)**. `bun:sqlite` is acceptable but would introduce a second
  store next to the existing registry; the JSON+flock path reuses
  `scripts/dev-registry.ts`'s atomic-write and ownership checks. Justify the
  choice in the PR.
- Lease record:
  `{ block, projectRoot, branch, stackName, stackId?, pid, createdAt, heartbeatAt, ttlSec }`.
- **Reclaim** only when **all** hold: pid dead, heartbeat older than TTL
  (default 15 min), and the stack is not running per `stack list`. Never reclaim
  a leaked block whose stack is healthy.
- App port is a **separate single-port lease** in the same registry, default
  3000 if free, never carved from the stack block. Conversely, an app-port lease
  never takes a port inside a leased stack block.
- **Block candidates respect app-port leases.** Under the same mutex, check each
  candidate block against **all app-port leases**: never allocate a block that
  contains a leased app port. A checkout can hold an app lease inside
  `20000–32767` while its web server is stopped, so an `EADDRINUSE` probe would
  not catch the collision. Reclaim follows the existing pid + TTL +
  not-running rules.
- The block is held while the stack runs and released when the stack stops
  (`down --all`), matching the app-port lease; a plain `down` keeps both.
- `EADDRINUSE` releases the block, marks it suspect for 10 min, takes the next
  block, retries up to 3 times, then exits 4 with the collected logs.
- Pass the leased ports on **every** `start` (create and resume). Phase 0 proved
  the CLI re-rolls API/DB/Studio when no overrides are supplied.

### 6.3 Port override mapping (verified in phase 0)

| Service                         | Env var                                | Create       | Resume       |
| ------------------------------- | -------------------------------------- | ------------ | ------------ |
| API gateway (rest/auth/storage) | `SUPABASE_API_PORT`                    | ✅           | ✅           |
| Database                        | `SUPABASE_DB_PORT`                     | ✅           | ✅           |
| Studio                          | `SUPABASE_STUDIO_PORT`                 | ✅           | ✅           |
| Mailpit HTTP                    | `SUPABASE_LOCAL_SMTP_PORT`             | ✅           | ✅           |
| Mailpit SMTP                    | `SUPABASE_LOCAL_SMTP_SMTP_PORT`        | ✅           | ✅           |
| Mailpit POP3                    | `SUPABASE_LOCAL_SMTP_POP3_PORT`        | ✅           | ✅           |
| Analytics (inferred)            | `SUPABASE_ANALYTICS_PORT`              | not tested   | not tested   |
| Edge inspector (inferred)       | `SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT` | not tested   | not tested   |
| Pooler (inferred)               | `SUPABASE_DB_POOLER_PORT`              | not tested   | not tested   |
| Shadow DB (inferred)            | `SUPABASE_DB_SHADOW_PORT`              | not tested   | not tested   |
| pgmeta (internal)               | —                                      | not pinnable | not pinnable |

`SUPABASE_MAIL_PORT` is a **dead legacy name** in CLI 3.0.0; do not use it.
`pgmeta.http` has no config section and is CLI-assigned; it is internal and
loopback-only. The phase-4 PR must either (a) accept one unpredictable internal
port per stack and document it, or (b) reserve a block slot for it and probe
before start. Do not claim the block is fully pinned until that is decided.

### 6.4 Phase-4 verdict

**GO.** The phase-0 spike proved:

1. explicit `SUPABASE_API_PORT` / `SUPABASE_DB_PORT` / `SUPABASE_STUDIO_PORT`
   are honored on **create and resume**;
2. `SUPABASE_LOCAL_SMTP_*_PORT` is honored on **create and resume**;
3. the same stack resumed without overrides re-rolls API/DB/Studio, so the
   tool must pass its block on every start;
4. the port names are the config-section names, so the mapping is predictable.

Point 3 is also why a capability restart pins the ports it just observed
(read-then-pin, §5.2): it is a resume, and a resume without overrides would move
every endpoint. This is not the phase-4 block — it is a per-restart read of the
running stack, available in phases 1–3.

The allocator still lands **after** the cutover (phase 4), because it is not
needed for the warm path and every phase touches the same files. Phase 4 is
gated on the phase-3 cutover and on issue §11 tests 1, 2, 4 and 5.

---

## 7. Seeding

- Cold **stack** creation applies migrations + `supabase/seeds` automatically
  (the CLI does this). `env` must not duplicate or re-run them.
- Two kinds of tenant seeding:
  - **Idempotent tenant/demo data** may be gated on
    `(stackId, hash(seed scripts))`; skip when the marker matches. `--no-seed`
    wins over a profile default; `--reseed` forces.
  - **QA/e2e fixtures are per run, never marker-gated.** `scripts/seed/qa.ts`
    needs a brand-new account for each independent run (`--fresh`/`--run`
    suffix), so a marker must not imply first-run freshness. When seeding is
    enabled (`--reseed` or the profile default), the `qa`/`e2e` profiles seed
    with a fresh run suffix; `--no-seed` disables seeding entirely.
- **The seeder is bound to this checkout's stack.** `ensure` passes the
  discovered endpoint explicitly and `qa/env.json` only fills keys that are
  still unset (the process environment wins). Before writing, the seeder
  verifies the endpoint belongs to this checkout's stack (`project_root` match)
  and aborts otherwise — `qa/env.json` must not be able to redirect a seed into
  a foreign or shared stack.
- **Fixture files are scoped to the stack _and_ the run.** `qa/.tenants` is
  currently a fixed path shared across stacks and runs, so a second
  `ensure --profile qa` on the same stack can overwrite files a live run is
  still reading. Write `qa/.tenants/<stackId>/<runId>/…` (or carry stack + run
  in the marker and reject mismatches). Readers must take the run id from the
  environment/seed output, never from a fixed path. The phase-3 cutover updates
  `scripts/seed/qa.ts`, the QA/e2e helpers and the docs.
- Markers live in `.dev/` (gitignored, mode 600) or the registry; never in the
  database. A reset removes the marker, and **any destroy/recreate removes it
  too** (`env:recreate`): stack ids can be reused and a marker for a destroyed
  DB is meaningless. Before trusting a marker, compare the stack's creation time
  (or DB identity) so an externally recreated stack is not mistaken for a seeded
  one.
- Tenant seed commands remain `scripts/qa-tenant.ts` / `scripts/e2e-seed.ts`;
  the tool only invokes them, it does not reimplement them.
- Never tenant-seed a stack this checkout does not own (`SUPABASE_SHARED=1`).

---

## 8. Building and serving

- **Never build for `db` / `api` / `mail` / `full`.** Build only for `web`,
  `qa`, `e2e`, `admin`, or an explicit `env:build`.
- `--prod` implies build + serve. `--web` without `--prod` is rejected (exit 2);
  `env:dev` is the only HMR path (web, or `apps/admin` with `--admin`) and it is
  human-only.
- **Set the local posture: `APP_ENV=development`.** Before build/serve, the tool
  sets `APP_ENV=development` when it is unset or empty and preserves an explicit
  value (the app's non-production posture rule; `scripts/dev` does the same). The
  app defaults to `production`, whose payment preflight needs a live Stripe key
  and an `https` site URL, so an unset `APP_ENV` otherwise fails a local
  build/serve. `env:dev` does the same.
- **Build fingerprint** must include:
  - the `NEXT_PUBLIC_*` values that get inlined at build time
    (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SITE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`);
  - `APP_ENV`, because it changes build/runtime behaviour (payment posture);
  - a **working-tree content hash**, not just `HEAD^{tree}` +
    `git status --porcelain`: a second edit to the same modified file leaves
    both unchanged. Hash the contents of tracked changes **and** build-relevant
    untracked source files, so any source edit invalidates the build;
  - the build mode (`production`).
- Build only on mismatch; `--force-build` overrides. The phase-0 baseline shows
  the current fingerprint has **no tree hash**, so `dev:up --prod` serves a
  stale build after a source edit (measured: 2.1 s, `BUILD_ID` unchanged). This
  is a required fix, not a nice-to-have.
- Build lock: one `next build` across all worktrees (port the existing
  `flock`/mkdir lock from `scripts/dev`). The lock is held around the build,
  not the whole `ensure`.
- **Safe rebuild handover.** `scripts/dev` refuses to build while the web server
  runs, so a warm `ensure` after a source edit cannot simply rebuild. The tool
  stops **its own** web server, takes the build lock, builds, starts the new
  build and health-checks it. If the build fails, it restarts the previous
  build so the environment is not left down. It never reports the old PID as
  ready.
- `env:serve` serves an existing build; if the fingerprint is stale, fail with
  a clear message and `env:build` (or `ensure --profile web`).
- `next start` must keep `--keepAliveTimeout 55000` (the app's `start` script
  already does); the tool calls the workspace script, not a raw `next start`.

---

## 9. `--json` contract

Every command accepts `--json` and prints **only** JSON to stdout. The shape is a
superset of the current `dev:status --json` (no renames that break consumers):

```json
{
  "ready": true,
  "profile": "api",
  "runtime": "native",
  "cold": false,
  "stack": {
    "id": "65c7…",
    "name": "default",
    "branch": "refs/heads/feat/x",
    "projectRoot": "/…/feat/x"
  },
  "ports": {
    "block": null,
    "app": 3011,
    "api": 20041,
    "db": 20042,
    "studio": 0,
    "mail": 0,
    "mailSmtp": 0,
    "mailPop3": 0,
    "analytics": 0,
    "edgeInspector": 0,
    "pooler": 0,
    "pgmeta": 20043
  },
  "urls": {
    "app": "http://localhost:3011",
    "supabase": "http://127.0.0.1:20041",
    "db": "postgresql://127.0.0.1:20042/postgres",
    "mail": null,
    "studio": null
  },
  "seeded": true,
  "build": { "present": true, "fingerprint": "…" },
  "warnings": [],
  "log": ".dev/env.log",
  "projectId": "stack-…",
  "worktree": "/…/feat/x",
  "mode": "default",
  "shared": false,
  "sharedOwner": null,
  "owner": null,
  "registry": "/tmp/studiq-dev-1000",
  "stackId": "…",
  "branch": "refs/heads/feat/x",
  "web": { "url": "http://localhost:3011", "pid": 1234, "http": 200 },
  "supabase": { "url": "http://127.0.0.1:20041", "http": 200 },
  "dbUrl": "postgresql://127.0.0.1:20042/postgres",
  "mailUrl": null
}
```

Rules:

- **No secrets.** No `ANON_KEY`, `SERVICE_ROLE_KEY`, `PUBLISHABLE_KEY`,
  `SECRET_KEY`, S3 key names or values, and no DB password. The `db` URL is
  emitted without userinfo (`postgresql://127.0.0.1:<port>/postgres`); the child
  environment still receives the CLI's full `DB_URL`. The legacy `dbUrl` field
  is the same credential-free URL.
- **Known false is `false`; `null` only for unknown.** `ready`, `cold` (once
  known) and other boolean facts are `false` when the answer is known to be
  false. `null` is reserved for genuinely unknown values (`profile`, `seeded`,
  `build.fingerprint`, stopped-port metadata); never use `null` for a known
  `false`, and never omit a field.
- `ports.block` is `null` until phase 4. `ports.*` for a stopped service is `0`.
- `urls.studio` / `urls.mail` are `null` unless the service is running;
  `--studio` is the only way Studio starts.
- `warnings` is an array of short strings (no key names/values).
- `log` points at `.dev/env.log` (mode 600).
- **Timing is not part of the machine contract.** There is no `warmMs` field;
  measure warm/cold latency from `.dev/` logs or benchmarks. `cold` stays.
- The legacy camelCase fields (`projectId`, `worktree`, `mode`, `shared`,
  `sharedOwner`, `owner`, `registry`, `stackId`, `branch`, `web`, `supabase`,
  `dbUrl`, `mailUrl`) stay for compatibility; the current `dev:status --json`
  has no in-repo machine consumers, so the new fields are additive.

---

## 10. Safety invariants (ported, non-negotiable)

1. **Ownership:** only the checkout that created a stack may stop/destroy it.
   The CLI's `project_root` is checked before `stack stop`/`destroy`.
2. **Build lock:** one `next build` across all worktrees.
3. **Shared mode:** `SUPABASE_SHARED=1` disables stack
   start/stop/destroy/reseed/reconcile; read-only commands and plain `down`
   (local web server only) still work.
4. **No `stop --all`, no `pkill`, no unscoped `docker rm`.**
5. **Destructive actions require `--yes` when non-interactive.**
6. **Every mutating command logs what it did to `.dev/env.log` (mode 600).**
7. **Registry trust:** the registry directory must be a real directory owned by
   the current user, mode 700, not a symlink; otherwise refuse to read/write.
8. **No secrets in the registry, `.dev/`, logs or `--json`.**

---

## 11. Environment loading (varlock seam)

- **Value-consuming commands keep the wrapper for the whole of #1077:**
  `varlock run --inject vars -- bun scripts/env/cli.ts <command>`. This is
  exactly how `dev:serve` / `dev:build` work today, and no phase of this plan
  drops it.
- **Unwrapped read-only commands:** `env:status`, `env:ports` and `env:doctor`
  run **without** varlock so a locked vault cannot block them. They read only
  discovered stack/registry state and the schema file's key names. `env:verify`
  is read-only but invokes `varlock load` (it must not parse `.env.local`
  itself); it consumes the exit status and never echoes the output.
- The CLI **never parses a dotenv file**. It reads the process environment
  (already resolved by varlock), adds the discovered stack URLs/keys to the
  child environment, and never prints/logs/stores them.
- **varlock is the loader, the injector and the validator** — not
  "validator-only". It loads/injects values for value-consuming commands and
  keeps validating (`env:check`, `env:scan`, the inventory guard).
- **Removing the wrappers is a post-stability migration, not this issue.** Only
  once **both #1077 and #1078** are stable does the wrapper removal become a
  deliberate migration, and only through a framework integration (Next/Bun) or
  an `env`-owned injection path. Plugins/resolvers resolve provider **values**;
  they do **not** remove wrappers. Never propose dropping the wrappers in any
  phase.
- New keys introduced by the tool (e.g. `STUDIQ_ENV_VAULT`, the
  `SUPABASE_LOCAL_SMTP_*_PORT` trio) must be added to `.env.schema` in the same
  PR that reads them (the `check-env-inventory` guard fails otherwise).
  `.env.schema` stays value-free.

> **Superseded wording — do not delete the wrappers.** Issue #1077's pre-review
> appendix and its "varlock is validator-only" acceptance line predate this
> correction. varlock stays the loader/injector for value-consuming commands and
> the validator; `varlock run` is removed only in the post-stability migration
> (after #1077 **and** #1078), never inside this issue.

### 11.1 Vault seam (phase 2; the `setup`/`verify` commands land in phase 3)

The tool must stay vault-agnostic: `env` receives an already-resolved process
environment and passes it to children. Provider access belongs to varlock;
adding a vault later changes `.env.schema` / `.env.local` only — never
`scripts/env/**`.

- **Refs are varlock resolver calls, not a custom format:**
  `OPENAI_API_KEY=op(op://studiq/llm/api-key)` (1Password),
  `STRIPE_SECRET_KEY=bwp("Stripe", field=secret-key)` (Bitwarden),
  `RESEND_API_KEY=infisical("RESEND_API_KEY")` (Infisical). The function names
  the provider, so there is no default provider and no relative refs.
- **Pointer file:** one per machine, in the **primary checkout** at
  `.env.vault` (repo root, Git-ignored). Worktrees resolve it through
  `STUDIQ_ENV_VAULT`, defaulting to the first entry of
  `git worktree list --porcelain` (the same helper `scripts/spin` uses). Nothing
  is copied into a worktree.
- **Loading:** value-consuming wrappers pass
  `varlock run --path "$STUDIQ_ENV_VAULT" ...` (repeatable `--path`).
  Phase 2 must verify that `--path` **merges** with the checkout's schema
  (does not replace it) and that `.env.local` still wins by precedence.
- **Optional plugins:** `@init*`/plugins must be importable/disableable per
  developer, so someone with no vault still works from `.env.local`.
- **`env:setup`** (human-only, mutating, idempotent): resolves the primary
  checkout, creates `.env.local` if missing (mode 600, comment/empty scaffold,
  never a value), and later the `.env.vault` ref scaffold (one empty line per
  `@sensitive` key, a comment showing the resolver syntax). Never overwrites
  without `--force`; never guesses vault item names; never reads or prints a
  value.
- **`env:verify`** (read-only, agent-safe): default checks `.env.local` + the
  schema only (fast, unauthenticated) and reports missing key **names** (never
  values) with one `next_action`; `--full` additionally resolves the
  `.env.vault` refs and reports provider status (`available` / `locked` /
  `missing`). It consumes `varlock load`'s exit status rather than echoing its
  output (which is only prefix-redacted). `env:doctor` stays about
  stack/runtime state (ports, ownership, runtime), not secrets.
- **Acceptance:** `scripts/env/**` contains no provider code and no ref
  parsing; swapping `.env.local` for a plugin-backed resolution leaves it
  untouched; a worktree resolves refs from the primary checkout's `.env.vault`
  without copying it; `env:setup` is idempotent and never writes a value;
  `env:verify` is read-only and prints no values; `env:status` still works with
  the vault locked.
- **Phase-2 prerequisite:** `.env.vault` is not in `.gitignore` today. Add it
  (and `STUDIQ_ENV_VAULT` to `.env.schema`) in phase 2.

---

## 12. Latency budgets and measured baseline

Targets from the issue §12. Baseline measured in phase 0 on the current
`scripts/dev` (raw runs: the [phase-0 evidence
comment](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664);
local `.dev/` logs are supplementary only and are not readable from other
checkouts). Host: WSL2, Debian 12, x86_64, 16 vCPU, 19 GiB RAM, glibc 2.36,
Bun 1.4.4, Supabase CLI 3.0.0, Docker 29.9.1 running; native artifact cache
warm.

| Path                     | Target  | Measured p50                                                             | Measured p95        | Verdict                              |
| ------------------------ | ------- | ------------------------------------------------------------------------ | ------------------- | ------------------------------------ |
| warm `ensure`            | ≤ 1 s   | 885 ms (`dev:up --prod` warm) / 855 ms (`dev:status`)                    | 936 ms / 928 ms     | pass (tight; heartbeat cache needed) |
| cold `db`                | ≤ 45 s  | 7347 ms (db+auth+storage; db-only fails)                                 | 7994 ms             | pass                                 |
| cold `api`               | ≤ 75 s  | 7250 ms                                                                  | 7277 ms             | pass                                 |
| cold `web`, build cached | ≤ 120 s | 2207 ms (warm stack) / 13416 ms (cold stack, cached build)               | 2388 ms / 13558 ms  | pass                                 |
| cold `web`, code changed | ≤ 300 s | 10184 ms (explicit build+serve) / 20274 ms (cold stack + forced rebuild) | 11780 ms / 21651 ms | pass                                 |
| tenant seed              | ≤ 20 s  | not measured in phase 0                                                  | —                   | phase 3 must measure                 |

Caveats:

- "Cold" means a new stack with the native artifact cache warm. A first-ever
  artifact download is ~46 s (audit), which is a one-time machine cost.
- The current warm path still spawns `stack status`; the new heartbeat cache is
  what gives the 1 s budget margin.
- The current build fingerprint has no tree hash, so the "code changed" path
  only rebuilds when the fingerprint is removed or the ports change. The new
  fingerprint must include the tree hash; the measured explicit rebuild is the
  fair baseline.

---

## 13. Acceptance tests (issue §11)

Pure parts live in `__tests__/unit/env/` (run by the `unit` job,
`bun run test:unit`); lifecycle tests run
via `bun run env:selftest` (a script that creates and destroys its own scratch
stacks, never a stack it does not own).

1. **Same checkout, same second:** two `env:ensure --profile api --json`
   processes → both exit 0, identical `stack.id` and `ports`, exactly one start
   in the log, no second stack in `stack list`.
2. **Different checkouts, same second:** two worktrees → separate stacks
   (identity includes `projectRoot`), disjoint app ports; stack ports are
   disjoint by CLI assignment, or via the phase-4 allocator.
3. **Warm ensure:** second call p95 < 1 s, `cold: false`, **no** `stack status`
   subprocess when the heartbeat is fresh.
4. **Crash during start:** `kill -9` the holder mid-start → waiter takes over
   within the TTL, ends ready, lease reclaimed.
5. **Foreign port:** occupy the hashed block (phase 4) with a listener →
   allocator bumps, records a deviation, still succeeds.
6. **Idempotent down:** `env:down` twice → exit 0 both times; the app-port
   lease is kept while the stack runs and released exactly once by
   `down --all`.
7. **Native-only:** with Docker running, default ensure reports
   `runtime: "native"`; only `--runtime docker` produces a Docker stack.
8. **Shared mode:** `SUPABASE_SHARED=1` → `ensure` succeeds against the shared
   stack with zero stack mutation (no start/stop/destroy/reseed/reconcile);
   `status` / `ports` succeed; `down --all` / `recreate` / `reset-db` /
   `--reseed` exit 6.
   (Supersedes the issue's literal test 8, which predates the existing
   `dev:up`/`AGENTS.md` shared-mode behaviour.)
9. **JSON contract:** schema snapshot; no sensitive stack key name or value in
   the output (`.env.local` inventory key names may appear only in
   `env:verify`).
10. **No `--studio` by default:** profile `full` leaves Studio stopped;
    `--studio` starts it.

Add tests for the phase-0 corrections:

11. **db profile:** `env:ensure --profile db` succeeds (db+auth+storage) and
    applies migrations + seeds.
12. **Build fingerprint:** a source edit invalidates the build; two successive
    edits to the **same** file both invalidate it (the second leaves
    `HEAD^{tree}` and `git status --porcelain` unchanged); `--force-build`
    always builds.
13. **Capability change:** `env:ensure --profile api` then
    `env:ensure --profile web` without `--reconcile` exits 6 naming the missing
    capability; with `--reconcile --yes` it restarts this checkout's stack,
    keeps data and the persisted runtime, keeps the observed endpoints and
    reports the new capability set. A narrower request against a superset is
    ready with no restart.

---

## 14. Command map

### 14.1 Complete map

| Old                                                                             | New                                | Notes                                  |
| ------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| `bun run dev`                                                                   | `bun run env:dev`                  | human-only HMR; agents use build+serve |
| `bun run dev:web`                                                               | `bun run env:dev`                  | same                                   |
| `bun run dev:up`                                                                | `bun run env:ensure --profile web` | behavior change: no `next dev`         |
| `bun run dev:up --prod`                                                         | `bun run env:ensure --profile web` | same result (build + serve)            |
| `bun run dev:serve`                                                             | `bun run env:serve`                |                                        |
| `bun run dev:build`                                                             | `bun run env:build`                |                                        |
| `bun run dev:status`                                                            | `bun run env:status`               | `--json` preserved                     |
| `bun run dev:down`                                                              | `bun run env:down`                 |                                        |
| `bun run dev:down --all`                                                        | `bun run env:down --all`           | `--yes` required non-interactively     |
| `bun run dev:reset-db`                                                          | `bun run env:reset-db`             | `--yes` required non-interactively     |
| `bun run dev:logs`                                                              | `bun run env:logs`                 | stack logs + `.dev/web.log`            |
| `bun run dev:doctor`                                                            | `bun run env:doctor`               | exit 1 on a real conflict              |
| `bun run dev:ports`                                                             | `bun run env:ports`                | `--json`; `--suggest` may stay         |
| `bun run dev:prepull`                                                           | `bun run env:prepull`              | `stack install`                        |
| `bash scripts/dev supa …`                                                       | `bun run env:supa …`               | APP_URL + contract exported            |
| `bash scripts/dev up\|serve\|status\|down\|build\|logs\|doctor\|ports\|prepull` | —                                  | deleted with `scripts/dev`             |
| `bun run dev:admin`                                                             | `bun run env:dev --admin`          | admin HMR on :4000; human-only         |

New commands with no old equivalent: `env:ensure` (composed from `dev:up`),
`env:recreate`, `env:setup`, `env:verify`.

### 14.2 `dev:admin` → `env:dev --admin` (settled)

`bun run dev:admin` (admin HMR on :4000) is a `dev:*` script and is deleted under
the "no `dev:*` scripts" rule. The confirmed replacement is **`bun run env:dev
--admin`**:

- `env:dev --admin` starts `apps/admin`'s HMR on port 4000; without `--admin`
  it starts the web app's HMR exactly as today.
- It stays **human-only**, symmetric with `env:dev` for web: agents use
  `env:build` + `env:serve`, or `env:ensure --profile admin`, and never HMR.
- `env:ensure --profile admin` (and `--admin --prod`) remains the build + serve
  path for the admin app, so the profile table in §3 and the atom agree.
- `apps/admin` stays **out of `env:ensure` defaults** — nothing selects it
  unless asked.
- The phase-3 cutover updates the references in `AGENTS.md`, `README.md`,
  `apps/admin/README.md` and ADR-0009 to `bun run env:dev --admin`.

The rejected options were `env:ensure --profile admin` alone (no HMR) and
keeping `dev:admin` as the one `dev:*` exception (violates the no-`dev:*` rule).

### 14.3 References the cutover must update

- `docs/ONBOARDING.md` (many mentions; it still says Docker Desktop is a
  prerequisite), `AGENTS.md`, `README.md`, `docs/database.md`,
  `docs/deployment.md`, `docs/e2e-campaign.md`, `docs/limits.md`,
  `docs/project-structure.md`, `docs/decisions/0010-env-ssot.md`,
  `docs/audits/supabase-native-runtime.md`, `scripts/load-test/README.md`.
- `AGENTS.md` currently says CI is "non-stack" with fixed `SUPABASE_*_PORT`
  variables; that is wrong. Correct it in the cutover to
  `SUPABASE_EXPERIMENTAL_STACK=1` + `SUPABASE_RUNTIME=native` + CLI-assigned
  ports per runner (matching `verify.yml`).
- Code comments: `scripts/check-env-inventory.ts`,
  `packages/server/src/lib/site-url.ts`, `scripts/load-test/config.ts`,
  `scripts/seed/qa.ts`, `knip.ts`.
- The acceptance grep must find no live references outside historical
  docs/plans; comments count as live.

---

## 15. Phase plan

| Phase                           | Scope                                                                                                                                                                                                                                                                                                               | Gate                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **0 — evidence**                | Port create/resume spike, key identity, baseline timings, `dev:*` inventory, this spec + ADR-0011. No product code.                                                                                                                                                                                                 | Evidence in the issue; ADR reviewed                                                  |
| **1 — read-only**               | `status` / `doctor` / `ports` / `supa`; stable `--json`; no lifecycle change. `scripts/dev` untouched.                                                                                                                                                                                                              | Read-only parity, unit tests                                                         |
| **2 — ensure**                  | `ensure --profile api\|web`, `down`, `build`; varlock-injected; **app-port lease only**; warm path; `--reconcile` capability restart. Keep `scripts/dev`.                                                                                                                                                           | issue §11 tests 3, 6, 7, 9; §13 test 13; shared-mode `ensure`/`status`/`ports`       |
| **3 — cutover**                 | Remaining profiles/commands (`mail`, `full`, `qa`, `e2e`, `admin`, `env:dev --admin`, `reset-db`, `logs`, `prepull`, `setup` scaffold, `verify`); seeder stack+run scoping (`qa/.tenants/<stackId>/<runId>`) and marker invalidation; delete `scripts/dev` + `dev:*`; docs sweep (`dev:admin` → `env:dev --admin`). | issue §11 tests 8 (destructive/`--all` refusals) and 10; full acceptance; `rg` clean |
| **4 — allocator (conditional)** | 20-port blocks, lease registry, reclaim, retry loop, separate app-port lease.                                                                                                                                                                                                                                       | issue §11 tests 1, 2, 4, 5                                                           |

Do not run phases in parallel: every phase touches `scripts/env/**`. Merge
order is 0 → 1 → 2 → 3 → (4). Each phase is its own PR; phase 4 is a **go** but
land after phase 3.

### 15.1 File layout (target)

```
scripts/env/
  cli.ts                 # arg parsing, command dispatch, exit codes
  commands/              # ensure, status, down, build, serve, recreate,
                         # doctor, ports, supa, dev, reset-db, logs,
                         # prepull, setup, verify
  lib/                   # registry, locks, stack (CLI wrapper), health,
                         # json, log, platform, fingerprint
  profiles.ts            # profile -> capability/exclude table (single source)
  atoms.ts               # flag parsing/validation
__tests__/unit/env/      # pure parts: profiles, atoms, json, fingerprint,
                         # lease math, command map
```

No provider code, no ref parsing, no dotenv parsing in `scripts/env/**`.

---

## 16. Out of scope

- **Caching** of stack artifacts, build output or provider values — #1078.
- **CI changes.** CI keeps calling `supabase stack` directly, with
  `SUPABASE_EXPERIMENTAL_STACK=1`, the native runtime and CLI-assigned ports.
- **Provider/vault implementation.** Phase 2 only defines and verifies the seam;
  the provider choice is a separate decision.
- **Removing the `varlock run` wrappers.** A post-stability migration, after
  #1077 **and** #1078, via a framework integration or `env`-owned injection.
- **`--attach` / cross-checkout stack reuse.**
- **Kubernetes, remote stacks, production.** Local only.
- **`next dev` for agents.** Agents never run `next dev` (matching
  `AGENTS.md`); `env:dev` (human-only) starts web/admin HMR with it, and agents
  use build + serve.
- **Per-agent stacks when a healthy stack exists.**
- **A 30 s cold full-app promise.** The lever is a build cache, not this tool.
- **Changing the pinned Supabase CLI** or the `[experimental] stack` backend.
- **Enabling the Supabase pooler.** `supabase/config.toml` sets
  `[db.pooler] enabled = false`, and removing `pooler` from `-x` does not enable
  it; `--pooler` is rejected (exit 2). A config change is tracked elsewhere.

---

## 17. Settled decisions and remaining implementation notes

**Settled in phase 0 (operator, 2026-11-08):**

1. **`db` profile = db + auth + storage.** Confirmed. Migrations need
   `storage.buckets` and the repo's seeds need `auth.users.email_confirmed_at`,
   so a database-only stack cannot be provisioned; cold start is p50 ~7.3 s /
   p95 ~8.0 s, inside the §12 budget. No `--no-migrate` / `--no-seed` skip path
   is added. See §3.
2. **`dev:admin` → `env:dev --admin`.** Confirmed. Admin HMR on :4000 lives in
   `env:dev --admin`, stays human-only, and `apps/admin` remains out of
   `env:ensure` defaults. See §14.1 and §14.2.

**Remaining implementation notes (not blockers — each is decided in the phase
that owns it):**

3. **pgmeta port (phase 4).** It has no config section and cannot be pinned.
   Accept one unpredictable internal port or reserve/probe a slot; decide in the
   phase-4 PR.
4. **`.env.vault` ignore rule (phase 2).** `.env.vault` is not in `.gitignore`
   today. Add it with `STUDIQ_ENV_VAULT` in the phase-2 PR.
5. **`SUPABASE_MAIL_PORT` inventory (phase 3).** It is a dead legacy name in
   CLI 3.0.0 and is still in `.env.schema`. Remove/repurpose it when the
   `SUPABASE_LOCAL_SMTP_*_PORT` trio is added.
6. **`qa`/`e2e` base URLs (phase 3).** The QA config defaults to
   `http://localhost:3010` and the e2e config to `:3000`; the profiles must
   either use those ports or the suites must read the app URL from `--json`.
   Decide in phase 3.
7. **Auth e-mail template workaround.** Stack projects cannot serve
   `content_path` (upstream `supabase/cli#7200`); the six branded-link specs
   skip under `STUDIQ_STACK_MODE=1`. This is unchanged by the env tool.

---

## Appendix A — Phase-0 evidence summary

Full commands and raw runs: the [phase-0 evidence
comment](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664).
Local `.dev/` logs are supplementary only (gitignored, not readable from other
checkouts).

- **Ports:** explicit `SUPABASE_API_PORT` / `SUPABASE_DB_PORT` /
  `SUPABASE_STUDIO_PORT` apply on create and resume. `SUPABASE_LOCAL_SMTP_PORT`
  / `_SMTP_PORT` / `_POP3_PORT` apply on create and resume. `SUPABASE_MAIL_PORT`
  is dead. Resuming without overrides re-rolls API/DB/Studio.
- **Keys:** `ANON_KEY` / `SERVICE_ROLE_KEY` are the fixed demo JWTs
  (`iss=supabase-demo`); `PUBLISHABLE_KEY` / `SECRET_KEY` and the S3 access keys
  are fixed constants shared by every stack. Only URLs differ. The tool still
  never prints/logs/stores them.
- **Runtime:** native available and used with Docker running; no fallback.
- **Baseline:** warm 885/936 ms (p50/p95), cold api 7250/7277 ms, cold db
  (db+auth+storage) 7347/7994 ms, cached web 2207/2388 ms (warm stack) and
  13416/13558 ms (cold stack), code-changed 10184/11780 ms (explicit rebuild)
  and 20274/21651 ms (cold stack + forced rebuild). All within the §12 budgets.
- **Corrections:** db-only cannot start (storage + auth required); the current
  build fingerprint lacks a tree hash; `scripts/dev` unsets stack port
  overrides; the native audit's "stable ports" claim only holds with overrides.

## Appendix B — References

- [ADR-0011: `env` CLI](../decisions/0011-env-cli.md)
- [ADR-0010: one root values file](../decisions/0010-env-ssot.md)
- [Native runtime audit](../audits/supabase-native-runtime.md)
- [Issue #1077](https://github.com/logyQT/studiq/issues/1077)
- [Issue #1078: caching](https://github.com/logyQT/studiq/issues/1078)
