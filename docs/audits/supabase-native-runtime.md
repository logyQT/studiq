# Spike: Supabase CLI v3 native runtime (no Docker)

**Date:** 2026-11-04
**Branch:** `spike/supabase-native-runtime` (based on `origin/main` @ `9f54ecc2`)
**Code commits:** `23ab62db` (opt-in profile), `54a90eb4` (selection/teardown hardening), `5dec3047` + `edb1821d` (opt-in CI smoke job), `5d719658` (e2e/QA gap verification)
**Report commit:** see `git log --oneline -1 -- docs/audits/supabase-native-runtime.md`
**Status:** spike complete; **no PR, no merge, no CI default change**.

## Verdict

**Viable with gaps.** The pinned CLI (`supabase@3.0.0` via `bunx supabase`) can run
the whole local StudiQ stack as native host processes: Postgres, REST, Auth,
Storage, Realtime, Edge Functions, Studio, pgmeta, Mailpit and Analytics all
started and reported healthy. Migrations, seeds, app login, authenticated API
calls, storage upload/download, Mailpit delivery, `db reset`, stop/start
persistence and two parallel named stacks all worked.

It is **not a drop-in replacement for the current CI gate yet**:

- Native is only reachable through the experimental `supabase stack` backend;
  `verify.yml` is deliberately non-stack (`SUPABASE_EXPERIMENTAL_STACK=0`) and
  uses fixed ports, legacy `status` JSON, legacy `-x` container names and
  `stop --no-backup`.
- The six QA specs that assert branded `/auth/callback?token_hash=…` links
  (`AUT-01/02/06/12/13`, `ONB-08`) still cannot run on a stack project. This is
  the existing `content_path` workaround, not a native-runtime defect; the same
  limitation applies to Docker stack mode.
- Native processes share the host process table, ports and file locks. Two
  stacks worked, but Docker remains the better isolation model for many local
  projects.

**Recommendation: pilot in CI; keep Docker as the default.** Do not adopt native
as the production/local default from this spike.

