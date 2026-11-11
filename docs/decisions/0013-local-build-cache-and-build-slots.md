# ADR-0013: Seed the Turbopack cache root into worktrees, and cap concurrent builds

## Status

Proposed (2026-11-11). Measurements recorded below are from this repo at
`ea790b3e` (main) and `521792db` (PR #1083) on a 16 vCPU / 19.9 GB RAM / 5 GB
swap container (overlay + ext4, no reflink), Next 16.4.4 (Turbopack), Bun 1.4.4.

This ADR settles the two questions [#1078](https://github.com/logyQT/studiq/issues/1078)
left open — whether a local `main` build-cache snapshot is worth seeding, and how
many concurrent `next build`s the box can take — and supersedes
[ADR-0011](0011-env-cli.md) §11's "Caching is out of scope" clause and its
"CI is untouched" sentence only. In this record, _snapshot_ means the build-cache
snapshot; the `scripts/env` status snapshot is a different object.

## Context

Agent work is bursty: most of the time is spent thinking and editing, and a build
happens when an agent wants to verify a change. Two costs follow:

1. Every fresh worktree starts with an empty `.next/cache`, so the first build
   recompiles the whole app even though `main` was compiled minutes earlier on
   the same machine.
2. Several agents can verify at the same time. `env build` already takes a
   cross-worktree, exclusive lock (`withBuildLock` → `<registry>/build.lock`,
   1800 s wait) in `scripts/env/lib/locks.ts`, but the lock is per _entrypoint_:
   it serializes `env build` and nothing else. A raw `next build` never takes it,
   and `bun run build` reaches `next build` through Bun's `prebuild` hook — which
   is where decision 6 attaches enforcement. Sixteen raw builds at once is enough
   to exhaust RAM and swap and take the agent server down with it.

The build fingerprint (`scripts/env/lib/fingerprint.ts`) keys a build by tree
content + inlined `NEXT_PUBLIC_*` + build mode, so it decides whether **this**
worktree's build must re-run. It says nothing about what a build that reuses a
foreign cache emits, and it covers neither build-time HTTP responses nor
typecheck state. This ADR is about _input_ caching, never serving a stale `.next`
output: the seed therefore copies an allowlist (decision 3), and whether a seeded
build emits the same bytes as a cold one is an experiment in Evidence, not an
assumption.

## Decision

1. **Seed the allowlisted Turbopack cache root only, never the `.next` output.**
   A worktree created by `spin` (or any worktree with no `.next/cache`) may copy
   the `turbopack/` root of the local `main` snapshot into `.next/cache`
   (decision 3). The built output, `BUILD_ID` and the fingerprint stay
   per-worktree; the fingerprint is authoritative for whether **this** worktree's
   build is current, not for what a build that reuses a foreign cache emits, and
   it covers neither build-time HTTP responses nor typecheck state. That is why
   decision 3 seeds by allowlist instead of copying a directory.
2. **One locally produced snapshot per cache root, valid for one match key,
   published only from a clean `origin/main` build of the primary checkout.** A
   snapshot is a staging copy of the allowlisted cache directories taken as the
   last step inside the locked build, while the cache is quiescent — never a read
   of `.next/cache` at some later time, when `next dev` or another build may have
   changed it. Publishing requires all of:

   - the **primary checkout** (the git dir is the common dir — not a linked
     worktree), attached to a branch, `HEAD` equal to the last fetched
     `origin/main`;
   - a **clean tree** (`git status --porcelain` empty, untracked included); a
     build in a dirty tree never publishes, though existing snapshots still seed
     worktrees;
   - a **successful build** (exit 0) whose `.next/BUILD_ID` exists — written by
     this run, or, when the fingerprint is already current, the artifact that
     build declared current — and no `env serve`/`next dev` running for this
     checkout at staging time, judged from the checkout's recorded web pid (a
     stale pid counts as not running);
   - a complete manifest (decision 3). Anything else: no snapshot, and
     `env build` says which gate failed.

   Refresh is opportunistic on **every** producer-eligible `env build`,
   including a no-op build that finds the fingerprint current — that build
   re-snapshots the existing cache, so an idle `main` still refreshes. There is
   no separate `env cache snapshot` command: a second entrypoint would need its
   own guard and docs, and the no-op build already covers it. Commit distance is
   a **publish-time** warning in `env build`, where git is available, and is
   recorded in the manifest as `behindCommits`; decision 8 shows that recorded
   value labelled "at publish", and status never invokes git. The 7-day age and
   100-commit distance are target thresholds, not measurements. Neither refuses a
   snapshot or a seed: a snapshot 20 commits behind still measured a 52 % saving
   (Evidence §2).

   **Publishing** — manifest, verification, pointer swap and retention — runs
   after the build is done and under a separate `snapshot.lock` (decision 3,
   locks). The checkout lock and the build lock are both released before
   `snapshot.lock` is taken; the snapshot step holds neither. Snapshot work is
   best-effort: a failed or interrupted publish leaves the previous snapshot in
   place and never fails the build.

   **Storage and swap.** Snapshots are immutable directories
   `<cacheRoot>/snapshots/<id>/`, where `<id>` is a UTC timestamp plus a short
   hash of the match key. `snapshots/current` is a pointer file holding the id,
   replaced atomically (write-then-rename). A seed reads the pointer once and
   copies from that id; a pointer change mid-copy cannot affect it, and the
   retired id is not deleted while a copy that started before the swap can still
   be walking it. Retention is **`current` plus one retired predecessor**: the
   previous id is deleted by a _later_ snapshot write once it has been retired for
   longer than a 10-minute grace period (a target, not a measurement), and no
   read lock is taken on the seed path (a burst of concurrent seeds must not
   serialize).
   The cache root therefore holds at most two published snapshots — `current`
   and the retired predecessor — plus the staging copy of a write in progress: a
   worst case of three snapshot-sized trees, each bounded by decision 4's cap.

   **Location.** `$STUDIQ_CACHE_DIR` = `${XDG_CACHE_HOME:-$HOME/.cache}/studiq`.
   The value is user-overridable from `.env.local`, so the constraint is enforced
   rather than documented. The cache root is validated by the registry's trust
   guard — its leaf path is not a symlink, it is owned by the caller and it is
   mode 700 — **plus** a repository-containment check: not inside, or an ancestor
   of, the repo. Every snapshot and staging path under it inherits that validation
   before any write or delete. The seed destination is different: it is inside
   this worktree by construction, so it is validated as inside this worktree's
   `.next` instead. A refused cache path fails an explicit cache operation with a
   non-zero exit and nothing written or deleted; an implicit seed skips and the
   build runs cold. No CI artifact, no upload/download, no signing surface.

3. **Seed rules: exact identity, an allowlist, a verified atomic landing.** A
   snapshot publishes a manifest; the seed copies from it only when every match
   component below is identical. Any mismatch skips the seed and the build runs
   cold — never partially match, never match on a version prefix.

   | Component       | Source                                            | Role   |
   | --------------- | ------------------------------------------------- | ------ |
   | turbopack dir   | full dir name(s) under `turbopack/` that the      | match  |
   |                 | installed Next writes (`v16.4.4-b175f52b`), never |        |
   |                 | just the version prefix                           |        |
   | `next`          | resolved version, not the manifest range          | match  |
   | `bun`           | the runtime that ran the build                    | match  |
   | `node`          | the runtime that ran the build, if Node           | match  |
   | `typescript`    | resolved from `bun.lock` (range is `^7.0.2`)      | match  |
   | `bun.lock`      | sha256 of the root lockfile                       | match  |
   | mode            | `production` only; no other mode publishes        | match  |
   | seed scope      | the allowlisted cache directories copied          | match  |
   | inlined env     | `buildEnvHash` over the three inlined values      | match  |
   |                 | (named below) — hash, no values                   |        |
   | `commit`,       | `HEAD` and tree state at publish time (dirty must | record |
   | `dirty`         | be false to publish)                              |        |
   | `behindCommits` | commit distance from `origin/main` at publish     | record |
   | size, files     | measured on the staging copy                      | verify |
   | `complete`      | written last inside the staging directory         | verify |
   | `createdAt`     | publish time                                      | record |

   The Turbopack row is resolved, not guessed: the snapshot's full directory
   name is compared with the name the installed Next resolves for its Turbopack
   cache. If that name cannot be resolved without running a build, the seed is
   skipped — never guessed.

   The asymmetry is deliberate: a component that does not affect the cache costs
   one cold build when it changes; a component that does affect it and is
   missing costs correctness. `commit` is recorded rather than matched because a
   snapshot 20 commits behind `main` still measured a 52 % saving; it is reported
   as staleness instead. The lockfile is matched because it is the repo's
   strongest existing invalidation signal — CI's own cache is keyed on it. The
   env hash is matched because `NEXT_PUBLIC_*` is inlined at build time and no
   measurement exists for reusing a cache across a different inlined value; the
   three values are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SITE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

   **Consequence, stated plainly.** With the env hash in the key, a seed applies
   only when the inlined environment is identical. A fresh worktree leases its
   own app port, so its `NEXT_PUBLIC_SITE_URL` usually differs and the seed
   usually misses. The measured −48 % (Evidence §1) was taken with identical env
   and an unchanged lockfile and is therefore a **ceiling**, not the expected
   saving; the practical hit rate is unmeasured (Evidence, Not measured). Until
   the env-independence experiment passes, the seed's realised value is expected
   in same-contract rebuilds (`--force`, restored worktrees, stack restarts at
   the same port) rather than in the first build of a new port.

   **What is seeded.** The snapshot body, and therefore the seed, is exactly one
   entry: `turbopack/`. Every other entry under `.next/cache` is skipped by name
   by the snapshot writer, and the list is closed — an entry that is neither
   allowlisted nor named below is treated as unrecognised:

   - `fetch-cache/` — build-time HTTP responses (in this repo, the
     `next/font/google` response from the root layout). The fingerprint covers
     tree content, inlined `NEXT_PUBLIC_*` and build mode; it does not cover an
     HTTP response, so a reused response could be silently stale.
   - `config.json` — Next's telemetry identity (`anonymousId`, `salt`), not a
     build input. Copying it would spread one machine's identity into every
     worktree.
   - `.tsbuildinfo` — TypeScript incremental state.
     `typescript.ignoreBuildErrors` is `false`, so diagnostics are part of a
     correct build; typecheck state is not a Turbopack artifact and the
     `turbopack/v*` prune never touches it. Keeping it would need a
     cold-vs-seeded diagnostics comparison that has not been run, so it is
     excluded until one exists.

   An **unrecognised cache root** — an entry under `.next/cache` that is neither
   the allowlist nor one of those three, or no `turbopack/` at all — is a reason
   to build cold, never a reason to copy: that snapshot is skipped and
   `env doctor` reports the layout, so a Next layout change cannot silently
   degrade every worktree. The three entries above are known exclusions, not
   unrecognised roots, and never trigger a skip.

   **Seeding is additive and lands atomically.** Seed only when `.next/cache` is
   absent; never overwrite or merge into a worktree's own cache. Run decision 4's
   free-space preflight first. Copy into
   `<worktree>/.next/cache.seed-<pid>-<nonce>` on the same filesystem, verify the
   manifest's `fileCount` and `sizeBytes` against the copy, then `rename` into
   `.next/cache` — the rename is the publication step, so an interrupted, failed
   or ENOSPC copy is never observed as a cache. If the rename loses a race,
   delete the temp directory and keep the worktree's cache. Leftover
   `cache.seed-*` directories are removed by the next seed once their owner is
   gone; nothing about a failed seed is sticky, and the next build seeds again.

   **Verification and corruption.** Before copying, the seed requires
   `manifest.json` with `complete: true` and a matching identity. A snapshot that
   fails verification is retired — the build runs cold and the next publish
   replaces it — and a copy that fails verification is deleted and the build runs
   cold. A corrupt or incomplete snapshot never fails a build and never blocks a
   worktree.

   **Locks.** The seed path takes no lock: it reads the pointer once and copies
   from one immutable id, so concurrent seeds never serialize. The staging copy is
   taken inside the locked build, while the cache is quiescent. Publication —
   manifest, verification, pointer swap, retention — is the only part that takes
   the registry `snapshot.lock` (decision 2), and it runs after both the checkout
   lock and `build.lock` are released. Ordering is fixed: checkout lock → build
   lock → staging copy → **release both** → `snapshot.lock`; `snapshot.lock` is
   never taken while either is held. A snapshot that cannot take `snapshot.lock`
   within its short wait is skipped with a warning.

   Use a plain copy where reflink is unavailable (`cp -a`); use
   `cp --reflink=auto` / `cp -c` on APFS and CoW filesystems.

4. **Never clear the cache on rebuild.** Same-version churn self-compacts
   (measured); clearing throws away the worktree's warm state and turns every
   rebuild cold. The only pruning **within a cache tree** is **foreign version
   dirs**, applied in two places: the worktree's own cache after a successful
   build (as today), and the snapshot writer's staging copy before it is
   published. Both delete only `turbopack/v*` directories whose version prefix
   differs from the installed `next` version. The cap below deletes nothing, so
   this remains the only pruning.

   The writer prunes the staging copy it has just taken, so the snapshot every
   seed copies is already pruned. The destination prune stays only as a defensive
   no-op: it can fire when a seed carries a foreign version directory out of an
   older snapshot. Neither ordering changes a build's output — the cache key
   already rejects the foreign directory — the difference is cost: the current
   order copies a 561 MB foreign directory (measured) and then deletes it, paying
   that size twice per seed.

   **Size cap: 1024 MB per snapshot, prune-only below it (a policy constant).**
   The cap applies to the allowlisted root of a published snapshot after the
   staging prune, so it bounds what one seed can write, not what a worktree may
   grow to. The measured 982 MB worktree cache is _un-pruned_ and includes a
   561 MB foreign version directory; 1024 MB is above that value, while every
   published snapshot is pruned and sits far below it (435–440 MB measured for
   the pruned steady state). The cap therefore binds only long same-version
   growth past the measured 20-commit range, which is unmeasured.
   `STUDIQ_CACHE_MAX_MB` overrides it. Over the cap:
   no snapshot is written, the previous snapshot is kept, and a worktree with no
   snapshot builds cold. The cap never deletes cache content, never evicts LRU
   and never triggers a rebuild — that would contradict the rule above, and the
   data says prune-only is enough for worktree growth. If a pruned `main` cache
   exceeds the cap on consecutive builds, `env doctor` reports the breach and the
   cap is revisited with a measurement, never raised silently.

   **Free-space preflight.** Both writes check the filesystem that holds the
   target first:

   - seed: `free >= snapshot size + STUDIQ_CACHE_RESERVE_MB`, with the size taken
     from the snapshot's manifest (decision 2). No recorded size means no seed.
   - snapshot: `free >= staged copy + previous snapshot + reserve`, because the
     staging copy is written while the old snapshot is still on disk.

   `STUDIQ_CACHE_RESERVE_MB` defaults to 500. The reserve is a policy constant,
   not a measurement: it covers the build's own writes beside the cache (a cold
   build writes ~275 MB of cache; the rest of `.next` and the runtime state
   directory were not measured — experiment: total size of `apps/web/.next` and
   the checkout's `.dev` directory after one cold build). A failed preflight is
   not a build failure: the seed is skipped and the build runs cold, or the
   snapshot is refused and the previous one is kept. Either way the reason is
   printed once and repeatable with `env doctor`.

5. **Cap concurrent builds by measured memory, and allow one build per
   worktree.** Admission is a function of memory, not a fixed count. A build
   holds a global slot and a per-worktree mutex; a worktree may hold at most one
   slot, so two builds never write the same `.next`.

   - **Slots are directories.** `<registry>/build-slots/<n>/` (the runtime
     registry: `$STUDIQ_DEV_REGISTRY`, default under `$XDG_RUNTIME_DIR`) holds
     `pid`, process start time, `pgid`, single-use `token`, `worktree`, `startedAt`
     and `heartbeat`; the **slot cap** is written once to
     `<registry>/build-slots/capacity` when it is derived. Only the directory
     form can carry this metadata; slots do not use `flock`, so they have no
     kernel wait queue (see the queue contract). Acquisition order is worktree
     mutex first, then slot; release is the reverse.
   - **One build per worktree.** The mutex is
     `<registry>/build-slots/worktrees/<repo-root-key>`. A second `env build` in
     the same worktree waits on the mutex inside the same deadline and prints the
     holder's slot; it never runs concurrently with the first. If the holder's
     identity is dead, the mutex is reclaimed under the liveness rule below.
   - **Both Next apps draw on one pool.** `apps/admin` is a second Next app and a
     second full build; its `build` script takes the same guard and the same slot
     as `apps/web`. A pool of `n` admits `n` Next builds in total, never `n` per
     app, so web and admin cannot each fill the pool. Admin's peak RSS is
     unmeasured; it reserves one web-sized slot until it is measured, which errs
     conservative and needs no new number here.
   - **Effective limit.** `free = min(MemAvailable, cgroup max − cgroup current)`;
     cgroup v2 is `memory.max`/`memory.current`, v1 is
     `memory.limit_in_bytes`/`memory.usage_in_bytes`; a cgroup value of `max`
     means no limit. `capacityBytes = min(MemTotal, cgroup max)`. Fall back to
     the host reading only when no cgroup limit exists, and log
     `build: no cgroup limit; using host MemAvailable` on every admission — a
     host reading inside a limited sandbox is the failure this decision exists to
     prevent.
   - **Reservation.** Admit only when both
     `capacityBytes − ((activeSlots + 1) × SLOT_RSS + stackReserve) >= MIN_FREE`
     and `free >= MIN_FREE`, with `SLOT_RSS = 3.9 GB` (measured: one warm build
     peaks at 3.93 GB RSS across 18 processes) and `MIN_FREE = 4.5 GB` (a target,
     not a measurement). The candidate build counts as one slot. On the 19.9 GB
     benchmark box the first test admits 3 (3 × 3.9 + 4.5 = 16.2 GB) and refuses
     a fourth (4 × 3.9 + 4.5 = 20.1 GB), which matches the measured safe point:
     three concurrent builds had ~2.5 GB headroom and four went into swap
     (Evidence §4). The second test catches non-build consumers that the
     byte-capacity test does not model (a dev server, an unrecorded stack
     process). **The ceiling is 3 until Open Question 1 is measured; memory is
     the only input that lowers it.**
   - **Stack reserve.** Detect stacks from the registry's stack records across
     all checkouts plus this checkout's `.dev/stack.json` (the checkout state
     directory — `.dev` by default; `STUDIQ_ENV_STATE_DIR` overrides),
     de-duplicated by stack id — never by a `supabase status` call in the
     admission path. A native stack reserves one `SLOT_RSS`; a Docker stack
     reserves two, because the VM and daemon sit outside the container's memory
     reading. Both are policy reserves (unmeasured — experiment: RSS of a native
     stack vs `docker stats` for a Docker stack on the benchmark box). The
     reserve is re-read on every backoff tick and immediately before spawn: a
     stack that appears mid-wait forbids the next admission, a stack that stops
     frees its reserve at the next tick, and a running build is never pre-empted.
   - **Backoff.** Re-check on a jittered exponential backoff, 2 s doubling to a
     10 s cap; never a tight retry loop. Both figures are policy constants.
   - **Always one slot.** If no build is active and the admission test fails,
     admit exactly one build with a warning naming `free`, `MIN_FREE` and the
     reserve. A box under pressure can therefore always run the one build needed
     to fix it. `STUDIQ_BUILD_MIN_FREE_MB=0` disables the memory test entirely
     (slot and worktree mutex still apply) and prints
     `build: memory gate disabled by STUDIQ_BUILD_MIN_FREE_MB=0`; it is not the
     benchmark escape hatch.
   - **Liveness.** Identity is pid + process start time (`/proc/<pid>/stat` field
     22 on Linux, `ps -o lstart=` elsewhere) with a heartbeat file as the
     fallback when neither is readable. **A slot is stale when the recorded
     `pgid` is gone, the recorded pid is gone, or the pid's start time differs
     from the recorded one**; a slot whose identity still matches is never
     reclaimed on heartbeat age alone.
   - **Kill and reclaim.** The build is spawned as its own process group and its
     `pgid` is recorded in the slot. On timeout, launcher exit or any exit path,
     send `SIGTERM` to the group, wait a 10 s grace, then `SIGKILL`, and only
     then release the slot. A slot whose launcher died but whose group survives
     is reclaimed only after the group is killed, so a new build is never
     admitted over an orphan writing `.next`. When a slot is reclaimed because
     its launcher died, the reclaim path invalidates that worktree's `.next` and
     removes its build record before the slot is freed.
   - **Deadlines.** One 60-minute deadline from invocation: at most 30 minutes
     waiting for a slot and at most 30 minutes building, each enforced
     separately, so a long queue can never consume the build's budget. The build
     cap starts when the slot is held and the process spawns. Progress prints
     every 30 s with state, active and waiting counts, elapsed and remaining.
     Wait-cap expiry exits 7 (`queued too long`) and names the holders;
     build-cap expiry kills the group, invalidates `.next` (decision 7) and
     exits nonzero. The 60-minute, 30-minute wait, 30-minute build and 30-second
     progress figures are policy constants, not measurements.
   - **Queue contract.** There is no FIFO guarantee: directory slots have no
     ordering, so no position is promised. Waiters register a directory under
     `<registry>/build-slots/waiters/` (same identity, reclaimed by the same
     rule), which makes a waiter **count** truthful. A waiter directory is
     removed when the waiter is admitted — the slot record replaces it — and in
     `finally` only when the wait is abandoned or fails. The wait is bounded by
     the deadline, which is the fairness guarantee.

   **Scope of the cap.** The cap counts `env build` and the `apps/admin` build
   and nothing else. `next dev` is outside it: `dev:web`, `dev:admin` and any raw
   dev server take no slot, are not counted and are not guarded. `env serve`
   serves an existing artifact and is not a build.

   **Consequence for agents.** A running dev server is invisible to the cap but
   not to the memory gate: it can consume the headroom an admission check
   expects, so a build may wait at the gate while a dev server runs. The gate
   still protects the box at admission; the cap simply does not count the dev
   server, and memory the dev server takes after admission is not reserved for.
   On a small-RAM box, stop the dev server before building. Counting a dev server
   as one slot is deferred (Open Question 3).

