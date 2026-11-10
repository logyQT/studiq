# ADR-0010: one root values file for the environment

## Status

Accepted (2026-11-07). Part of the env-consolidation stack (`#1071` → `#1072` →
`#1073` → this change).

## Context

The repository had grown a fan-out of environment files:

- the operator hand-edited a root `.env`;
- the `env` tool **rendered** `apps/web/.env` (the app runtime, from
  `supabase status`) and `supabase/.env` (only `APP_URL`, so a plain
  `bunx supabase …` could parse `config.toml`);
- `apps/admin` carried its own `apps/admin/.env` and a committed
  `apps/admin/.env.example`;
- tests, seeders and the load-test harness each read one of those generated
  files, with different precedence rules.

That model was expensive: every new reader had to know which generated file to
read, the generated files could go stale after a branch switch (the failure mode
was seeding another checkout's database), and CI had to write an app-directory
file just to make the build inline `NEXT_PUBLIC_*`.

The stack that produced this ADR replaced the fan-out in three steps: an
inventory (`.env.schema`) plus the `varlock` validator/injector, a guard that
the inventory and the code agree, and finally this consolidation.

## Decision

1. **One values file.** Root `.env.local` is the only required hand-edited
   **values** file. It is Git-ignored, never committed and never required by a
   gate: every value is optional and derived defaults apply. `.env.vault`
   (ADR-0011 §11.1) is an **optional** vault pointer, not a second values file:
   a human creates it with `env:setup --vault` for provider refs that cannot
   come from the local stack (LLM/Stripe), and the environment runs without it.
2. **One inventory.** `.env.schema` names every key the repository reads (shape,
   ownership, sensitivity) and holds no values. `varlock` reads it to
   validate/inject env for the `bun run …` scripts.
3. **No per-app files.** The `env` tool no longer writes `apps/web/.env`,
   `apps/admin/.env` or `supabase/.env`. It reads `.env.local`, resolves this
   checkout's contract (`APP_PORT`, `APP_URL`, stack endpoints/keys from
   `supabase stack status --output-format json`) and **exports** the result to every
   Supabase/Next child process. The app build and `next start` therefore see the
   same environment the operator does.
4. **Direct CLI access is explicit.** `bun run env:supa <args…>` exports
   `APP_URL` (so `config.toml`'s `env(APP_URL)` resolves) and execs
   `bunx supabase "$@"`. No directory-level values file is needed.
5. **No Vault service, no proxy, no encryption.** The values file is plaintext
   and operator-owned. Optional `.env.vault` refs are resolved by varlock only
   when the file exists (no default provider, no auto-creation); nothing
   encrypts or decrypts the local values file.
6. **One environment per checkout.** Each checkout (worktree + branch) has one
   stack and one web server, on a port it leases in the shared registry. A
   second environment for a different stack or profile in the same checkout is
   refused (exit 6); parallel work spins another worktree instead. There is no
   multi-environment mode.
7. **`scripts/dev` is retired and deleted.** `scripts/dev` and the `dev:*`
   wrappers that called it were deleted in the phase-3 cutover; `env:*` is the
   only local lifecycle surface, with no aliases and no back-compat layer. The
   standalone human shortcuts `dev:web` (raw `next dev`) and `dev:admin`
   (`apps/admin` HMR) remain — `env` does not replace admin HMR. CI keeps calling
   `supabase stack` directly.
8. **CI uses the job environment.** Workflows export the local stack's values to
   `$GITHUB_ENV` instead of writing a root or app-directory `.env`. Vitest's
   `loadEnv()` and `varlock run --inject vars` both merge the process
   environment, so the build and the tests see the same keys.

## Consequences

- **`.env.schema` is documentation, not an access control list.** It says which
  keys exist and what shape they have; it does not grant or restrict access to a
  value and it never carries one. Adding a key is an inventory edit plus the code
  that reads it.
- **Operators supply values.** A fresh checkout needs no file at all. Stable
  parallel work (a fixed `APP_PORT`, a named `SUPABASE_STACK`, Stripe or LLM
  credentials) goes in `.env.local`.
- **Stack discovery is exported, not persisted.** A one-shot process that does
  not run through the `env` tool (the load-test harness, a seeder started from a
  plain shell) has no implicit target unless it is given one: set
  `SUPABASE_URL` in the environment or `.env.local`, or pass
  `--supabase-url`. The ownership checks still refuse an implicit target that is
  not loopback and stack-marked (`STUDIQ_STACK_MODE=1`, exported by the `env` tool
  in stack mode and never in shared mode).
- **CI writes env, not files.** A job that needs the local stack exports the keys
  to `$GITHUB_ENV`; a build is `bun run build` with those keys in the process
  environment.
- **Fewer stale-target bugs.** There is no generated file that can survive a
  branch switch and point a seeder at the previous stack. A mismatch now shows up
  as a missing key with a readable error instead of a silent write to another
  database.
- `apps/admin` reads the same `.env.local` through `varlock`; it has no
  app-specific env file.

## Rollback

Revert this change (or the whole stack, `#1071`–`#1073` plus this PR). The
per-app renderers (`render_web_env`, `render_supabase_env`) and the
`load_web_env_fallback` reader return with the legacy dev script (revert the
phase-3 cutover), and the generated files come back on the next start. No data migration is involved: the
values file was always operator-owned, and reverting only changes who reads it.