A temporary opt-in native CI job was dispatched manually on GitHub-hosted
`ubuntu-24.04`: integration passed (**56 files / 568 tests**) in a **1 m 44 s**
job; a second run passed an e2e login spec and QA `PUB-01` and reproduced the
branded-template `AUT-01` gap. See
[CI implications](#ci-implications-for-github-hosted-ubuntu-2404).

## Exact native command / config

No `supabase/config.toml` change is required. The existing
`[experimental] stack = true` is what enables the runtime choice.

```dotenv
# root .env
SUPABASE_RUNTIME=native
# optional: a second stack in the same checkout
# SUPABASE_STACK=native
# optional: native state outside the checkout
# SUPABASE_HOME=/var/tmp/studiq-supabase
```

```bash
bun dev:up --prod          # or `bun dev:up` for next dev (agents use --prod)
bun dev:status --json
bun dev:reset-db
bun dev:down --all
bun dev:prepull
```

Underlying CLI calls (what the wrapper runs):

```bash
# create/resume
bunx supabase stack start --runtime native --eager \
  -x realtime,functions,analytics,pooler --stack "$SUPABASE_STACK"

# discover endpoints/keys (JSON, not flat legacy status)
bunx supabase stack status --stack "$SUPABASE_STACK" --output-format json

# reset a named stack (spike adds sslmode=disable + unsets DB port vars)
bunx supabase db reset --remote="$DB_URL?sslmode=disable" --yes

# pre-download artifacts (CI-friendly; lock is committed)
bunx supabase stack install --runtime native --frozen

# stop (data kept)
bunx supabase stop --stack "$SUPABASE_STACK"
```

Runtime is persisted when the stack is created. Switching an existing stack
requires destroying it first (data deleted):

```bash
bunx supabase stack destroy --stack "$SUPABASE_STACK" --yes
```

The wrapper keeps **blank** `SUPABASE_RUNTIME` = Docker (the pre-spike default).
`auto` explicitly opts into the CLI's Docker → Podman → native probe. An existing
stack always reuses its persisted runtime, even when it is stopped.

## Supported services vs missing

Tested with `--eager` on three stacks (lean, full-ish, all capabilities):

| Capability                | Native result | Notes                                                   |
| ------------------------- | ------------- | ------------------------------------------------------- |
| database (Postgres 17.11) | healthy       | native data in `~/.supabase/stacks/<id>/data`           |
| rest (PostgREST 16.5)     | healthy       | shares the gateway HTTP port                            |
| auth (GoTrue 2.197)       | healthy       | login/recovery work                                     |
| storage (1.88)            | healthy       | upload/download/public URL work                         |
| realtime (2.151.3)        | healthy       | `realtime.rpc` gets its own TCP port                    |
| functions (1.77.9)        | healthy       | inspector port assigned                                 |
| studio                    | healthy       | separate HTTP port                                      |
| pgmeta                    | healthy       | separate HTTP port                                      |
| mail (Mailpit 1.31.3)     | healthy       | HTTP UI + SMTP + POP3 ports                             |
| analytics (1.50.15)       | healthy       | separate HTTP port                                      |
| pooler                    | not started   | `[db.pooler] enabled = false` in `config.toml`          |
| imgproxy                  | artifact only | downloaded by `stack install`, not a composition member |

There is no missing service in the app's lean profile. The real gap is
**config/auth-template support in stack mode** (both Docker and native), not the
native runtime itself.

## Manual verification results

All checks were run in the disposable worktree with no other checkout's stack
started or reset. `spike-native` was the working stack; `spike-native-2`,
`spike-native-full` and `spike-native-all` were temporary and destroyed.

| #   | Check                           | Result                                                                                                                                                                                                                          |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Start from clean state          | ✅ `bun dev:up --prod` created a new native stack; all migrations applied, seeds loaded, app booted                                                                                                                             |
| 2   | Migrations apply                | ✅ full migration chain applied during first start and `db reset`                                                                                                                                                               |
| 3   | Seed loads                      | ✅ 10 seeded profiles, 5 seed files, storage placeholder uploaded                                                                                                                                                               |
| 4   | `status --env` / JSON parseable | ✅ `stack status --output-format json` and `--env` both parse as JSON (14 env keys)                                                                                                                                             |
| 5   | App boots                       | ✅ production build + `next start` on `:3456`                                                                                                                                                                                   |
| 6   | Login with seeded user          | ✅ `teacher1@dev.local` / `pass` → HTTP 200                                                                                                                                                                                     |
| 7   | Authenticated API call          | ✅ `GET /api/v1/permissions/me` → HTTP 200, 24 permissions                                                                                                                                                                      |
| 8   | Invitation/e-mail flow          | ✅ Mailpit received a GoTrue recovery e-mail (`StudiQ - Password Reset`); SMTP works. The app's own invite e-mail still depends on `MAIL_DRIVER` (default `none`, copyable link)                                                |
| 9   | Storage upload/download         | ✅ PNG upload 200, download bytes match, public URL 200, delete 200                                                                                                                                                             |
| 10  | QA/e2e spec                     | ✅ locally `PUB-01` 2/2; on CI native, e2e `login.spec.ts` and QA `PUB-01` passed. ❌ `AUT-01` failed waiting for the branded `/auth/callback?token_hash=` link (known stack template workaround, not native; reproduced on CI) |
| 11  | `db reset` / reseed             | ✅ `bun dev:reset-db` in ~3 s; migrations + seeds reapplied                                                                                                                                                                     |
| 12  | Stop → start, data persists     | ✅ marker `profiles.full_name` survived; same ports and stack id                                                                                                                                                                |
| 13  | Two named stacks in parallel    | ✅ `spike-native` (API 21127, DB 32430) and `spike-native-2` (API 28500, DB 25948) healthy simultaneously; marker existed only in stack 1                                                                                       |
| 14  | Cleanup leaves no orphans       | ✅ `bun dev:down --all` → 0 processes for the stack id, 0 listening ports                                                                                                                                                       |

### Timings (this host: WSL2, Debian 12, glibc 2.36, amd64, 20 GB RAM, Docker available)

| Measurement                                                              | Time       |
| ------------------------------------------------------------------------ | ---------- |
| First-ever native start (downloads 1.3 GB archives + migrations + seeds) | **46 s**   |
| New stack, warm artifact cache, stack only                               | **10 s**   |
| Full-ish stack (realtime + functions enabled)                            | **13 s**   |
| All enabled capabilities (incl. analytics)                               | **26 s**   |
| Warm restart, stack only                                                 | **5 s**    |
| Warm `bun dev:up --prod` (build check + web)                             | **7–11 s** |
| Clean `bun dev:up --prod` with warm cache                                | **14 s**   |
| `bun dev:reset-db`                                                       | **3 s**    |
| `stack install --runtime native --frozen` with warm cache                | **6 s**    |

### Memory and disk

- **Idle native stack:** ~**742 MiB** summed RSS across 24 processes. This is an
  upper bound (shared pages are counted per process), not a cgroup measurement.
- **Artifact cache:** `~/.supabase/cache/stack` = **1.9 GB** after
  `stack install` (1.3 GB after the first start; imgproxy/pooler add the rest).
  Shared by every stack on the machine and **survives `stack destroy`**.
- **Stack data:** `~/.supabase/stacks/<id>` = **74–123 MB** for this schema +
  seeds + storage placeholder.
- **Ports:** CLI-assigned from 20000–32767, stable across restarts, unique per
  named stack. One gateway HTTP port multiplexes REST/Auth/Storage/Functions/
  Realtime; DB, Studio, Mailpit HTTP and Mailpit SMTP/POP3 get separate ports.

## Docker vs native differences that matter

|                               | Docker stack                                          | Native stack                                                                                      |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Runtime                       | container per service                                 | host process per service                                                                          |
| Isolation                     | network namespace + filesystem per project            | shared process table, ports and file locks                                                        |
| Data                          | Docker volume (Docker ≥26) or host dir                | `~/.supabase/stacks/<id>/`                                                                        |
| Artifacts                     | image cache                                           | `~/.supabase/cache/stack` (verified archives)                                                     |
| Requirements                  | Docker/Podman engine                                  | Linux amd64/arm64 glibc ≥2.35 or macOS arm64, `tar`, non-root, network on first start             |
| Startup                       | image-dependent                                       | faster once artifacts are cached                                                                  |
| Multi-project                 | strong isolation                                      | works, but not recommended for many projects on one host                                          |
| Auth `content_path` templates | unsupported in stack mode                             | unsupported in stack mode (same limitation)                                                       |
| `db reset --remote`           | local Postgres is plaintext; needs `sslmode=disable`  | same; additionally `SUPABASE_DB_PORT` must be unset or the CLI treats it as a local-stack request |
| Cleanup                       | `stack stop` keeps volume; `stack destroy` deletes it | same; destroy leaves an 8 KB empty dir and keeps the artifact cache                               |

## CI implications for GitHub-hosted `ubuntu-24.04`

**Proven on GitHub.** A temporary, opt-in job (`supabase-native-spike`) was
added to `verify.yml` and dispatched manually on `ubuntu-24.04`. It does not run
on PRs or the nightly schedule (`if: workflow_dispatch && inputs.native_smoke`).

**Run A — integration only**
<https://github.com/logyQT/studiq/actions/runs/41891292562> — **success**,
native job **1 m 44 s**.

- Native stack start (artifacts restored from cache): **13 s**.
- Integration suite: **56 files / 568 tests passed in 68 s**.
- Artifact cache restore: **7 s**; cache save is skipped on a cache hit.

**Run B — e2e + QA gap verification**
<https://github.com/logyQT/studiq/actions/runs/41894507284> — **success**,
native job **13 m 53 s**.

- Build app: **18 s**; `next start` ready: **8 s**.
- E2E `__tests__/e2e/login.spec.ts` (Chromium): **passed** in 7 s.
- QA `PUB-01` against native: **passed** in 2 s.
- QA `AUT-01`: **failed as expected** after 3 retries (187 s) with
  `no e-mail matching /https?:\/\/...\/auth\/callback\?..../` — the branded
  `/auth/callback?token_hash=` template gap is confirmed, not a runner failure.
- Chromium install: **506 s** on a cache miss; this dominates the job and is
  cacheable (`~/.cache/ms-playwright`).

`ubuntu-24.04` is amd64/glibc 2.39, `tar` present, non-root `runner`, egress to
GitHub/S3 available. Docker is also reachable, so `--runtime native` must be
explicit (the job sets it).

The first dispatch failed in the env-writing step: `stack status --env` emitted
more than one line and `jq` parsed it as invalid JSON. The fix was to use
`stack status --output-format json` and read `.env.API_URL`, `.env.DB_URL`, etc.
This is the CI caveat in practice — do not use `--env` output as JSON.

What a pilot still needs:

1. Keep the fixed `SUPABASE_*_PORT` contract out of the native job (the spike
   unsets it in a small wrapper) and opt into `SUPABASE_EXPERIMENTAL_STACK=1`.
2. Translate `-x` container names to capability names:
   `-x studio,functions,analytics,pooler,realtime` (keep `storage` and `mail`
   for QA/e2e).
3. Use `supabase stop` (no `--no-backup`; that flag is not a stack flag).
4. Cache `~/.supabase/cache/stack` keyed on
   `hashFiles('supabase/supabase.lock')` and run
   `bunx supabase stack install --frozen --runtime native`. Do **not** cache
   `~/.supabase/stacks` (live DB). The lock pins per-platform SHA-256 archive
   and manifest digests; verify them on cache hits because native artifacts
   execute directly.
5. Export `NEXT_PUBLIC_SUPABASE_URL`, anon/service keys, `SUPABASE_DB_URL`,
   `MAILPIT_URL` and `NEXT_PUBLIC_SITE_URL` to both the job environment and
   `apps/web/.env`; do not rely on the QA fixtures' fixed-port fallbacks.
6. Cache Playwright browsers; without that cache the Chromium install alone is
   ~8 minutes. The full QA suite was not run natively (only `PUB-01` plus the
   expected `AUT-01` failure); scale is the remaining unproven part.
7. Exclude or Docker-run the six template-dependent QA specs (`AUT-01/02/06/12/13`,
   `ONB-08`) until stack mode can serve `content_path`.

CI cost estimate: ~1.9 GB artifact cache (lean extracted set is ~637 MB), 74–123
MB stack data, ~0.7 GiB idle RSS, plus Playwright browsers. That fits a standard
4-vCPU/16 GB runner, but adds roughly 1 GB to the 10 GB Actions cache budget.

## Files changed

| File                                     | Change                                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`                           | documents `SUPABASE_RUNTIME`, `SUPABASE_HOME`, `SUPABASE_NATIVE_POSTGRES_USER`, destroy caveat                                                                                                                                                                  |
| `scripts/dev`                            | runtime selection/preflight, `--runtime` forwarding, native-aware doctor/status, `prepull` uses effective runtime, teardown no longer gated on Docker, robust stop-failure check, `SUPABASE_HOME` validation, config-drift warning, `db reset` sslmode/port fix |
| `.github/workflows/verify.yml`           | opt-in `workflow_dispatch` input + `supabase-native-spike` job; never runs on PRs or the schedule, does not replace the Docker gate                                                                                                                             |
| `docs/audits/supabase-native-runtime.md` | this report                                                                                                                                                                                                                                                     |

No changes to `supabase/config.toml`, production config, Stripe, authz, or app
code. The CI change is an opt-in spike job only; existing jobs and defaults are
unchanged.

## Review findings

Three fresh-context subagents reviewed correctness/portability, test/CI impact,
and security/ops. Findings that were valid were fixed in `54a90eb4`; the rest are
recorded as known limitations.

| Severity | Finding                                                                  | Resolution                                                                                                                     |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| major    | Blank/auto silently created a native stack when Docker was unreachable   | Fixed: blank = Docker (pre-spike default); only explicit `auto` probes; existing stacks reuse persisted runtime                |
| major    | Teardown was gated on a working runtime and swallowed stop failures      | Fixed: `dev:down --all` no longer preflights Docker/native; a failed stop checks `lifecycle: running` and fails loudly         |
| minor    | Explicit runtime could disagree with a persisted stack                   | Fixed: early failure with `stack destroy` guidance when the stack is running; stopped stacks still rely on the CLI's own error |
| minor    | `dev:prepull` ignored the persisted runtime                              | Fixed: uses `effective_supabase_runtime`                                                                                       |
| minor    | No root preflight for native Postgres                                    | Fixed: warning + `SUPABASE_NATIVE_POSTGRES_USER` guidance                                                                      |
| minor    | `SUPABASE_HOME` could point inside the checkout                          | Fixed: must be absolute and outside `REPO_ROOT`; filtered from app env                                                         |
| minor    | `config_drift` (site URL captured at stack creation) was invisible       | Fixed: `dev:up` warns when `config_drift.status=changed`                                                                       |
| minor    | Native support hint did not check glibc                                  | Known: CLI is authoritative; error text now names glibc ≥2.35                                                                  |
| minor    | `dev:status` omits runtime when the stack is stopped                     | Known cosmetic; `stack list` still knows it                                                                                    |
| minor    | `supabase stop` on an already-stopped stack reports "Stopped"            | Known cosmetic; exit code is 0 and nothing is running                                                                          |
| minor    | `docs/database.md` named-stack `db push` snippet lacks `sslmode=disable` | Known doc gap; the spike's reset path fixes it, `db push` docs were left unchanged                                             |
| minor    | `stack install` downloads every locked service even when excluded        | Known; CI cache should account for it                                                                                          |
| nit      | `SUPABASE_RUNTIME` leaked into shared-mode `apps/web/.env`               | Fixed: runtime/state keys are filtered in both modes                                                                           |
| nit      | `scripts/dev` top comment still said "images"                            | Fixed                                                                                                                          |

Test/CI review findings that are **not** code changes:

- Native is stack-backend-only; CI is legacy non-stack. A pilot needs the changes
  listed above.
- Branded auth templates are impossible in stack mode, so `AUT-01/02/06/12/13`
  and `ONB-08` need Docker or a skip list.
- The full QA suite was not run natively; only `PUB-01` was executed. Integration
  and e2e have no known native blockers, but this is unproven at suite scale.
- `qa/AGENT-PROMPT.md`/`README.md` still describe a `supabase_db_qa-env-*`
  Docker container for manual QA; that has no native equivalent.

## Recommendation

**Pilot in CI; keep Docker as the default.** Integration (568 tests), an e2e
login spec and QA `PUB-01` are now proven on a GitHub-hosted `ubuntu-24.04`
runner. The remaining gaps are full QA-suite scale, the six template-dependent
QA specs, weaker multi-project isolation, and the ~8-minute Chromium install
without a browser cache. Those make a full switch premature.

### What I would do next (requires operator approval)

1. Run the **full QA suite** (all shards, minus the six template specs) on the
   opt-in native job, and cache Playwright browsers; keep Docker as the
   required gate.
2. Fix or explicitly skip the branded-template specs in native/stack mode
   (`AUT-01/02/06/12/13`, `ONB-08`); update `AGENTS.md` if the list grows.
3. If the pilot is stable for two weeks, consider native for integration/e2e
   only; keep Docker for QA until the template issue is resolved.
4. Separately fix `docs/database.md`'s named-stack `db push` guidance
   (`sslmode=disable` + unset DB port vars), and decide whether
   `scripts/dev` should warn when `SUPABASE_HOME` is unset on a host with no
   Docker.

Do not turn this spike into an implementation, change CI defaults, or open a PR
without operator approval.