6. **Enforce at the build entrypoint, not in docs.** One guard is attached to the
   `build` script of **both** Next apps, `apps/web` and `apps/admin`, through
   Bun's `prebuild` hook. A build with no single-use grant fails before
   `next build` starts.

   - **Holding a slot is a file fact, not an environment fact.** A build holds a
     slot when all of these hold: `.dev/build-grant.json` exists in this
     checkout's state directory and names this app; the grant records `token`,
     `app`, `launcherPid`, `launcherStart` and `expiresAt`, is consumed by rename
     then unlink, and its `token` equals the `token` of a slot directory
     `<registry>/build-slots/<n>/` whose `worktree` resolves to this checkout's
     root; and that slot is live under decision 5's liveness rule (pid + start
     time + pgid). A `--no-slot` or `--no-lock` grant skips the slot directory but
     must still name a live launcher by the same pid-plus-start-identity test,
     and a grant past `expiresAt` is refused. The guard renames the grant away
     and unlinks it on first read, so one grant authorises exactly one build: a
     long-lived shell that once ran `env build` cannot replay an exported
     `STUDIQ_BUILD_SLOT`, and that variable is a log label, never consulted for
     admission.
   - **Enforced entrypoints.** The guard is attached to each app's `build` script,
     so every route that executes that script is covered: `bun run build` at the
     root delegates to the filtered script, and `bun run build:web`,
     `bun run build:admin`, `bun run --filter <app> build` and `bun run build`
     inside either app all execute it. All of them fail without a grant.
     `env build` in any mode (slot, `--no-slot`, `--no-lock`) is the only command
     family that mints a grant.
   - **Two explicit no-admission modes, both flags, neither in a file.**
     `env build --no-slot` is for an environment with no shared budget: CI and
     Playwright, where the build is the only one on the machine. It adds no
     environment requirement — it uses the same `NEXT_PUBLIC_*` values the job
     already passes to `bun run build` — and mints a grant that names no slot and
     prints one line saying so. `env build --no-lock` is the escape hatch for a
     benchmark or an incident: it bypasses admission on a machine that does
     arbitrate and prints a `warning:` line on every such build.
     `STUDIQ_BUILD_LOCK` is not an env key and is not read; no value in
     `.env.local` can widen what a build may do.
   - **Raw `next build` is unsupported.** `next build`, `bunx next build` and
     `bun x next build` never run `prebuild`, so this ADR does not claim to admit
     them. What catches the automation is a repo guard wired into `bun run lint`:
     it reads workflow `run:` steps and Playwright's `webServer.command`,
     ignoring comments and prose, and fails a `next build` or a bare
     `bun run build` there, so CI and E2E cannot drift back to the unguarded
     path. It cannot catch a person typing the command; the residual risk is
     stated in Consequences.
   - **CI and Playwright use the no-slot path.** The two build steps in
     `verify.yml` — executed by six jobs: four QA shards and two e2e legs — and
     Playwright's `webServer` command call `env build --no-slot` instead of
     `bun run build`. In that mode no slot and no lease is claimed; the contract
     comes from the environment CI already provides, and the build is still
     fingerprinted and recorded. Nothing else about those jobs changes.
   - **Only a successful `env build` records a build.** Every path reachable
     through a wrapper that may overwrite `.next` deletes `.dev/build.json`
     before it starts — `env build` with a slot, `--no-slot` and `--no-lock`
     alike — so an interrupted or failed build can never inherit the previous
     run's "current" claim. Only a successful, fingerprinted `env build` (slot or
     `--no-slot`) writes the record back; `--no-lock` never does. A direct
     `next build` cannot delete the file, so decision 8 makes its artifact read
     as unrecorded instead of current.

