# ADR-0013: Seed `.next/cache` into worktrees, and cap concurrent builds

## Status

Proposed (2026-11-11). Measurements recorded below are from this repo at
`ea790b3e` (main) and `521792db` (PR #1083) on a 16 vCPU / 19.9 GB RAM / 5 GB
swap container (overlay + ext4, no reflink), Next 16.4.4 (Turbopack), Bun 1.4.4.

This ADR settles the two questions [#1078](https://github.com/logyQT/studiq/issues/1078)
left open — whether a local `main` build-cache snapshot is worth seeding, and how
many concurrent `next build`s the box can take — and supersedes the "Caching is
out of scope (#1078)" clause of [ADR-0011](0011-env-cli.md) §11 only.

## Context

Agent work is bursty: most of the time is spent thinking and editing, and a build
happens when an agent wants to verify a change. Two costs follow:

1. Every fresh worktree starts with an empty `.next/cache`, so the first build
   recompiles the whole app even though `main` was compiled minutes earlier on
   the same machine.
2. Several agents can verify at the same time. `env build` already takes a
   cross-worktree, exclusive lock (`withBuildLock` → `<registry>/build.lock`,
   1800 s wait) in `scripts/env/lib/locks.ts`, but the lock is per _entrypoint_:
   any agent that runs `bun run --filter @studiq/web build` (or `next build`)
   directly bypasses it. Sixteen raw builds at once is enough to exhaust RAM and
   swap and take the agent server down with it.

The build fingerprint (`scripts/env/lib/fingerprint.ts`) keys a build by tree
content + inlined `NEXT_PUBLIC_*` + build mode, so a seeded cache can never make
a stale build look current. This ADR is about _input_ caching, never serving a
stale `.next` output.

## Decision

1. **Seed `.next/cache` only, never the `.next` output.** A worktree created by
   `spin` (or any worktree with no `.next/cache`) may copy the local `main`
   snapshot into `.next/cache`. The built output, `BUILD_ID` and the fingerprint
   stay per-worktree; the fingerprint remains authoritative.
2. **The snapshot is produced locally by a successful `env build` on `main`,
   retention 0.** One snapshot, atomically swapped under the registry lock
   (temp dir + rename), old one deleted. No CI artifact, no upload/download, no
   signing surface. Location is the cache root already decided in #1078:
   `$STUDIQ_CACHE_DIR` = `${XDG_CACHE_HOME:-$HOME/.cache}/studiq`, mode 700,
   never inside the checkout.
3. **Seed rules.** Seed only when `.next/cache` is absent; never overwrite a
   worktree's own cache. Skip the seed entirely when the snapshot's cache key
   (`turbopack/v<next-version>-<hash>`) does not match the installed Next
   version. Use a plain copy where reflink is unavailable (`cp -a`); use
   `cp --reflink=auto` / `cp -c` on APFS and CoW filesystems.
4. **Never clear the cache on rebuild.** Same-version churn self-compacts
   (measured); clearing throws away the worktree's warm state and turns every
   rebuild cold. The only pruning is **foreign version dirs**: after a successful
   build (or at seed time), delete `turbopack/v*` directories whose version
   prefix differs from the installed `next` version.
5. **Cap concurrent builds with a registry semaphore: 3 slots maximum, memory
   gated.** Reuse the existing registry primitives (`dirMutex`, `pidAlive`,
   `takeoverStaleDirLock`) as `<registry>/build-slots/1..3` with `pid`, `token`,
   `worktree`, `startedAt`. Before spawning, require `MemAvailable >= 4.5 GB`
   (`STUDIQ_BUILD_MIN_FREE_MB`); if not, release the slot and retry (the existing
   30-minute timeout still applies). Default 3; 2 when a Supabase stack is
   running.
6. **Enforce at the build entrypoint, not in docs.** Add a `prebuild` guard to
   `apps/web/package.json` that refuses to build unless the caller holds a live
   slot (`STUDIQ_BUILD_SLOT` + token written by `env build`). `STUDIQ_BUILD_LOCK=0`
   is the explicit benchmark escape hatch. Without this, agents bypass the lock
   with the exact command the benchmark used.
7. **Blast-radius guard, not a watchdog.** Set `oom_score_adj=1000` on the build
   process tree so a mis-estimated admission lets the kernel kill a build rather
   than the agent server or the stack. Do not add a memory watchdog that kills
   builds: a mid-write SIGKILL leaves a half-written `.next` and a possibly
   inconsistent cache, and it reacts after the damage is done.
8. **Report state, don't add a daemon.** `env status`/`env doctor` print
   `build: 2/3 busy, 1 queued` and the cache size/foreign-version dirs.

## Evidence

All runs are sequential builds in isolated worktrees, identical env, with only
**one** variable changed: the presence of a seeded `.next/cache`. Wall time is
the whole `next build` process.

### 1. Seed pays for itself (5 runs each, PR #1083: 14 files, 3 commits behind `main`)

| Arm                | Median wall         | Compile   | TypeScript |
| ------------------ | ------------------- | --------- | ---------- |
| no cache (cold)    | **16.49 s**         | 8.8–9.5 s | 3.5–3.9 s  |
| seeded from `main` | **8.60 s**          | 3.0–3.2 s | 2.2–2.3 s  |
| **delta**          | **−7.89 s (−48 %)** |           |            |

Copy cost: **272 MB in 80–101 ms** (`cp -a`; reflink unsupported on this FS).
A cold build writes the same ~275 MB of cache anyway, so the seed replaces work
rather than duplicating it.

### 2. Snapshot staleness (3 runs each, target = `main` `ea790b3e`)

| Seed                                   | Age | Median wall | Saving        |
| -------------------------------------- | --- | ----------- | ------------- |
| none                                   | —   | 16.41 s     | —             |
| `main` @ same commit                   | 0   | **7.53 s**  | 8.88 s (54 %) |
| `main` − 20 commits (same Next 16.4.4) | 20  | **7.90 s**  | 8.51 s (52 %) |
| `main` − 40 commits (Next 16.4.3)      | 40  | 17.22 s     | 0 s           |

Ordinary main movement costs ~0.4 s of the benefit per 20 commits. A **tool
version change is the only hard invalidation** — the cache key changes, the old
directory is kept, and the build is simply cold. Next does not prune it:
`v16.4.3` + `v16.4.4` together measured 523 MB.

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

## Consequences

- **~8 s saved per build, for ~0.1 s of setup and ~272 MB of disk**, and ~45 % of
  the build's CPU under contention. Sixteen queued, seeded builds ≈ 2.5 minutes.
- **The seed is best-effort.** Missing snapshot, foreign version, failed copy or
  oversized cache never blocks a worktree — the build just runs cold.
- **Disk:** ~270 MB per fresh worktree (replaces what the cold build writes),
  ~440 MB after 20 changes, ~1 GB if a Next bump happens mid-branch. A prune on
  build/seed keeps the common case near 440 MB.
- **Concurrency:** 3 slots + memory gate keeps the box out of swap; 2 is the
  default when a stack is up. Serialized builds (the current exclusive lock) are
  already safe; slots only recover ~25 % throughput during coincidences.
- **The bypass is the bug.** The lock only protects entrypoints that use it;
  `prebuild` enforcement is the load-bearing part of this decision.
- **No daemon.** All state is files in the existing runtime registry; stale
  slots are reclaimed with the primitives already in `locks.ts`.

## Open questions

1. **Worker cap for more slots.** `experimental.cpus: 4` per build should cut
   peak RSS to ~1.5 GB and make 5–6 slots feasible; unmeasured, do not ship
   without the same with/without comparison.
2. **Snapshot refresh policy.** Opportunistic on the first successful `env build`
   on `main` (recommended) vs. a separate `env cache snapshot` command.
3. **Size cap.** 1 GB LRU/rebuild trigger, or prune-only. Current data says
   prune-only is enough; a cap covers pathologically long-lived worktrees.
4. **Queue fairness.** `flock` waiters are approximately ordered; a ticket dir
   is only worth it if starvation is observed in practice.
5. **Re-measure on APFS.** Reflink makes the seed ~free there; this FS is the
   pessimistic case.

## Implementation sketch

- `scripts/env/lib/locks.ts` — `withBuildLock` → `withBuildSlots(n, minFreeMb, fn)`
  (reuse `dirMutex`/`flockMutex`, `pidAlive`, `takeoverStaleDirLock`).
- `scripts/env/lib/build.ts` — acquire the slot around `runProductionBuild`, export
  `STUDIQ_BUILD_SLOT`/token to the child, set `oom_score_adj`, check
  `MemAvailable` before spawn.
- `apps/web/package.json` — `"prebuild": "bun ../../scripts/env/build-guard.ts"`
  (fails fast with slot/queue state; `STUDIQ_BUILD_LOCK=0` opts out).
- New `scripts/env/lib/build-cache.ts` — snapshot write (atomic), seed on
  `spin`/worktree creation, foreign-version prune.
- `scripts/env/commands/status.ts` / `doctor.ts` — slots/queue and cache size.

## Rollback

Delete `<registry>/build-slots` and drop the `prebuild` guard to return to the
single exclusive lock; delete `$STUDIQ_CACHE_DIR` and remove the seed hook to
return to cold builds. Neither rollback affects a build's correctness — the
fingerprint never trusts the cache.

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
