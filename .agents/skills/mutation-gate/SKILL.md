---
name: mutation-gate
description: 'Prove that a test can fail before trusting it: break the code the test claims to guard, watch the named test go red, revert. Use when writing, adding or strengthening a test ("prove this test can fail", "write a test for this fix", "is this assertion real", "an assertion that cannot fail"), when reviewing a PR that claims a fix is pinned, covered or tested, when pruning a test suite, or when asked whether something is mutation-tested. Catches the defect where a test stays green when the code it guards is deleted.'
---

# Mutation gate

One operation, three intents. You break the production line a test claims to
guard, run that test alone, and read the outcome:

| intent          | who runs it                  | a green run means                                               | the action                                    |
| --------------- | ---------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| **authoring**   | whoever writes the test      | the assertion does not reach the behaviour — the test is a claim | strengthen it before committing               |
| **review-gating** | whoever reviews the PR     | the fix is **unproven**; the PR must not merge on that test      | request changes, or add the mutation as a test |
| **pruning**     | whoever prunes the suite     | the test is spending; it can be deleted or made specific         | `DELETE` / `FIX` / `TRIM`                     |

They are the same primitive with different verdicts. **Authoring is the cheapest
place to run it**: the regression is already in your head when you write the
assertion, and a test you proved while writing it never needs to be pruned.
Review-gating catches what authoring missed; pruning collects the debt. A suite
that only ever runs it at review time pays for every gap twice.

The failure mode this exists to catch, in one line: **a test that stays green
when the code it guards is deleted.**

## The tool

`bun scripts/mutate.ts` does the mechanical half — clean-tree refusal, one exact
edit, one named test, `git checkout --` in a `finally`, clean-tree verification,
NDJSON for a PR table.

```bash
bun run mutate -- --file scripts/env/lib/app-port.ts \
  --find "if (!(await acquireClaim(input, port))) {" \
  --replace "if (false) {" \
  --test __tests__/unit/env/app-port.test.ts \
  --name "moves to the next candidate when another checkout holds the claim"

# a PR's mutation table, re-runnable from the body
bun run mutate -- --spec .tmp/mutations.json --json

# what a PR body quotes: one line per mutation
{"file":"…","find":"…","test":"…","title":"…","outcome":"KILLED","executed":1,"detail":"AssertionError: expected 3001 to be 3002"}
```

- `outcome` is `KILLED` (the test caught it), `SURVIVED` (it did not), or
  `ERROR` (**never proof** — see the trap below). `executed` counts the tests
  that actually ran in the run that decided the outcome.
- `--json` writes NDJSON on stdout and progress on stderr, so the table is
  pasteable. Exit is non-zero when any mutation is `ERROR`, so CI can gate on a
  broken harness.
- `--all` mutates every occurrence of `--find`; without it, an ambiguous match is
  a usage error rather than a guess.
- `--keep` leaves the mutation applied for inspection. Human-only, single
  mutation only, and it leaves the tree dirty on purpose — which is why it also
  skips the post-kill flake re-run.
- The tool refuses to mutate anything under `__tests__/` or named `*.test.ts` /
  `*.spec.ts`: removing an assertion is a `TRIM`, which belongs to whoever owns
  the suite, not to a mutator.
- The mutated file must be **tracked by git**. An ignored or untracked file has no
  pre-image, so a mutation there could never be reverted (and `git status` cannot
  even see it) — the tool refuses before writing, with a message that says why.
- Every revert is proved: the `git checkout --` exit code **and** a diff of that
  path, then the whole tree. A failure is `ERROR` / `REVERT FAILED`, never
  `revert: clean`. A path outside the worktree (lexically or through a symlink)
  is refused before anything is written.
- It runs the named test **once before mutating** (the baseline), so a red test or
  a mistyped title is `ERROR` rather than a false kill or a false survivor, and
  **once more after a `KILLED`** (unmutated): a test that is red without the
  mutation is a flake, and a flake manufactures a kill. Budget three runs per
  kill.