7. **Blast-radius guard on Linux, not a watchdog anywhere.** Where the platform
   has an OOM killer and a score knob, set `oom_score_adj=1000` on the build
   process tree so a mis-estimated admission lets the kernel kill a build rather
   than the agent server or the stack. Set it in the spawned process before it
   execs, so `next build` and every worker inherit it; raising it after spawn
   races worker forking. This is a Linux mechanism: macOS has no OOM score, WSL2
   follows Linux inside the VM, and a cgroup with `memory.oom.group=1` kills the
   whole group regardless of score. The score is a preference, not a guarantee;
   admission (decision 5) is the primary control. Do not add a memory watchdog
   that polls and kills builds — not because a kill is uniquely corrupting, but
   because every kill path that does exist is followed by invalidation: the live
   wrapper invalidates on its own exit, and the reclaim path invalidates when the
   launcher itself died, so a watchdog buys nothing the admission gate does not
   already provide.

   - **A failed build is never current.** On any nonzero or timed-out exit the
     live wrapper, before it returns (and before the slot is released, when one
     is held), moves the built app's `.next` aside (rename to
     `.next.failed-<timestamp>`, or delete it when it cannot be moved cheaply)
     and removes `.dev/build.json`, so no serve path can report a half-written
     tree as current. When the launcher itself died, the reclaim path in decision
     5 performs the same invalidation before freeing the slot. It is not limited
     to the rebuild handover path, today the only path that records an
     interrupted build.

