# E2E campaign — one spec per QA case

> **Status: parked.** This starts after the open-issue backlog is closed, and it is the
> second prerequisite for the lint-debt work in #173. Tracking issue: #464. Case triage:
> [`qa/coverage.md`](../qa/coverage.md).

The goal is a regression net strong enough that paying down the lint debt cannot quietly
break a product flow: every case in [`qa/cases/`](../qa/cases) gets a test that proves it.

## Scope

The suite lives in this repo and runs on `main` — `__tests__/e2e/cases/<ID>.spec.ts`, plain
Playwright, nothing QA-specific. The QA environments (`qa-env-N`) are for exploratory,
agent-driven QA and for the semantic cases below; they do not host the suite, and there is no
separate QA test runner.

## Isolation: one test, one tenant

Every test provisions, in `beforeEach`:

- **its own organization** (`case-<ID>-<rand>`),
- **its own accounts** — manager / educator / student as the case needs — through the
  Supabase Admin API with `email_confirm: true`, so there is no mail round-trip,
- **its own fixture graph** inside that org: groups, roles, members, decks, banks, questions,
  quizzes, assignments.

Teardown deletes the org (cascade). Nothing is shared between tests, which is why specs may
run in any order at any worker count.

**The invariant:** if two tests can observe each other's data, that is a cross-tenant leak —
a **P0 defect, not a flaky test**. `assertTenantIsolation()` encodes it for the SEC cases, and
any suite-wide failure that smells like interference gets triaged as a product bug before the
test is touched.

## Seeds come from the code

Fixture builders import the real shapes (`@studiq/server/models/*`, the generated `Database`
types) and build typed inserts, so a model or schema change breaks the fixtures at compile
time instead of drifting silently. Specs may not hardcode seeded UUIDs or dev accounts; the
only fixed values are product constants (plan keys, permission scope names).

## Fixtures (target API)

| helper | purpose |
|---|---|
| `tenant` (via `test.extend`) | org + accounts + login state for the test |
| `loginAs('manager' \| 'teacher' \| 'student')` | storage state for this test's account |
| `makeDeck()`, `makeBank()`, `makeQuestion()`, `makeQuiz()`, `makeAssignment()` | API-seeded graph |
| `mailbox()` | Inbucket token/link extraction (signup + invite cases) |
| `stripeMock()`, `aiMock()`, `clock()` | the other three flakiness sources |
| `assertTenantIsolation(a, b)` | asserts 403/404 across tenants |

## Spec contract

- one file per case, `test.describe('@case:<ID> @area:<AREA> @prio:<P> …')`;
- assertions come from the case's **Expected result** (use `t()` for translated labels);
- no `test.describe.serial`, no cross-file state, no shared mutable seed rows;
- a spec must pass with `--shuffle` at 1 worker and at N workers.

## Corpus adaptations (before the affected specs are written)

| case(s) | change |
|---|---|
| `LIM-02`, `LIM-06`, `ADM-FLG-01..04` | create their own plan / flag row through the admin API instead of mutating seeded config |
| `LIM-03` → `BIL-03`, `LIM-04` → `EDU-GRP-04` + `ONB-10` | the prerequisite chain becomes fixture setup, not a manual step |
| `EDU-ASG-10`, `EDU-QZ-04`, `LIM-02`, `NFR-03`, `NFR-05`, `NFR-06`, `NFR-07`, `NFR-08` | stay **semantic** — see below |

## Semantic cases (the agentic remainder)

Judgement-heavy cases have no DOM assertion: print layout, offline/CDP emulation, keyboard
focus order, theme sweep, console/network sweep, cross-browser matrix. They stay in the
agent-driven QA flow with the corpus prompt, and the coverage map marks them `semantic` so
"green" is never claimed for them.

## Coverage map

Generated, never hand-edited: `@case:` tags plus the last run produce
[`qa/coverage.md`](../qa/coverage.md) and a JSON for dashboards. States:

`untriaged` · `drafted` · `red · bug #n` · `red · case` (the case doc is wrong) · `flaky` ·
`green` · `semantic`.

Triage today: **195 e2e · 12 API-level · 8 semantic** (of 215 cases).

## CI

- ephemeral local Supabase per run, service-role key in the test env (test-only);
- `workers` in `playwright.config.ts` is `1` on CI *because* today's specs share seed
  accounts — once isolation lands it should be raised (start at 2–4 and measure); shard by
  area if one machine stops being enough;
- traces and videos on failure; the run prints `green / red / semantic`.

## Batches

One spec per case, in batches of 8, area order: **STU** (52) → **EDU** (39) → **MGR** (28) →
**ADM** (21) → **AUT** (19) → **SEC** (13) → **ONB** (10) → **PUB** (8) → **BIL** (7) →
**LIM** (7) → **NFR** (8), P1 cases first inside each area. Each batch: write → run → triage
(red opens an issue) → merge what is green.

## Done

- 195 e2e + 12 API-level cases green on `main`;
- the 8 semantic cases acknowledged as the only agentic coverage;
- `--shuffle` at 1 and N workers gives identical results;
- the coverage map shows 0 untriaged / 0 failing.

**Gate: suite green.** Only then does the lint-debt work in #173 start.

## Relation to the agentic-testing plan

[`docs/plans/foundation-agentic-testing.md`](plans/foundation-agentic-testing.md) deferred
"agentic testing" as a whole. This document splits it: mechanical CRUD and negative paths
become deterministic Playwright specs (everything above), and judgement-heavy cases stay
agentic, run through the QA environments with the corpus prompt.
