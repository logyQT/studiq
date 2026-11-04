# Audit: what is left of #173 after #984

Date: 2026-11-03
Measured at: `main` = `67a9f11d5b01e304df593a6c14da7a64db2010d3` (`origin/main`)
Supersedes: a first pass measured at `27953562`, before #984 merged.

> **Revision note.** The first version of this audit measured `main` at `27953562` and concluded
> that the strict tier existed only on `chore/strict-lint-first-pass`. That was wrong: #984
> ("refactor(tooling): enforce the strict Bun lint tier", 776 files, +12,654/−7,612) merged at
> **2026-11-03T14:28:04Z**, moving `origin/main` to `67a9f11d`. The branch tip was not an ancestor
> because the PR was squash-merged, which is why a stale ref check looked like "unmerged".
> Every number below was re-measured on `67a9f11d` in a disposable copy. `main` was not modified.

---

## 1. Verdict

**The strict tier has already landed. What remains of #173 is the part that should not be done.**

#984 absorbed the defensible core: `typeAware = true`, `suspicious`, `jsx-a11y`,
`react/button-has-type`, `no-explicit-any`, `maxWarnings = 0`, an empty suppression ledger, typed
Supabase clients, and 776 files of cleanup. Current `main` is green:

| check                      | result                                                 |
| -------------------------- | ------------------------------------------------------ |
| `bun run lint`             | **0 problems in 1,300 files**, 0.96–1.04 s, 831–853 MB |
| `bun run typecheck:all`    | 0 errors, 1.21 s, 390 MB                               |
| `bun run test:unit`        | 200 files / 3,025 tests pass, 8.8 s                    |
| `eslint-suppressions.json` | `{}`                                                   |

So the question is no longer "should we do phase 2". It is: **what, if anything, should be
corrected next?**

My answer: **four cheap corrections now (plus a half-day a11y spot-check), then stop and ship
authz/Stripe.** Do not enable the
`perf` or `style` tiers, do not chase "zero suppressions", and defer the TypeScript-flag ladder.
"Do nothing further" is a legitimate outcome and is close to what I recommend — the only things
I would insist on are documentation truth-up, one duplicate-rule cleanup, and a guard so the
empty suppression ledger cannot silently refill.

What is still unsound from #173:

- **`perf`**: +1,695 warnings today, **3 fixable** (`no-await-in-loop` 704, `react-perf/*` 925).
- **`style`**: **+65,894 warnings**, only 15,385 fixable (23 %), dominated by `one-var` 11,898,
  `sort-keys` 9,752, `no-magic-numbers` 8,420, `vitest/prefer-expect-assertions` 3,228.
- **"Zero suppressions"**: main carries **48 justified inline `eslint-disable` comments**, 16 of
  them at real `any` boundaries (`apps/web/src/lib/api.ts`, `apps/admin/src/lib/api.ts`,
  persisted state, test stubs). That is the correct outcome; the target was never realistic.
- **`maxWarnings = 0` is load-bearing on a Bun quirk**: run `bun lint --no-type-aware` on current
  `main` and it fails with **6,899 `react/react-in-jsx-scope`** warnings. Type-aware mode is what
  suppresses that obsolete rule; if Bun regresses it, the gate goes red for no code change.

Confidence: **high** on the measurements; **high** that perf/style should stay off; **medium** on
the TS-flag timing (it competes with authz/Stripe for the same files).

---

## 2. Current `main` baseline (post-#984)

### 2.1 Gate

```bash
$ bun run lint
✓ No problems in 1300 files [963.59ms]
✓ import path check passed …
✓ migration timestamps unique …
✓ hardcoded URL check passed …
# exit 0; 3 runs: 0.98 s / 1.04 s / 0.99 s lint, 827–853 MB RSS

$ bun run typecheck:all
# 0 errors, 1.21 s, 390 MB

$ bun run test:unit
# Test Files 200 passed, Tests 3025 passed, 8.80 s
```

### 2.2 What #984 changed

From the merged PR body and the squash commit:

- Started at **904 errors / 7,873 warnings** on the pre-#984 `main` (my independent measurement
  of the same config: **926 errors / 7,883 warnings** — the small delta is rule-severity choices
  in the final config).
- Ended at **0 / 0**, with `eslint-suppressions.json` = `{}` and `maxWarnings = 0`.
- Typed the generated `Database` through `createServerClient<Database>` /
  `createClient<Database>` and every injected factory; that surfaced **93 real nullability
  errors**, now fixed.