**Platform behaviour (decisions 5 and 7).** The native matrix is ADR-0011 §12's
and is not changed here: Linux x86_64/arm64 and macOS arm64 are native, Windows is
WSL2-only, and anything else is not a native platform. The platform is probed,
never inferred from `process.platform` alone — WSL2 reports `linux`, and a cgroup
can exist on any Linux.

| Platform               | Memory measurement                                                                                                              | OOM score                                                                    | `flock`                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Linux x86_64/arm64, CI | `min(/proc/meminfo MemAvailable, cgroup max − current)`; cgroup v2 and v1; host-only when neither exists, and the log says so   | `oom_score_adj=1000` on the tree; `memory.oom.group=1` still kills the group | yes (`flock(2)`)                                                      |
| macOS arm64            | free + inactive pages from `vm_stat` × page size; total from `sysctl hw.memsize`; an approximation, never called `MemAvailable` | none — no OOM killer, no knob, no blast-radius claim                         | yes                                                                   |
| WSL2                   | as Linux, scoped to the VM: `/proc` and the cgroup describe the WSL2 VM (ceiling from `.wslconfig`), not the Windows host       | as Linux inside the VM; Windows-side kill behaviour is out of scope          | yes on the Linux filesystem; treat `/mnt/<drive>` (9p) as unavailable |
| Windows-native         | not a build platform (ADR-0011 §12: WSL2 only)                                                                                  | none                                                                         | none                                                                  |

