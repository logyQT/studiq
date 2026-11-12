# ADR-0011: one `env` command for local environments

## Status

Proposed (2026-11-08), phase 0 complete. Supersedes ADR-0010's local-dev surface (it keeps the one-values-file decision) and the
`dev:*` scripts; phases 1–3 are unblocked. Spec: [`docs/plans/env-tool.md`](../plans/env-tool.md).

## Context

Local provisioning is spread across `scripts/dev` and the `dev:*` scripts: an agent must read several files to learn the
incantation, and nothing gives it one idempotent call that composes start, build and serve. Cold work (`--eager` capabilities,
migrations, seeds, `next build`) is paid once per checkout; the missing piece is a warm path (< 1 s) and a stable `--json`
contract.
The 2026-11-07/08 review settled the shape and made the port allocator conditional on a recorded spike. Phase 0 recorded a GO
(explicit ports survive create and resume); the 20-port allocator is nevertheless deferred by the operator's minimal-v1
decision and is not built. The tool leases only the app port and discovers stack ports from `status`.

## Decision

1. **Adopt `env` as the single local-environment command.** Surface: `ensure`, `status`, `down`, `build`, `serve`,
   `dev`, `supa`, `reset-db`, `logs`, `setup`, `verify`, `ports`, `doctor`; `ensure` is the blessed agent path and
   `status`/`ports`/`doctor` are read-only. `prepull` and `recreate` are deferred (spec §14).
2. **Delete `scripts/dev` and the `dev:*` wrappers that call it** (`dev:up`, `dev:serve`, `dev:status`, `dev:down`,
   `dev:reset-db`, `dev:build`, `dev:logs`, `dev:doctor`, `dev:ports`, `dev:prepull`) in the cutover; no aliases for
   them. The standalone human shortcuts `dev:web` (raw `next dev`) and `dev:admin` (`apps/admin` HMR) never called
   `scripts/dev` and stay; `env` has no admin equivalent.
3. **varlock is the only loader, injector and validator.** Value-consuming commands keep `varlock run --inject vars --`;
   `status`/`ports`/`doctor`/`setup`/`verify` run unwrapped. The CLI never parses a dotenv file; the wrappers stay for #1077 (removal is a
   post-stability migration after #1077 and #1078).
4. **Native is the default and the only auto-selected runtime.** Every start passes the selected runtime explicitly; Docker only
   via `--runtime docker` / `SUPABASE_RUNTIME=docker`, with no silent fallback. A runtime conversion is a manual operation
   (`bunx supabase stack destroy --stack <name>` or `--stack-id <id>`, after an ownership/`project_root` check, then
   `env:ensure --runtime …`); a first-class command is deferred.
5. **Identity is `projectRoot + branch + stackName`; one environment per checkout.** A second server, or rebuilding the `.next`
   another server serves for a different stack/profile, exits 6; `--attach` is future work.
6. **The app port is the only lease; stack ports are discovered.** A single per-checkout lock (`locks/checkout.lock`)
   serializes `ensure`, `down`, `serve` and every lease read/write for that checkout; the port itself is reserved
   atomically in shared registry state (`wx` claim file or a registry-wide lock held only for selection), so two
   checkouts cannot hand out the same one. The lease follows the stack lifetime (plain `down` keeps it because auth
   redirects bind `APP_URL`; `down --all` releases it under the same lock only after stopping the stack; `ensure`
   revalidates and re-claims it under the lock). The build lock stays separate and is never held while taking the
   checkout lock. The allocator is not built.
7. **`db` = database + auth + storage** — migrations need `storage.buckets`, seeds need `auth.users.email_confirmed_at`; no skip path.
8. **The vault seam is varlock's; `.env.vault` is opt-in.** `.env.local` is the only required values file; `.env.vault` is
   human-created in the primary checkout, Git-ignored, for LLM/Stripe refs only, resolved via `STUDIQ_ENV_VAULT`. `env:setup`
   mutates; `env:verify` observes.
9. **Shared mode is read-only for the shared stack.** `SUPABASE_SHARED=1` forbids start/stop/destroy/reseed; local build/serve and
   a local app-port lease are allowed; `down --all` and `reset-db` exit 6; `supa` forwards only read-only forms.
10. **Profile changes are not reconciled.** `env:down --all` then `env:ensure`; a capability superset satisfies a narrower
    profile. `apps/admin` HMR/serve is deferred (spec §14, §13).
11. **Caching is out of scope** (#1078, now settled by [ADR-0014](0014-local-build-cache-and-build-slots.md));
    CI keeps calling `supabase stack` directly; its build steps use `env build --no-slot` (ADR-0014, decision 6).
12. **Native platform matrix:** Linux x86_64/arm64 and macOS arm64 only; elsewhere exit 3 with the Docker opt-in; Windows is WSL2-only; CI stays Linux native.

## Evidence

Phase 0 (supabase@3.0.0, Bun 1.4.4, WSL2 Debian 12, x86_64, Docker running; raw runs: the [issue
comment](https://github.com/logyQT/studiq/issues/1077#issuecomment-6722102664)):

- pinned `SUPABASE_API_PORT`/`_DB_PORT`/`_STUDIO_PORT` and `SUPABASE_LOCAL_SMTP_*_PORT` are honored on create and resume; a resume
  without them re-rolls ports; `SUPABASE_MAIL_PORT` is dead; `pgmeta` is unpinnable;
- stack keys are fixed demo JWTs shared by every stack; only URLs differ (never printed);
- native runs with Docker running, no fallback;
- old-command baseline (`dev:up --prod` / `dev:status`): warm 885/936 ms p50/p95, cold api 7.3/7.3 s, cold
  db+auth+storage 7.3/8.0 s, cached web (warm stack) 2.2/2.4 s, code-changed (warm stack) 10.2/11.8 s, with
  cold-stack variants 13.4/13.6 s and 20.3/21.7 s — all inside the budgets; the `env:ensure` verdict is pending
  phase-2 measurement;
- db-only fails (42P01/42703); the build fingerprint has no tree hash, so a source edit is served stale.

## Consequences

- **One command, one contract.** Agents call `env:ensure --profile <name> --json`; unknown states are `null`.
- **No Docker on the happy path**; a stopped or running daemon cannot silently change the runtime.
- **Per-checkout isolation stays**, so parallel worktrees keep separate stacks and data.
- **Fewer moving parts.** Ownership, build lock, shared-mode refusal and `supa` passthrough are ported; env rendering, port math
  and duplicated health logic are deleted.
- **Secrets stay out of output.** Discovered keys go to children only; `--json` excludes them.
- **Risk:** the 1 s warm budget is tight on WSL2 (p95 936 ms); the cached capability record is load-bearing. **Cost:** a docs sweep in the cutover.

## Rollback

Revert the phase PR. Registry leases are runtime state outside the repo — remove only **this
checkout's** entries, never the shared registry directory; `ensure` revalidates and reclaims stale
entries under the checkout lock.

## References

- [Spec: `docs/plans/env-tool.md`](../plans/env-tool.md)
- [ADR-0010: one root values file](0010-env-ssot.md)
- [Native runtime audit](../audits/supabase-native-runtime.md)
- [Issue #1077](https://github.com/logyQT/studiq/issues/1077), [Issue #1078](https://github.com/logyQT/studiq/issues/1078)