- Kept `unbound-method` off for `__tests__/**` (82 reports, all the Vitest `expect(obj.method)`
  idiom).
- Left 48 justified inline disables.

### 2.3 Configuration as it stands

```toml
[lint]
typeAware = true
maxWarnings = 0

[lint.categories]
suspicious = "warn"
# comment still says: "perf and then style follow once that is done"
```

Overrides: `no-restricted-imports` off for `packages/**` and `scripts/**`; `oxc/no-barrel-file`
off for package entrypoints; `react-hooks/rules-of-hooks` **and**
`unbound-method` off for `__tests__/**`.

### 2.4 Inline escapes on `main` (48)

| rule                                                | count | judgement                                                                     |
| --------------------------------------------------- | ----: | ----------------------------------------------------------------------------- |
| `@typescript-eslint/no-unsafe-type-assertion`       |    16 | legitimate — HTTP envelopes, persisted state, test doubles                    |
| `react-hooks/exhaustive-effect-dependencies`        |     6 | **removable** — Bun duplicate of `exhaustive-deps`, which is already an error |
| `jsx-a11y/prefer-tag-over-role`                     |     4 | legitimate — Radix wrappers that cannot become the native tag                 |
| `@typescript-eslint/require-await`                  |     4 | legitimate — interface-mandated async                                         |
| `jsx-a11y/no-autofocus`                             |     3 | intentional UX                                                                |
| `import/no-unassigned-import`                       |     3 | intentional side-effect imports                                               |
| `@typescript-eslint/no-unnecessary-type-parameters` |     3 | generic doubles                                                               |
| `react-hooks/memo-dependencies`                     |     2 | Bun-specific rule                                                             |
| others                                              |     7 | `no-danger`, `set-state-in-effect`, a11y, etc.                                |

None of these should be deleted to satisfy a metric. Six of them are worth removing by turning
off one duplicate rule in config (see C2).

---

## 3. What #984 absorbed from #173, and what it deliberately did not

| #173 item                                      | status after #984                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| engine swap (Bun fmt/lint/check)               | landed in #438                                                       |
| `typeAware = true`                             | **landed**                                                           |
| `suspicious` category                          | **landed**                                                           |
| `jsx-a11y` + `button-has-type`                 | **landed** (66 findings resolved)                                    |
| `no-explicit-any` as error                     | **landed** (637 cleared)                                             |
| `no-floating-promises` / `no-misused-promises` | **landed** (118 cleared)                                             |
| `no-unsafe-*`                                  | **landed** (6,955 cleared; tests typed)                              |
| `unbound-method`                               | landed as error in app code, **off for tests**                       |
| empty suppression ledger + `maxWarnings = 0`   | **landed**                                                           |
| `perf` tier                                    | **not landed — correctly**                                           |
| `style` tier                                   | **not landed — correctly**                                           |
| zero inline suppressions                       | **not achieved, and should not be**                                  |
| "start only when QA suite green (#464)"        | **not satisfied** — #464/#926 still open, but the work landed anyway |

The premise was right about type-awareness and a11y. It was wrong about perf, style, and
suppression zero. #984 landed the former and skipped the latter, which is the correct split.

---

## 4. What is left: correction ladder

Legend: **now** = this week, **next** = after authz/Stripe starts, **later** = after the feature
work, **never** = do not enable.