**Fail open, never fail closed.** Memory is probed before each admission attempt.
The probe counts as failed when `/proc/meminfo` or the cgroup files are absent,
unreadable or unparseable, when `vm_stat`/`sysctl` fail on macOS, and when a
reading is zero or negative. On a failed probe the build proceeds with a slot cap
of exactly one concurrent build — not decision 5's slot count — and prints one
warning naming the platform and the missing input. It never waits for a
measurement that will not appear, and never refuses every build.

- A cgroup v1 "no limit" sentinel (a value above physical RAM) means unlimited,
  not headroom; the same goes for `memory.max` = `max` on v2.
- Where `flock` is unavailable or returns `ENOTSUP` (9p mounts, Windows
  filesystems, some network mounts), the remaining locks fall back to
  `dirMutex`; slot acquisition is already directory-based and unaffected. The two
  primitives are never mixed for the same lock.
- `oom_score_adj` is set where it exists and skipped where it does not; the skip
  is recorded in the build log, not warned about per build.

8. **Report state, don't add a daemon — and report only what is countable.**
   `env status` and `env doctor` stay read-only (ADR-0011 §1) and cheap: one
   pointer read, one manifest read, a shallow `readdir`, no `du`, no child
   process. Reclamation belongs to the admission path (decision 5); status
   observes staleness and never cleans it.

   - **Slots.** `build: <busy>/<slotCap> busy` — `build: 2/3 busy` when two of
     three slot records carry a live identity. `<slotCap>` is read from
     `<registry>/build-slots/capacity` (decision 5), never recomputed from memory
     or stack state at read time. The slot `readdir` counts only the numeric
     entries; `worktrees/`, `waiters/` and `capacity` are excluded by name. A
     record whose process is gone is reported as stale (`2/3 busy, 1 stale`), not
     dropped and not reclaimed.
   - **Queue depth.** Decision 5 has every waiter register a directory under
     `<registry>/build-slots/waiters/`, and removes it when the waiter is
     admitted, so status prints a waiter **count** (`build: 2/3 busy, 1 waiting`)
     from that directory. It never prints a queue _position_: directory slots
     have no ordering guarantee. A waiting build also reports its own state in
     its progress line.
   - **Snapshot.** Size, file count, commit and age come from the snapshot
     manifest (decisions 2 and 3), plus the `turbopack/v*` names from one shallow
     `readdir` of the snapshot root. A size shown is the snapshot's and is
     labelled as such; it is never presented as this worktree's `.next/cache`
     size, which is not measured and would need `du`. Age is computed from
     `createdAt` and warns above 7 days. `behindCommits` is shown as recorded,
     labelled "at publish", and warns above 100; status never invokes git, so a
     live commit distance is not available at read time. Staleness warns and
     never refuses a seed.
   - **Unknown is null.** A missing manifest, an unreadable record or a failed
     probe prints `null` in `--json` and `unknown` in text — never `0`.
   - **Degraded memory.** After a failed platform probe, print the clamped slot
     cap and the reason: `build: 1/1 busy (memory gate degraded)`.
   - **`current` needs a record, not just a fingerprint.** `env status` and
     `env serve` report an artifact as current only when the fingerprint matches,
     `.dev/build.json` exists, **and** `.next/BUILD_ID`'s mtime is not newer than
     `builtAt` in `.dev/build.json`. A raw `next build` moves `BUILD_ID` past it;
     the artifact then reads as `unrecorded` and is rebuilt rather than served as
     current. A `--no-lock` build never restores the record, so a bypassed
     artifact stays unrecorded by construction.