- `--spec` reads its JSON from a committed file, a git-ignored one (`.tmp/`) or
  outside the worktree: an untracked spec makes the tree dirty, and a dirty tree
  is refused. A row that comes back `ERROR` does not stop the table; a row whose
  `--find` is malformed does, because the table itself is wrong. A table stopped
  by a failed revert still emits a line per remaining row ("not run").

**The trap, stated once.** `vitest run <file> -t "<title>"` where the title
matches nothing **exits 0** and reports the test as *skipped*. Two harnesses in
the ADR-0014 arc read "no test ran" as "mutant survived" — and a mistyped title
is the first thing an author types. `scripts/mutate.ts` classifies on
`numPassedTests + numFailedTests`, never the exit code, and a run with zero
executed tests is `ERROR` / `no test matched`, never `SURVIVED`. If you hand-roll
a run instead of using the tool, you own that trap.

## When to run it

- **Before you finish a test** that claims to guard behaviour: a fix, a guard, a
  validation branch, an ordering. One mutation per new assertion is enough; the
  whole suite does not need it.
- **Any PR that claims** "this is now pinned / covered / tested / regression-
  proofed". "Tests added" is not a claim; "deleting this line turns this test
  red" is.
- **Any fix to a guard, an ordering, or an ordering-sensitive line** (a `finally`,
  a release, a `checkout`, an admission decision). These are exactly the lines a
  test suite quietly stops noticing.
- **A pruning pass**, per candidate, one at a time.

Do **not** run it to "raise coverage", on a pure refactor with no behavioural
claim, or on a test that is already red.

## Recipes — what to break for what claim

Break the smallest thing that should be load-bearing, in the direction of the
bug the test claims to catch. One line is the target.

| the claim is about      | the mutation                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| a guard / validation    | delete the guard — the canonical one: `if (!ok) return failure(…)` → nothing   |
| a branch               | invert the condition, or make the branch body unreachable                     |
| an awaited side effect  | drop the `await` (or the call) and let the promise float                      |
| cleanup / release       | delete the `finally`, or move the release past the work it must follow         |
| ordering                | move the ordering-sensitive line past its dependency                           |
| a written record        | delete one field from the payload, or swap two fields                          |
| an early return         | return before the write instead of after it                                    |
| an error reason         | swap the reason/status string for another one the code can produce             |
| a limit / cap           | raise the bound by one, or drop the clamp                                      |
| an allowlist / filter   | widen it (`includes` → `true`), or narrow it by one entry                      |

Two that pay for themselves repeatedly: **delete the guard and see which test
dies**, and **swap the reason string** — a test that only checks "it failed"
survives the second one, and that is the same test that will not tell a reviewer
why a future failure happened.

## Judgement — a kill must die for the named reason

`KILLED` is necessary, not sufficient. The test must fail **on the assertion the
mutation targets**, not somewhere upstream:

- Read the `detail` line (`scripts/mutate.ts` quotes the first failure message).
  `expected 6 to be 0` on a status-code assertion is the kill you wanted; a
  `TypeError` from a fixture that no longer imports is not.
- **A flake must not read as a kill.** `scripts/mutate.ts` re-runs the named test
  unmutated after a `KILLED`; a red re-run is `ERROR` / `flake suspected`. If you
  hand-roll a run, you own that check: a test that is red without the mutation
  proves nothing about the mutation.
- If you cannot attribute the failure, re-run the *unmutated* test, confirm it is
  green, and treat the mutation as `ERROR`. **An error is never proof** — not a
  compile error, not a missing module, not a timeout, not a database that was
  down.
- A mutation that produces a load/compile failure is `ERROR` unless you can say
  exactly why that failure is the regression. The tool errs on `ERROR` on
  purpose; do not talk it out of that.
- `SURVIVED` under **review-gating** is a finding, not a footnote: either the
  assertion is missing or the test is testing a mock. Say which.

## Hard rules