| correction                                                                                                                         | measured cost on current `main`              | value                                          | risk                                                  | call                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| Docs/config truth-up (`docs/plans/bun-native-toolchain.md` still says "phase 2 deferred"; `bunfig` still says perf/style "follow") | 0                                            | prevents the next person re-opening #173       | none                                                  | **now**                     |
| Turn off `react-hooks/exhaustive-effect-dependencies` globally                                                                     | removes 6 inline disables                    | one less duplicate rule                        | none — `exhaustive-deps` stays error                  | **now**                     |
| CI guard that `eslint-suppressions.json` stays `{}`                                                                                | 0                                            | stops silent re-baselining                     | none                                                  | **now**                     |
| Canary policy + upgrade plan                                                                                                       | 0                                            | stable 1.4.4 still has no `bun lint`           | must stay on canary                                   | **now**                     |
| a11y spot-check of the 66 fixes                                                                                                    | ~0.5 day                                     | catches `<fieldset>`/`aria-hidden` regressions | visual/AT drift                                       | **now**                     |
| `perf` category                                                                                                                    | **+1,695 W, 3 fixable**                      | `react-perf` only                              | 704 `no-await-in-loop` are intentional sequential I/O | **never wholesale**         |
| `style` category                                                                                                                   | **+65,894 W, 15,385 fixable**                | none                                           | stylistic rewrite of the repo                         | **never**                   |
| `noUncheckedIndexedAccess`                                                                                                         | **+112 errors**                              | real null-safety                               | per-directory rollout possible                        | **later**                   |
| `exactOptionalPropertyTypes`                                                                                                       | **+126 errors**                              | real, invasive                                 | touches most optional shapes                          | **later**                   |
| `noPropertyAccessFromIndexSignature`                                                                                               | **+237 errors**                              | style only                                     | churn                                                 | **never**                   |
| `noImplicitOverride` / `noFallthroughCasesInSwitch` / `noUnusedLocals` / `noUnusedParameters`                                      | **0 / 0 / 0 / 0**                            | free                                           | —                                                     | **now (free)**              |
| zero inline suppressions                                                                                                           | would delete 16 legitimate boundary disables | none                                           | hides real boundaries                                 | **never**                   |
| `maxWarnings = 0`                                                                                                                  | already on                                   | prevents warning rot                           | depends on type-aware suppressing RIJX                | **keep, document tripwire** |

The free TS flags are genuinely free now: #984's cleanup removed the last five `noUnusedLocals`
errors. Turning them on costs nothing.

---

## 5. Fragility and divergences that still matter

These are not blockers today, but they are the reasons not to tighten further without a reason.

### 5.1 `--type-aware` is load-bearing

```bash
$ bun lint --no-script --no-type-aware apps/web/src apps/admin/src packages __tests__
# exit 1
# rule="react/react-in-jsx-scope" times="6899"
```

`apps/web/tsconfig.json` has `"jsx": "react-jsx"`, so the rule is obsolete. Static mode cannot
see that; type-aware mode drops it. With `maxWarnings = 0`, any Bun regression here turns a green
tree red with no code change. Keep `--type-aware` pinned in the gate and document this.

### 5.2 `--type-aware` activates rules the config says are `off`

On pre-#984 `main`, parity config + `--type-aware` produced 202 errors / 5,808 warnings even
though `no-explicit-any` was off and no type rules were configured. Bun treats `--type-aware` as
a rule preset, not just "types are available". This is why the config had to be written as a
whole, and why a future incremental rule adoption needs testing rather than assumption.

### 5.3 Duplicate rule names

`react-hooks/exhaustive-deps` and `react-hooks/exhaustive-effect-dependencies` both exist; the
latter accounts for 6 of the 48 disables. Similarly `consistent-return` and
`@typescript-eslint/consistent-return` both fire. Pick one of each and turn the other off.

### 5.4 Wildcard plugin toggles

`"jsx-a11y/*" = "error"` is rejected by Bun ("can only be `off`"). Every a11y rule must be named.
That is why the config is long; do not "simplify" it into a wildcard.

### 5.5 Suppression semantics

The ledger is count-based per file+rule, not line-based. Tested on pre-#984 main: adding a 5th
violation fails; fixing one and adding one keeps the count and **hides the new one**; an unused
suppression exits 2 unless `passOnUnprunedSuppressions` is set. With the ledger empty this is
mostly moot, but the CI guard in C3 is what keeps it empty.

---

## 6. Prerequisite status