## Evidence

All runs are sequential builds in isolated worktrees, identical env, with only
**one** variable changed: the presence of a seeded `.next/cache` (§4 is the
concurrency table; every other table is sequential). Wall time is the whole
`next build` process.

Env was held identical across arms, so every number below measures the ceiling
for the seed: it is the saving when the snapshot identity (decision 3) matches
exactly. A worktree that differs in `NEXT_PUBLIC_*` or in `bun.lock` skips the
seed. The benchmark builds invoked `next build` directly, so none of these
artifacts carried a build record and none was ever reported as current.

### 1. Seed pays for itself (5 runs each, PR #1083: 14 files, 3 commits behind `main`)

| Arm                | Median wall         | Compile   | TypeScript |
| ------------------ | ------------------- | --------- | ---------- |
| no cache (cold)    | **16.49 s**         | 8.8–9.5 s | 3.5–3.9 s  |
| seeded from `main` | **8.60 s**          | 3.0–3.2 s | 2.2–2.3 s  |
| **delta**          | **−7.89 s (−48 %)** |           |            |

Copy cost: **272 MB in 80–101 ms** (`cp -a`; reflink unsupported on this FS).
A cold build writes the same ~275 MB of cache anyway, so the seed replaces work
rather than duplicating it.

The 272 MB / 80–101 ms copy is an **upper bound** for the seed: it measures a
whole `.next/cache`, and that directory also holds `fetch-cache/`, `.tsbuildinfo`
and `config.json`, which decision 3 excludes. The Turbopack-only size was not
measured separately (see Not measured).

### 2. Snapshot staleness (3 runs each, target = `main` `ea790b3e`)

| Seed                                   | Age | Median wall | Saving        |
| -------------------------------------- | --- | ----------- | ------------- |
| none                                   | —   | 16.41 s     | —             |
| `main` @ same commit                   | 0   | **7.53 s**  | 8.88 s (54 %) |
| `main` − 20 commits (same Next 16.4.4) | 20  | **7.90 s**  | 8.51 s (52 %) |
| `main` − 40 commits (Next 16.4.3)      | 40  | 17.22 s     | 0 s           |

Ordinary main movement costs ~0.4 s of the benefit per 20 commits. A tool
version change is the only _measured_ hard invalidation — the cache key changes,
the old directory is kept, and the build is simply cold. Under the snapshot
identity in decision 3 it is not the only one: a changed `bun.lock`, a different
inlined env, a changed seed scope or a changed Turbopack directory name also
skips the seed. Only the version-change case is measured here. Next does not
prune it: `v16.4.3` + `v16.4.4` together measured 523 MB.

### 3. Cache growth over 20 real commits (Oct 27–31, replaying main history)

Kept the cache across 20 real code changes (features, not synthetic edits):

| Phase                                 | Size                                              |
| ------------------------------------- | ------------------------------------------------- |
| cold start (first build)              | 372 MB                                            |
| after 9 same-version rebuilds         | 562 MB (+51 %)                                    |
| Next bump (build 10)                  | 809 MB — old dir retained                         |
| after 20 rebuilds                     | **982 MB**                                        |
| of which the dead `v16.3.8` dir       | **561 MB (57 %)**                                 |
| same tree, cold                       | 253 MB                                            |
| after pruning the foreign dir (92 ms) | **435 MB**, next build still warm (2.5 s compile) |

Same-version churn self-compacts (562 → 524 → 589 MB across edits), so the
realistic per-worktree cost after 20 changes is ~440 MB, not 1 GB. The 1 GB case
is entirely the un-pruned foreign version dir.

### 4. Concurrency limit (same tree; 4-way used distinct changes per worktree)

| Concurrent | Cold wall each  | Cold throughput   | Warm wall each | Peak build RSS | Box                                              |
| ---------- | --------------- | ----------------- | -------------- | -------------- | ------------------------------------------------ |
| 1          | 16.49 s         | 16.49 s/build     | 8.60 s         | 3.9 GB         | fine                                             |
| 2          | 25.67 s         | 12.84 s/build     | 14.54 s        | ~7.8 GB        | fine                                             |
| 3          | 36.70 s         | **12.23 s/build** | 20.29 s        | ~11.7 GB       | fine, ~2.5 GB headroom                           |
| 4          | 48.1–54.4 s     | ~13.5 s/build     | —              | 14.2 GB        | 1.4 GB available, ~2.3 GB swap                   |
| 16         | never completed | —                 | —              | ~63 GB demand  | swap 0 within 60 s, load ~600, agent server died |

A single warm build peaks at **3.93 GB RSS across 18 processes** (15 page-gen
workers + compiler). RAM, not cores, is the limit; one build already saturates
16 cores, which is why 3 slots buy only ~25–35 % throughput.

### Not measured

Everything above times builds; none of it compares what a seeded build _emits_,
or measures the cases the decisions now depend on. Each item below is an
experiment, not a number.

