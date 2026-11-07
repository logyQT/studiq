# Spike: Supabase CLI v3 native runtime (no Docker)

**Date:** 2026-11-04
**Branch:** `spike/supabase-native-runtime` (based on `origin/main` @ `9f54ecc2`)
**Code commits:** `23ab62db` (opt-in profile), `54a90eb4` (selection/teardown hardening), `1e96bf5e` (stack-mode skip for branded-template specs), `ce5757e1` (existing verify workflow switched 1:1 to native)
**Report commit:** see `git log --oneline -1 -- docs/audits/supabase-native-runtime.md`
**Status:** spike complete; **no PR, no merge, no CI default change**.

## Verdict

**Viable — the existing CI workflow runs on native and is green.** The pinned
CLI (`supabase@3.0.0` via `bunx supabase`) runs the whole StudiQ stack as native
host processes. The existing `verify.yml` was switched 1:1 to native: every job
(`checks`, `unit`, `integration`, all four `qa-suite` shards and both `e2e` legs)
passed on GitHub-hosted `ubuntu-24.04` in
[run 41907455831](https://github.com/logyQT/studiq/actions/runs/41907455831).

The one known gap is **custom auth e-mail templates**:

- Native sends e-mails normally (GoTrue + Mailpit/SMTP work).
- Stack projects reject `content_path` with
  `requires template serving, which is not supported by the experimental stack`
  — this affects both native and Docker stack runtimes.
- The six QA specs that assert branded `/auth/callback?token_hash=…` links
  (`AUT-01/02/06/12/13`, `ONB-08`) are therefore skipped via
  `STUDIQ_STACK_MODE=1`; the rest of the suite runs. This is tracked upstream as
  open issue [supabase/cli#7200](https://github.com/supabase/cli/issues/7200)
  (no maintainer ETA).

**Recommendation: adopt native for CI; keep the non-stack Docker path for the
six template-dependent specs until #7200 is fixed.**

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

**The existing workflow runs 1:1 on native.** `verify.yml` now sets
`SUPABASE_EXPERIMENTAL_STACK=1` and `SUPABASE_RUNTIME=native`, starts every Supabase
instance with `bunx supabase stack start --runtime native --eager`, reads
endpoints from `stack status --output-format json` (`.env.*`), and stops with
`bunx supabase stop`. No fixed ports, no Docker, no `--no-backup`.

Final run: <https://github.com/logyQT/studiq/actions/runs/41907455831> —
**success**, all jobs green.

| Job                              | Duration |
| -------------------------------- | -------- |
| `checks`                         | 18 s     |
| `scope`                          | 7 s      |
| `unit`                           | 50 s     |
| `integration`                    | 96 s     |
| `qa-suite (stu)`                 | 268 s    |
| `qa-suite (edu)`                 | 275 s    |
| `qa-suite (mgr-sec-bil)`         | 293 s    |
| `qa-suite (aut-nfr-onb-pub-lim)` | 295 s    |
| `e2e (chromium)`                 | 269 s    |
| `e2e (firefox)`                  | 307 s    |

Native stack start per job: **13–18 s** (observed). This replaces the previous
1–2 minute container pull/start. Integration still passed **56 files / 568
tests**.

### The one gap: custom auth e-mail templates

Native e-mail delivery works, but stack mode has no template-serving endpoint.
`content_path` is refused at start (both native and Docker stack runtimes):

```
auth.email.template.recovery.content_path requires template serving,
which is not supported by the experimental stack
```

The legacy non-stack backend serves the HTML through Kong on `:8088`; that
sidecar does not exist in the stack backend. `content = """..."""` is also
rejected. Upstream: [supabase/cli#7200](https://github.com/supabase/cli/issues/7200)
(open, no ETA).

Therefore the six branded-link specs (`AUT-01/02/06/12/13`, `ONB-08`) skip when
`STUDIQ_STACK_MODE=1`; every other QA spec runs natively. Keep a non-stack
Docker leg for those six until the upstream issue lands.

### Native artifact cache: measured, not worth it

We tried caching `~/.supabase/cache/stack` (520 MB lean set) and measured both
paths on the same workflow:

| Path                           | Restore step | Start Supabase | Total        |
| ------------------------------ | ------------ | -------------- | ------------ |
| Cache miss (run `41911016046`) | 0–1 s        | 13–20 s        | **13–20 s**  |
| Cache hit (run `41909438297`)  | ~11 s        | 9–16 s         | **~20–27 s** |

The cache save/restore costs more wall-clock than the download it replaces
(GitHub-hosted runners download the lean artifacts quickly). It is an egress /
availability optimisation, not a speed one. **The native artifact cache was
removed**; `verify.yml` starts native without a cache step.

### Chromium's 5-minute install

The slow `Install Chromium` step in one QA shard was **apt**, not Playwright:
the log shows `Installing dependencies...` and five minutes of `fonts-*` /
`xfonts-*` packages. The browser cache itself was hit; the other QA shards and
both e2e legs installed in 10–61 s. This is runner apt variance, not native.

### Cache ownership and refresh

- **Only `main` writes caches.** Feature branches only restore. The Playwright
  and bun save steps already had `github.ref == 'refs/heads/main'`; the native
  save was removed entirely.
- A new `cache-warm.yml` runs on `push` to `main` (and manual dispatch) and only
  refreshes the bun and Playwright browser caches (`chromium-shell`,
  `chromium`, `firefox`) using the exact keys `verify.yml` restores. It runs no
  tests, so a merge does not duplicate the PR gate.
- `cache-hit != 'true'` guards every save, so an unchanged lockfile is a no-op.

## Files changed

| File                                     | Change                                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`                           | documents `SUPABASE_RUNTIME`, `SUPABASE_HOME`, `SUPABASE_NATIVE_POSTGRES_USER`, destroy caveat                                                                                                                                                                  |
| `scripts/dev`                            | runtime selection/preflight, `--runtime` forwarding, native-aware doctor/status, `prepull` uses effective runtime, teardown no longer gated on Docker, robust stop-failure check, `SUPABASE_HOME` validation, config-drift warning, `db reset` sslmode/port fix |
| `.github/workflows/verify.yml`           | existing workflow switched 1:1 to native: stack mode, native start, stack status `.env.*`, no fixed ports, `stop` without `--no-backup`                                                                                                                         |
| `.github/workflows/cache-warm.yml`       | main-only cache refresh (bun + Playwright browsers); no tests                                                                                                                                                                                                   |
| `qa/fixtures/stack-mode.ts`              | temporary `STUDIQ_STACK_MODE=1` skip helper for branded-template specs                                                                                                                                                                                          |
| `__tests__/qa/AUT/AUT-01,02,06,12,13`    | temporary skip clause in stack mode                                                                                                                                                                                                                             |
| `__tests__/qa/ONB/ONB-08.spec.ts`        | temporary skip clause in stack mode                                                                                                                                                                                                                             |
| `docs/audits/supabase-native-runtime.md` | this report                                                                                                                                                                                                                                                     |

No changes to `supabase/config.toml`, production config, Stripe, authz, or app
code. CI now runs native; the six branded-template specs are the only exclusion.

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

Test/CI review findings:

- Native is stack-backend-only; the 1:1 workflow now enables stack mode and runs
  every job on native. This is proven by run `41907455831`.
- Branded auth templates are impossible in stack mode (open
  [supabase/cli#7200](https://github.com/supabase/cli/issues/7200)). The six
  specs are skipped via `STUDIQ_STACK_MODE=1`; all other QA specs run.
- Full QA, integration and both e2e browsers passed natively. Playwright browser
  caching is refreshed by the main-only `cache-warm` workflow.

## Recommendation

**Adopt native for CI; keep a non-stack Docker fallback for the six
branded-template specs until #7200 is fixed.** The 1:1 workflow is green on
GitHub-hosted `ubuntu-24.04`, with native stack starts at 13–18 s. The only
functional gap is custom auth templates; everything else (integration, e2e
Chromium/Firefox, QA shards) passed.

### What I would do next (requires operator approval)

1. Keep the six branded-template specs on a non-stack Docker leg until #7200
   lands, or re-enable them once a CLI with template serving is pinned.
2. Update `AGENTS.md`/onboarding docs to describe native CI and the
   template-mode exception.
3. Separately fix `docs/database.md`'s named-stack `db push` guidance
   (`sslmode=disable` + unset DB port vars).

Do not open a PR or merge without operator approval.