| item                           | status                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Phase 1 parity                 | done (#438)                                                                               |
| Phase 2 core                   | **done (#984, merged 2026-11-03)**                                                        |
| Stable Bun with `bun lint`     | **not available** — stable 1.4.4 (2026-10-22) lacks it; CI pins `1.4.4-canary.20261027.1` |
| QA coverage gate (#464 / #926) | still open; 170 green / 10 blocked / 33 parked; waived in practice by #984                |
| Docs                           | **stale** — plan says "phase 2 deferred"; bunfig says perf/style "follow"                 |
| Stripe branch                  | **19 commits behind main; 10 files overlap #984**                                         |
| QA env worktrees               | based on old main; small diffs, 0 overlap with #984                                       |

The Stripe rebase is the only concrete conflict created by #984. It is 10 files, not 776, but it
should be done before new Stripe work starts.

---

## 7. Recommended corrections (with gates)

### C1 — Tell the truth in the docs (0.5 day)

- `docs/plans/bun-native-toolchain.md`: change status to "phase 1 and the strict core
  implemented (#438, #984); perf/style deliberately rejected".
- `bunfig.toml`: replace "perf and then style follow once that is done" with an explicit
  decision ("perf/style not adopted; see audit"). A standing invitation is how this gets
  re-litigated in three months.
- `AGENTS.md` tooling section: point at the new status.

Gate: `bun run lint` still green; no config change.

### C2 — Remove the duplicate hook rule (0.1 day)

Add to `bunfig.toml`:

```toml
"react-hooks/exhaustive-effect-dependencies" = "off"
```

Gate: the 6 corresponding `eslint-disable` lines are deleted; `bun run lint` green; total
disables drop 48 → 42.

### C3 — Guard the empty ledger (0.2 day)

Add a check to `bun run lint` (or the `checks` CI job):

```bash
test "$(cat eslint-suppressions.json)" = "{}" || {
  echo "eslint-suppressions.json must stay empty; fix the finding or use a justified inline disable";
  exit 1;
}
```

Gate: deliberately running `--suppress-all` fails the guard.

### C4 — Write down the canary policy (0.2 day)

- Keep the CI pin; add a note in the plan: "`bun lint` is canary-only; revisit when stable ships
  it".
- Do not unpin until the stable probe passes: run `bun lint --no-script --help` from an empty
  temporary directory (inside a repo it resolves the `lint` script), expect exit 0 and
  `Usage: bun lint` — the same probe as `scripts/check-bun-version.ts`. Stable 1.4.4 exits 1 with
  `error: Script not found "lint"`.

Gate: a documented fallback if the pinned canary disappears.

### C5 — Spot-check the a11y rewrites (0.5 day)

#984 changed `role="group"` → `<fieldset>` and added `aria-hidden` to skeleton `<td>`s. Both are
defensible, but `<fieldset>` has UA styling and `aria-hidden` cells change what screen readers
announce. Check the admin stats page and the results skeleton in the browser, one pass.

Gate: visual diff clean; no new axe violations if axe is run.

### C6 — TypeScript flags (later; 6–10 days if ever)

Do the free four now (`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
`noUnusedParameters` — all 0 errors). Then, after authz/Stripe, do `noUncheckedIndexedAccess`
(+112) per directory, then decide on `exactOptionalPropertyTypes` (+126). Never
`noPropertyAccessFromIndexSignature` (+237).

Gate per flag: `bun run typecheck:all` 0 errors; `bun run test:unit` green.

### Do not do

- `perf` or `style` categories.
- A "zero suppressions" policy.
- `noPropertyAccessFromIndexSignature` or `exactOptionalPropertyTypes` before a dedicated
  migration.
- Any change that assumes `--no-type-aware` is a supported gate.

---

## 8. Alternatives, including doing nothing

| option                                                  | assessment                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Do nothing further**                                  | **Defensible and close to recommended.** The core landed and is green. The only cost is stale docs and 6 removable disables. |
| Three cheap corrections (C1–C4), then ship authz/Stripe | **Recommended.** ~1 day total, no product risk.                                                                              |
| Add TS flags now                                        | **No.** +238 errors across two flags; competes with authz/Stripe for the same files.                                         |
| Enable `perf`                                           | **No.** 1,695 warnings, 3 fixable, mostly intentional sequential I/O.                                                        |
| Enable `style`                                          | **No.** 65,894 warnings; a stylistic rewrite disguised as a gate.                                                            |
| Chase zero suppressions                                 | **No.** Would delete 16 legitimate boundary disables.                                                                        |
| Keep a hybrid ESLint/oxlint lane                        | **No need.** The Bun gate is under a second and green; revisit only if Bun regresses.                                        |

### If starting today

1. Merge nothing else for strictness — it is already merged.
2. Do C1–C4 (about a day).
3. Rebase `experimental/stripe-integration` onto `67a9f11d` (10 overlapping files) before
   starting new Stripe work.
4. Start authz on the new baseline; `authz.ts` is already typed and its 14 findings are gone.
5. Revisit TS flags after the feature work, with per-directory measurements.

### Engineer-day estimate

| work                                | estimate      |
| ----------------------------------- | ------------- |
| C1 docs/config                      | 0.5           |
| C2 duplicate rule                   | 0.1           |
| C3 ledger guard                     | 0.2           |
| C4 canary policy                    | 0.2           |
| C5 a11y spot-check                  | 0.5           |
| **Total corrections**               | **~1.5 days** |
| `noUncheckedIndexedAccess` (+112)   | 3–5 days      |
| `exactOptionalPropertyTypes` (+126) | 3–5 days      |

### Conflict risk

- **Stripe**: 19 commits behind, 10 files overlap #984. Rebase first; conflicts are localized to
  checkout/pricing/stripe controller + 2 QA specs.
- **QA env worktrees**: 0 overlap; their branches are already merged or tiny.
- **Authz**: `authz.ts` and `with-auth.ts` were changed by #984 (85 + 14 lines), but the work is
  done; new authz work branches from the new main, which is the right base.

---

## 9. Open questions / what would change this verdict

1. **Do you want the TypeScript flags at all?** They are the only meaningful strictness left.
   If yes, `noUncheckedIndexedAccess` is the one worth buying; `noPropertyAccessFromIndexSignature`
   is not.
2. **Is `eslint-suppressions.json` meant to stay empty forever, or is it a release valve?** If a
   release valve, C3 should allow a reviewed budget instead of hard-failing.
3. **When does stable Bun ship `bun lint`?** Until then the gate depends on a canary and on the
   type-aware suppression of `react-in-jsx-scope`.
4. **Was the QA gate (#464) formally waived?** #984 landed while the gate was open. If the gate
   still matters, say so now; otherwise close it as superseded.
5. **Do you want the a11y rewrites kept?** `<fieldset>` and `aria-hidden` skeleton cells are
   defensible but were chosen to satisfy a linter, not a design review.

What would change my mind:

- A Bun release that fixes the static/type-aware divergence → the `maxWarnings = 0` tripwire
  becomes safe, and broader rule adoption gets cheaper.
- A business reason for `noUncheckedIndexedAccess` (e.g. authz/Stripe touching index-heavy code)
  → move it from "later" to "next".
- Evidence that the `<fieldset>`/`aria-hidden` changes harm AT or layout → revert them and
  suppress the a11y rule with a reason instead.

---

## Appendix A — reproduction log (post-#984)

```bash
REV=67a9f11d5b01e304df593a6c14da7a64db2010d3   # exact revision measured
WORK=$(mktemp -d)                              # fresh directory per measurement
git archive "$REV" | tar -x -C "$WORK"
cd "$WORK" && bun install --frozen-lockfile

bun run lint
# ✓ No problems in 1300 files [963.59ms], exit 0
# 3 runs: 0.98 / 1.04 / 0.99 s, 827–853 MB

bun run typecheck:all      # 0 errors, 1.21 s, 390 MB
bun run test:unit          # 200 files, 3025 tests, 8.80 s

# fragility
bun lint --no-script --no-type-aware apps/web/src apps/admin/src packages __tests__
# exit 1, rule="react/react-in-jsx-scope" times="6899"

# perf lane (bunfig + perf = "warn")
bun lint --no-script -f json -o perf.json apps/web/src apps/admin/src packages __tests__
# 1,695 warnings, 3 fixable

# style lane (bunfig + style = "warn")
bun lint --no-script -f json -o style.json apps/web/src apps/admin/src packages __tests__
# 65,894 warnings, 15,385 fixable

# TS flags, clean install, baseline 0
# noUncheckedIndexedAccess +112
# exactOptionalPropertyTypes +126
# noPropertyAccessFromIndexSignature +237
# noImplicitOverride / noFallthroughCasesInSwitch / noUnusedLocals / noUnusedParameters 0

# escapes
grep -rn "eslint-disable" --include='*.ts' --include='*.tsx' apps packages __tests__ | wc -l
# 48

cat eslint-suppressions.json    # {}
```

## Appendix B — historical pre-#984 numbers (for comparison with #173)

Measured on `27953562` with #173's proposed config, before #984:

| lane                    | errors | warnings |        time |     RSS |
| ----------------------- | -----: | -------: | ----------: | ------: |
| phase-1 parity          |      0 |        2 | 0.32–0.48 s | ~520 MB |
| #173 config, static     |    724 |    7,451 |      0.10 s |  187 MB |
| #173 config, type-aware |    926 |    7,883 |      0.82 s |  810 MB |
| + perf                  |    926 |    9,587 |      0.81 s |  822 MB |
| + style                 |    926 |   73,123 |      0.87 s |  824 MB |

Those findings are the ones #984 resolved. They are kept here only so the original premise can
be compared against what actually landed.