- **Cold vs seeded output equality.** The seed's central safety claim is
  unproven. Experiment: same tree, two isolated worktrees, one cold and one
  seeded from the matching snapshot; compare every file under `.next` except
  `BUILD_ID` (static and server chunks, prerender HTML, manifests) byte-for-byte,
  plus the TypeScript diagnostics; repeat with a different
  `NEXT_PUBLIC_SITE_URL` in the seeded arm. A negative result withdraws the seed
  (decisions 1–3 do not ship in this form).
- **Env-independence hit rate.** The decision-3 match includes the inlined env
  hash, so a fresh worktree often misses. Experiment: record seed hit/miss and
  wall time for a changed `NEXT_PUBLIC_SITE_URL` and for a changed `bun.lock`,
  then decide whether the env hash can be demoted to a recorded field. Until
  then, the §1 saving stays a ceiling.
- **Admin peak RSS.** `apps/admin` reserves one web-sized slot because its own
  peak is unmeasured. Experiment: peak RSS of an `apps/admin` build under the
  same fan-out as §4.
- **Native vs Docker stack footprint.** The one-slot/two-slot reserve is policy.
  Experiment: RSS of a native Supabase stack vs `docker stats` for a Docker stack
  on the benchmark box.
- **Turbopack-only seed size.** The allowlist means the seed is smaller than the
  copied tree. Experiment: `du -sb` the `turbopack/` root of a real
  `apps/web/.next/cache`.

## Consequences

- **The seed is a best-case ~8 s saving.** The −48 % in Evidence §1 was measured
  with identical env and an unchanged lockfile, so it is an **upper bound**, not
  the expected saving. Under the exact identity in decision 3 a fresh worktree
  normally differs in `NEXT_PUBLIC_*` (its own port → `NEXT_PUBLIC_SITE_URL`) and
  often in `bun.lock`, so its first build frequently misses and runs cold; the
  realised hit rate is unmeasured (Evidence, Not measured). Setup cost is ~0.1 s
  and at most ~272 MB (whole-cache measurement; the allowlisted root is smaller,
  unmeasured).
- **The seed is best-effort and verified.** Missing or unverifiable snapshot,
  identity mismatch, foreign version, unrecognised cache layout, failed
  free-space preflight, untrusted cache root, failed copy, incomplete manifest or
  an over-cap snapshot never blocks a worktree — the build runs cold, the reason
  is reported once and in `env doctor`, and a failed snapshot is retired instead
  of retried forever.
- **Snapshot correctness is not proven yet.** Whether a seeded build emits the
  same bytes as a cold one is unmeasured (Evidence, Not measured); this ADR is
  Proposed partly on that experiment, and a negative result withdraws the seed.
- **Disk:** ~270 MB of cache per fresh worktree (the whole-cache figure; it
  replaces what the cold build writes), ~440 MB after 20 changes, and the 1024 MB
  cap binds only long same-version growth past the measured 20-commit range
  (unmeasured); a published snapshot is always pruned and cannot reach the cap
  through the un-pruned case. Two
  published snapshots may coexist in the cache root — `current` plus one retired
  predecessor awaiting its grace period — plus the staging copy of a write in
  progress: at most three snapshot-sized trees, each bounded by the cap. A
  worktree's own cache is separate from all of them. Pruning the staging copy
  before publish keeps the common case near 440 MB; a worktree that outgrows the
  cap keeps its cache and simply stops being a snapshot source.
- **The cache root is trusted like the registry.** The only paths the seed writes
  or deletes are the snapshot and staging paths under a guarded cache root, plus
  the seed temp directory inside this worktree's `.next`; a bad cache-root
  override costs a cold build, not a repository.
- **Concurrency:** a memory-derived cap with a measured per-slot reservation
  keeps the benchmark configuration out of swap — three builds peak at ~11.7 GB
  (Evidence §4), a smaller cgroup admits fewer, and a native stack reserves one
  slot and a Docker stack two. Where memory cannot be measured the cap fails open
  to one. Serialized builds (the current exclusive lock) are already safe; slots
  only recover ~25–35 % throughput during coincidences (Evidence §4).
- **`next dev` is uncounted.** A dev server takes no slot and is not guarded; the
  memory gate sees only what it uses at the moment of admission, so a build may
  wait at the gate while a dev server runs. On a small-RAM box, stop the dev
  server before building. Counting it is Open Question 3.
- **The bypass is bounded, not closed.** Every automated entrypoint — root and
  workspace `bun run build`, both apps, CI, Playwright — goes through the guard.
  A person typing `next build` still does not, and the repo guard on workflow and
  Playwright files only stops automation from drifting back. That residual is
  accepted because one unadmitted build cannot reproduce the burst this cap
  exists for, its artifact is never reported current, and CI cannot regress
  unnoticed. Enforcement is load-bearing for automation; it is not a claim that
  raw builds are impossible.
- **CI is touched, in one step per job.** The two build steps in `verify.yml` and
  Playwright's `webServer` command switch to `env build --no-slot`; cache keys,
  stack lifecycle and shard layout are unchanged. ADR-0011 §11 carries the
  corrected line.
- **Admin is counted, not exempt.** `apps/admin` builds take the same guard and
  the same pool as `apps/web`; the pool is a total, never a per-app quota.
  Admin's peak RSS is unmeasured, so it reserves one web-sized slot.
- **No daemon.** All state is files: slot directories and the waiter directory in
  the runtime registry, the grant and the build record in `.dev/`, the snapshot
  directories and manifest under the cache root. Stale slots are reclaimed by pid
  plus start time and by process-group death, not by a liveness check on pid
  alone. Grants are per-build and ephemeral; nothing watches in the background.
- **Status is truthful, not complete.** `env status` reports busy/total, stale
  entries and the snapshot's manifest size; it can report a waiter count because
  decision 5 registers waiters, but never a queue _position_ or a live
  per-worktree cache size (`du` is out of the read path). A waiting build learns
  its state from its own progress line.
- **Platforms degrade to one.** Where memory cannot be measured, one build runs
  with a warning instead of no build running. macOS keeps the admission gate but
  has no OOM-score blast-radius guard; Windows-native is not a build platform.