1. **Never edit `__tests__/`** to make a mutation work — the one exception is
   removing the single named assertion on a `TRIM` candidate, done by whoever
   owns the suite. A mutator that edits tests is grading its own work.
2. **One mutation, one run, one revert.** Never batch two breaks; you lose the
   attribution and the revert.
3. **The tree is clean before and after.** `git status --porcelain` empty at both
   ends. `scripts/mutate.ts` enforces it; a hand-rolled probe must too.
4. **An error is never proof**, and **`-t` matching nothing is `ERROR`, never
   `SURVIVED`.**
5. **Only the named test runs.** A whole-file or whole-suite run tells you the
   mutant died, not which test killed it.

## Pruning verdicts (the mutator's contract)

For each candidate the coordinator hands you, emit one verdict:

| verdict  | meaning                                                                     |
| -------- | --------------------------------------------------------------------------- |
| `KEEP`   | a plausible regression turns it red — the test is defended                   |
| `DELETE` | every plausible regression leaves it green, and nothing else covers the path |
| `FIX`    | it should catch the regression but does not; add the assertion that does     |
| `TRIM`   | a dominated assertion inside an otherwise defended test; drop that one line  |

`DELETE` must name the mutation the test survives — "tautological" alone is not a
reason. `FIX` must name the assertion that goes red once added. When two tests
cover the same path, prove the survivor catches the mutation before deleting the
other; a duplicate is cheap, a hole is not.

## Worked example — the ADR-0014 arc

The arc's mutation tables kept finding guards that looked covered and were not.
Each row below is one line of production code, the mutation, and the test that
should have died but did not — #1316, #1317 and #1362:

| #    | mutation                                                                                  | what happened                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| #1362 | delete `if (workDir === tmpRoot) refuse()`                                                | green: the fixture put the checkout *inside* `<tmp>`, so the "contains this checkout" guard refused first. In production (`/workspaces` vs `/tmp`) this was **the only check between `--work-dir /tmp` and `rm -rf /tmp`** |
| #1362 | delete the empty-value guard (`--work-dir=`)                                              | green: the test asserted only `.ok === false`, and `resolve('')` → repo root tripped a different guard; the tool would have deleted the cwd |
| #1362 | delete the inside-checkout guard                                                          | no test existed at all                                                                                                            |
| #1316 | move `invalidateBuildArtifact()` past the slot release (M4a/M5b)                          | 27/27 green: the old test watched state from this process's callback, equally true after the release                              |
| #1316 | write `.dev/build.json` before the failure throws (M2)                                    | no test: "write back only on success" was asserted in the PR body, not in code                                                    |
| #1317 | delete the "cache root already exists" guard (M5)                                         | green: the test asserted the refusal, not its reason — a *different* refusal satisfied it                                         |
| #1317 | pass `snapshot: web` into the build options (M6)                                          | 13/13 green: `toEqual` had been weakened to `toMatchObject`, so the field was no longer read by any assertion                     |

The fixes were not "more tests". They were **stronger assertions on tests that
already existed** (the reason string, the exact options object, the corpse that
proves the hook ran after the invalidation), plus a fixture that stops shadowing
the guard it is meant to exercise. That is what an authoring-time mutation would
have produced for free.

The same arc is where the harness trap bit twice: two hand-rolled harnesses
classified `vitest run -t "<title>"` by its exit code, so a title that matched
nothing read as a survivor until a reviewer happened to test the tooling. None of
the harnesses could be audited afterwards: #1316's receipt notes that its script
was "kept out of the commit". Hence `scripts/mutate.ts`.

## What it does not prove

- It does not prove the test is the **right** test — a kill on an assertion about
  a mock is a kill about the mock.
- It does not cover behaviour the mutation cannot express (a race, an integration
  path, a browser-only path). `studiq-qa` and `studiq-qa-case` own that axis; the
  two skills share one method, so a QA spec's mutation and a unit test's mutation
  should read the same way.
- One kill is one data point. A suite is defended when its **guards** have kills,
  not when every line has one.
