---
name: studiq-qa-case
description: "Design, write, prove and prune a StudiQ QA case — the Playwright spec in `__tests__/qa`, its tenant profile, and the case text in `qa/cases`. Use when asked to automate a QA case, add a spec for a case ID, decide whether a case is worth automating, audit a spec that may be tautological, mutate a spec to prove it can fail, or rewrite/prune a weak one. Companion to `studiq-qa` (runs the app and files defects) and `studiq-review` (verifies a PR)."
metadata:
  version: "0.1.0"
---

# StudiQ QA case

Repo-owned skill for the **durable** half of QA: turning a case into a spec that
can actually fail, and retiring the ones that cannot. `studiq-qa` finds defects
in a running app; this skill decides what deserves a regression guard and proves
the guard works. Nothing here is report-only — you do write the spec, the
profile and the case edit.

Absent from `skills-lock.json`; edit it like any repo file.

## The rule everything else serves

> A spec earns its place only if a **plausible production change** turns it red.

A case that cannot name such a change is not a test, it is a screenshot with a
runner attached. The repo already treats tautology as a defect shape
([`AGENTS.md`](../../../AGENTS.md#tautology-is-harmful)); a QA spec is the most
expensive place to keep one, because it also costs a tenant, a shard slot and a
future reviewer's trust. So every spec you write carries, in its docblock, the
mutation you will run to prove it — and you run it before you open the PR.

## Step 0 — is this case worth a spec at all?

Answer three questions before writing anything. If any answer is "nothing", stop
and park the case (see [Parking](#parking-a-case)) instead of writing code.

| question                                              | a real answer looks like                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| What would a user notice if this broke?               | "the deck list shows another org's deck", "grading silently drops the toast" |
| Which production change would break it?               | a permission check, a redirect rule, a `select()` list, a limit counter       |
| What does the spec read that the UI did not hand it?  | a persisted row, another role's view, an API response, a computed count       |

The third question is the one that catches tautology: a spec that types
"Matematyka" and then asserts "Matematyka" proves the browser has a keyboard.

### Tautology smells

- **Label == label.** `getByPlaceholder(x)` then `expect(placeholder).toBe(x)`.
  The case's own copy asserted against the same copy.
- **A toast with no failure mode.** "Saved" appears after a save that cannot
  fail in the seeded state — nothing is at risk, nothing can regress.
- **Counting what you just created in the same UI pass.** "3 cards" asserted by
  reading the list you just typed into, when the case is about persistence.
  Assert after a reload, or read the row.
- **Navigation as the whole assertion.** `expect(page).toHaveURL(...)` on a link
  the case describes as "opens X" — the interesting part is what X must refuse
  or load.
- **A step with no consequence.** Every step in the case must leave an
  observable trace, or it is scenery. If deleting the step keeps the spec green,
  the step was never tested.
- **The app compared against itself.** Resolving copy from
  `apps/web/src/i18n/messages/*.json` to assert a label — the only exception is
  the NFR-01/NFR-02 parity sweep, where catalogue agreement *is* the subject.

A case that survives Step 0 without a real answer is either **manual** (see
[Parking](#parking-a-case)) or **wrong** (spec drift — file it, do not encode
it).

## The three artifacts

| artifact                        | path                                | owns                                                    |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| **case**                        | `qa/cases/<ID>.md`                  | the intent, in Polish, generated from the tester doc    |
| **spec**                        | `__tests__/qa/<AREA>/<ID>.spec.ts`  | the assertion; `test.describe('@case:<ID> @area:… …')`  |
| **tenant profile**              | `__tests__/qa/profiles/<ID>.json`   | the tenant shape CI seeds before the run                |

`qa/` is docs-only; the harness lives under `__tests__/qa/`. Coverage state for
every case is tracked in `#926`; the technique classification (e2e / api /
manual) is [`qa/coverage.md`](../../../qa/coverage.md).

## Step 1 — read the case, then the product

1. `qa/index.md` → the case's priority and `prereqs`; `qa/cases/<ID>.md` → steps
   and the embedded prerequisite chain. Read every referenced case.
2. The case text is **generated** from the tester document: never hand-edit the
   steps or the expected result. The one legal edit is reconciling the
   `Prereqs`/`Seed` block with the tenant model (the legacy `student1@dev.local`
   accounts are not used).
3. Read the code the case exercises. Without it you cannot answer Step 0's
   second question, and you cannot tell a defect from a case that describes a
   product you do not ship (`STU-25`, `#893`).
4. If the case contradicts settled product intent — a removed feature, a design
   decision recorded in an ADR or an issue — **do not** automate it. File the
   drift, or correct the case, and say so in the PR.

## Step 2 — shape the tenant

One case, one tenant, no shared state. CI seeds it from
`__tests__/qa/profiles/<ID>.json` before the suite starts; the spec reads it
through `loadTenant()` and never creates accounts itself.

```jsonc
// the default: org + manager/teacher/student + a default group
{ "profile": "content", "plan": "hub" }

// first-run onboarding: one staff account, no org, no group
{ "profile": "bare", "role": "manager" }

// one seat below capacity, with two accounts that are not members
{ "profile": "org-limit" }

// one manager administering two organizations
{ "profile": "two-org" }
```

Declarative extras, no per-case code: `members` (explicit roster with a per-account
org role), `groups` (first is the default), `solo` (an account in no org), `orgs`
(several orgs, each with its own owner). `plan` applies through the same
`apply_org_plan` RPC the billing webhook uses, so a paid entitlement stays inside
the case's own tenant instead of leaning on the global catalogue.

Seed it:

```bash
bun scripts/qa-tenant.ts STU-21                    # base + 3 attempts (CI's retries)
bun scripts/qa-tenant.ts STU-21 --fresh --attempts 1 --repeats 1   # quick local loop
bun scripts/qa-tenant.ts STU-21 --profile bare --role manager --fresh
```

The spec must derive **every** id from the tenant (`tenantId(tenant.key, …)`), not
from a hard-coded UUID or a shared org/group name. Environment-wide rows —
`plan_limits`, feature flags, platform settings, the plan catalogue, singletons —
are off limits: if a case needs one, it is `test.describe.serial` on a dedicated
stack (`--dedicated`) or it parks.

## Step 3 — walk it before you write it

Run the case as a tester in the app (`bun run env:ensure --profile web`, agents
never `next dev`) and record the real screens, copy, selectors and states. You
cannot encode behaviour you have not seen; a spec written from the case text
alone asserts the author's imagination.

If the walk shows the product **not** doing what the case says, stop:

- a plain defect → file it with `studiq-qa`'s evidence rules and leave **no**
  placeholder spec;
- an ambiguous expectation → file it with `needs-design` and the options;
- a settled product decision → correct the case, do not automate the ghost.

A failing, skipped or "expected to fail" spec is never the answer. CI has no
budget for a red test that means "we know".

## Step 4 — write the spec

```ts
import { expect, test } from '@playwright/test';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * <ID> — <case title>.
 *
 * Case: <the steps and the expected result, condensed>.
 *
 * Tenant: `content`, seeded by the profile file:
 *   bun scripts/qa-tenant.ts <ID> --fresh
 *
 * Walk (<date>, <branch> @ <sha>): <what the app actually does, in the order the
 * case does it — including anything that contradicts the case text>.
 *
 * Mutation (proves this spec can fail): <the production change you break, and the
 * assertion that turns red>. Result: <what it printed>.
 */

const CASE = '<ID>';

test.describe('@case:<ID> @area:<AREA> @prio:<Pn> <short title>', () => {
  test('<the one behaviour, in the user's words>', async ({ page }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    // …click the real path…
    // …assert the outcome the case exists to protect…
  });
});
```

Rules that the gates and reviewers actually enforce:

- **Locators**: roles, accessible names and `data-slot` — never the case's own
  copy as a selector. Radix triggers need a real pointer press
  (`button: 'left'`, or the app's own control), not a JS `.click()`.
- **Copy**: assert the **literal** string the case specifies (usually Polish).
  Do not resolve it from the app's i18n catalogue — that compares the app with
  itself and cannot catch a missing translation (`NFR-01`). Hard-coded copy in a
  spec is not a finding on its own.
- **Waits**: the shared 3 s action / assertion budget and 6 s navigation budget
  from `playwright/base.ts`. Override a single call with a comment when the
  behaviour genuinely needs longer (autosave debounce, `expect.poll` across
  several round trips). Never a fixed sleep.
- **Assert after the write settles**: a one-shot read taken right after a save
  races the refetch. Use a retrying web-first matcher, and reload or
  SPA-navigate to prove persistence — a toast and a 200 are not proof.
- **Read the row, not just the pixels** when the case is about persistence,
  scoping or limits: `__tests__/helpers/db-admin.ts` (service-role) reads the
  case's own rows; `qaDbNow()` gives the DB clock for "created since" checks.
- **No `test.skip`, `test.fixme`, `test.soft`, `test.only`, or expected-failure
  wrappers.** The only legitimate skip is the temporary stack-mode guard
  (`skipBrandedAuthTemplateTest`), which is a named workaround with an exit.
- **One case per file**, `@case:<ID>` in the `describe` title, so a shard's
  report names the case that failed.

## Step 5 — prove it can fail (the mutation gate)

Green means nothing until you have seen it red **for the right reason**. Do both
axes, in a throwaway commit or with `git stash`, one mutation at a time:

| axis           | mutation                                                     | must go red                     |
| -------------- | ------------------------------------------------------------ | ------------------------------- |
| **product**    | break what the case protects — drop the ownership filter, the permission check, the redirect rule, a field from the `select()` | the spec, on the assertion that names that behaviour |
| **test**       | delete the step that does the work, or the assertion that proves it | the spec — otherwise the step was scenery |

The app under test is a production build, so a server mutation needs a rebuild
before the spec can see it:

```bash
# mutate apps/web/src/… or packages/server/src/…
bun run env:down && bun run env:build && bun run env:serve
bun run test:qa __tests__/qa/<AREA>/<ID>.spec.ts
git checkout -- <mutated paths>              # restore
bun run env:down && bun run env:build && bun run env:serve   # then confirm green
```

Record in the spec docblock and the PR body: **what you broke, which assertion
went red, and the message it printed.** "Mutation applied, spec failed" without
the message is not proof — a spec can also fail on a login timeout.

Two extra checks while you are there:

- **Cross-role**: the same URL as a role that must not see it (`403`/redirect,
  never data) is often the assertion that makes an isolation case real.
- **Anti-flake**: the spec passes twice in a row from a fresh tenant before you
  move on; a spec that only passes on the first attempt is a bug report for the
  harness, not a suite entry.

## Step 6 — prove it survives a retry

CI runs `retries: 2` against one seed, and a retry restarts the worker. The
harness gives every attempt its own tenant (`qa/.tenants/<ID>.r<repeat>e<retry>.json`,
read by `loadTenant()`), so the spec only has to avoid freezing attempt 0:

- never snapshot the tenant at module scope — `loadTenant()` returns a lazy view,
  but `const RUN = tenant.runSuffix` inside it freezes attempt 0; resolve values
  inside the test or a hook;
- attempt-specific setup goes in `beforeEach`, never `beforeAll` (a retry re-runs
  `beforeAll` with the retried attempt and leaves that state for the next test);
- a mutating spec either resets its own rows at attempt start
  (`resetInviteeState`, `resetFirstRunTenant` with a `qaDbNow()` cutoff) or is
  not retry-safe;
- prove it: fail attempt 0 on purpose (temporary probe, never committed) with
  `--retries=1` and expect **one flaky** — the retry passing against its own
  attempt file is the proof:

```bash
QA_RETRY_PROBE=1 CI=1 bunx playwright test -c __tests__/qa/playwright.qa.config.ts \
  __tests__/qa/<AREA>/<ID>.spec.ts --retries=1
```

`--repeat-each=2` is **not** this check: repeats re-seed and re-run hooks, so they
never exercise a retry.

## Step 7 — admit it

An entry needs all of:

1. **5/5 green** independent runs, each with a fresh tenant/run suffix — every
   flake is seen locally, so local retries stay `0` (`playwright.qa.config.ts`);
2. no skip/fixme/soft/expected-failure, no `test.only`;
3. no legacy `@dev.local` accounts and no `pass` passwords — tenant users only;
4. every id derived from the tenant; no shared mutable global;
5. the behaviour confirmed by a walk, not inferred from the case text;
6. the **mutation proof** above, with the message quoted;
7. a retry-isolation probe for anything that writes.

The PR carries: the spec, the profile file, the reconciled `Prereqs`/`Seed` in the
case, and the mutation + 5/5 evidence in the body. Branch `qa/<ID>` or
`test/qa-<ID>`, PR into `main`. Scope it to one case (plus a shared helper if the
case genuinely needs one) — a shared-helper change that restyles every spec is a
separate PR.

AI cases (`EDU-DECK-05`, `SEC-07`, `STU-09`, `STU-45`, `STU-49`, and the shipped
`STU-47`/`STU-48`) run in the `ai-suite` job against the fake inference server
(`scripts/fake-llm`, [`docs/ai/fake-inference-server.md`](../../../docs/ai/fake-inference-server.md)),
one worker, with `LLM_PROVIDER=fake`. Their mutation axis is usually the app's
handling of bad model output, which the fixtures make deterministic: never call a
real provider from a spec, and never assert model-side detail the app does not
control.

## Auditing and pruning existing specs

Apply Step 0 and Step 5 to a spec you did not write, in this order:

1. **Read the case first.** If no plausible production change turns the spec red,
   it is a prune candidate — do not "improve" assertions that assert nothing.
2. **Run the mutation.** A green spec under a broken product is the finding.
3. **Decide**, and write the decision down:
   - **Rewrite** to the consequence the case exists to protect (this is most of
     the work: the case is fine, the assertion drifted to chrome);
   - **Park** the case as manual with the reason (see below);
   - **Delete** the spec when the case is drift (`#893`: a retired feature must
     not be frozen into the suite).
4. **Never** replace a weak spec with the same assertion plus a comment. A
   comment is not a guard.

When you prune, say what you removed and what now owns that behaviour — an issue,
a manual checklist row, or a different spec. Deleting coverage silently is a
defect.

## Parking a case

Manual is a real verdict, not a shrug. Park when no assertion is possible without
machinery we deliberately do not own in the merge gate:

| reason                                  | example                                   |
| --------------------------------------- | ----------------------------------------- |
| print/PDF pipeline                      | `EDU-ASG-10`                              |
| CDP network emulation                   | `EDU-QZ-04`, `NFR-06`                     |
| visual judgement across a theme sweep   | `NFR-03`                                  |
| keyboard-only focus-order judgement     | `NFR-05`                                  |
| a relation **between** browsers         | `NFR-08` (the suite is chromium-only)     |
| a case that needs an input only a human has | `STU-49`'s PDF, `MGR-SET-02`'s logo   |

Record it in [`qa/coverage.md`](../../../qa/coverage.md) (owner `manual` + the
one-line reason) and in `#926`. A parked case keeps its file; a parked bug does
not keep a red test.

## Commands

```bash
bun run env:ensure --profile web                 # this checkout's app + stack
bun scripts/qa-tenant.ts <ID> --fresh            # seed one case (3 attempts)
bun run test:qa __tests__/qa/<AREA>/<ID>.spec.ts # run it
bun run test:qa __tests__/qa/<AREA>              # one area
bun run mock:llm                                 # fake inference, for AI cases
bun run env:build                                # only for the mutation loop
bun run review:static -- --changed origin/main   # tautology rules on the diff
```

CI runs four shards by area (`edu`, `stu`, `mgr-sec-bil`,
`aut-nfr-onb-pub-lim`), path-scoped per PR and all four nightly, plus `ai-suite`.
Each shard seeds only its own areas
(`bun scripts/qa-tenant.ts --all --areas … --run ci<id>`) before Playwright
starts, at `QA_WORKERS=4`.

## Anti-patterns (each one is a review finding)

- A spec whose assertion would pass against an empty page.
- A docblock that narrates the diff ("added X", "removed Y") instead of the
  constraint — git history is the changelog.
- A helper extracted for a single spec; a shared helper change smuggled into a
  case PR.
- Copy asserted from the i18n catalogue outside the parity sweep.
- `expect.poll`, a reload or a `waitForTimeout` used to paper over a missing
  state instead of asserting it.
- A manual case that quietly gained an automated twin asserting less than its
  own steps.
- A "smoke" spec that re-asserts what `checks`, `unit` or the e2e suite already
  pin — the layer that owns the behaviour should fail, not two layers at once.