- **Out of scope / follow-ups.** The repository work this decision implies —
  declaring the new environment keys in the schema, making worktree creation's
  optional seed ergonomic, and updating AGENTS/README — is implementation and
  lands with #1078 after acceptance, not in this record. A seeded cache does not
  replace `bun install`: a fresh checkout still installs dependencies before its
  first build.
- **Turbopack's cache layout is private API.** The allowlist and the key are
  stated at directory-name level; if a Next release renames or restructures the
  root, the seed skips (decision 3) and `env doctor` reports it rather than
  copying something unknown. Keeping the list current is a follow-up.

## Open questions

1. **Worker cap for more slots.** `experimental.cpus: 4` per build is the only
   path to a ceiling above three, because one build already saturates 16 cores and
   RAM is the limit at the current worker count. Unmeasured — experiment: same
   tree, `experimental.cpus: 4`, peak RSS and throughput at 4–6 concurrent builds,
   including a cgroup-limited run. The ceiling stays 3 until that run exists;
   memory may lower it, never raise it.
2. **Re-measure on APFS.** Reflink makes the seed close to free there; this
   filesystem is the pessimistic case. Experiment: repeat the seed copy cost and
   the §1 wall-time comparison on an APFS checkout with `cp -c`.
3. **Counting `next dev` as a slot.** A dev server is outside the cap and outside
   the snapshot logic, and its memory is visible to the gate only at admission
   (decision 5). Counting it — from a declared pid file or the app-port lease —
   would make the cap cover the real consumer, but it needs a detector that is
   cheap and cannot be spoofed. Trigger: an observed OOM or a measured p95 build
   slowdown with a dev server up; owner: the #1078 implementation follow-up. Not
   built until then.

## Implementation sketch

- `scripts/env/lib/locks.ts` — `withBuildLock` → `withBuildSlots(n, minFreeMb, fn)`
  built on `dirMutex` slots (no `flockMutex` for slots), identity = pid + process
  start time, reclaim by process-group death; the per-worktree mutex and the
  `waiters/` directory live beside the slots. Add `withSnapshotLock()`
  (`snapshot.lock`, short wait, non-fatal on timeout), entered only after the
  checkout lock and `build.lock` are released.
- `scripts/env/lib/admission.ts` (or the same module) — cgroup-aware reading
  (`min(MemAvailable, cgroup max − current)`, v2 and v1, host fallback logged),
  byte-capacity-based reservation with the measured per-slot RSS, a recorded
  slot cap, and stack reserves from registry records plus this checkout's
  `.dev/stack.json`.
- New `scripts/env/lib/build-cache.ts` — snapshot identity + manifest, staging
  copy taken inside the locked build, publish (verify, atomic pointer swap,
  retention) after the locks are released, foreign-version prune of the staging
  copy before publish and of the worktree cache after a successful build; seed
  (preflight, temp directory, verify, rename) and the allowlist.
- `scripts/env/lib/build.ts` / `commands/build.ts` — take the staging copy inside
  the locked scope, run publish after it in the command (even when the
  fingerprint was already current); `--app <web|admin>`, `--no-slot`,
  `--no-lock`; mint the single-use grant in every mode (slot, `--no-slot`,
  `--no-lock`), delete `.dev/build.json` first, record only on success,
  invalidate `.next` on a failed exit.
- `apps/web/package.json` and `apps/admin/package.json` — a `prebuild` script
  running `bun ../../scripts/env/build-guard.ts` (consumes a single-use grant;
  fails fast with slot/queue state; `env build --no-lock` is the only admission
  opt-out).
- `scripts/check-build-entrypoints.ts` — wired into `lint`; fails a workflow or
  Playwright file that invokes `next build` or a bare `bun run build`.
- `scripts/env/commands/status.ts` / `doctor.ts` — slots, waiter count, snapshot
  manifest line and staleness; read-only, no `du`.

## Rollback

Rollback keeps the build record and the failure-invalidation rule — they are what
keeps a killed build from reading as current — and removes the admission and
cache mechanisms in two independent steps:

- **Concurrency.** Delete `<registry>/build-slots` — slot directories, the
  per-worktree mutex, the `waiters/` directory and the `capacity` file — drop the
  `prebuild` guard from both apps, stop minting the grant, and remove the
  entrypoint check from `lint`; point `env build` back at the single exclusive
  `build.lock`. Every build is then serialized across worktrees, and
  `--no-slot`/`--no-lock` are removed with the guard. **Restore the callers**:
  put `bun run build` back in the two `verify.yml` build steps and in
  Playwright's `webServer` command, because `--no-slot` no longer exists. This
  step is required for CI and E2E to stay green.
- **Cache.** Delete `$STUDIQ_CACHE_DIR` — the snapshot directories, their
  manifests and the `current` pointer — and remove the seed hook from worktree
  creation, the snapshot step from `env build`, the snapshot/status reporting
  (status then prints `null`/`unknown`) and `snapshot.lock` with it. Every
  worktree then builds cold, and a later re-enable cannot pick up a stale
  snapshot.

Every removal is correctness-neutral except the CI caller restoration, which is
required for CI to stay green. Neither rollback affects the build fingerprint:
with no snapshot a build is simply cold, and with one exclusive lock a build is
simply serialized. Removing the seed also removes this ADR's dependence on the
unproven cold-vs-seeded equivalence (Evidence, Not measured). Both are reversible
in the other direction by restoring the files. Neither rollback changes the
fingerprint or the `next build` invocation; removing the seed restores cold
builds.

## Reproduce

The benchmark scripts and CSVs were run from this workspace, outside the repo:
`/home/node/.cache/cache-bench/` (`bench.sh`, `staleness.sh`, `churn.sh`,
`fanarm.sh`, plus `results.csv`, `staleness.csv`, `churn.csv`, `fanout.csv`).
They are local-only; commit a trimmed `scripts/bench/` harness only if the team
wants the numbers to be re-runnable.

## References

- [Issue #1078 — local cache strategy](https://github.com/logyQT/studiq/issues/1078)
- [Issue #1077 / ADR-0011 — the `env` CLI](0011-env-cli.md)
- [ADR-0010 — one root values file](0010-env-ssot.md)
- `scripts/env/lib/locks.ts` (`withBuildLock`), `scripts/env/lib/build.ts`
  (`runProductionBuild`), `scripts/env/lib/fingerprint.ts`
