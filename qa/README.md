# QA corpus — StudiQ manual test plan (agent context)

Agent-readable version of the StudiQ manual test plan, so agents can run the
manual scenarios end-to-end and file defects with real root causes.

Source of truth: `source/Studiq_Dokument_Testera_v1.3.docx`
(Dokument testera v1.3, 2026-10-17 — 215 scenarios, P1 60 / P2 150 / P3 5; STU-25, M:N flashcard
linking, is dropped as not planned (#893), and the admin module + 5 admin-dependent cases
are out of scope, so 188 cases remain).

Automation: the suite that turns these cases into Playwright specs lives in
[`__tests__/qa/`](../__tests__/qa/) — one spec per case, one tenant profile per case —
and the technique classification (e2e / api / manual) is
[`coverage.md`](coverage.md). Current coverage state: `#926`.

## Layout

```
qa/
  README.md        this file
  AGENT-PROMPT.md  the copy-paste agent prompt
  context.md       global rules: accounts, org+seed data, plans, priorities, defect template (PL, verbatim)
  index.md         all 188 scenarios: ID | Prio | Title | Prereqs | Module
  cases/<ID>.md    one scenario per file, steps verbatim (PL) + embedded prerequisite context
  source/          the original .docx (regeneration source)
```

This directory is docs-only. The executable QA harness lives with the rest of the
test tree:

```
__tests__/qa/playwright.qa.config.ts   QA runner config
__tests__/qa/fixtures/tenant.ts        tenant loader + loginAs
__tests__/helpers/db-admin.ts          service-role client + db clock
__tests__/helpers/mailpit.ts           QA mailbox reader
__tests__/helpers/stack-mode.ts        temporary stack-mode skip helper
```

Scenario text is kept **verbatim in Polish**; the wrapper (headings, field keys,
index, agent prompt) is English, matching the repo/issue convention.

## Running a scenario

The operator provisions the app, database, browser and telemetry for a run and
assigns the scenario; that setup lives outside this repository. Copy the prompt
from `AGENT-PROMPT.md`, set the scenario ID on the last line
(`## SCENARIO ▶ <ID>`), then let the agent:

1. Read `qa/context.md` once (accounts, seed data, plan limits, priorities, defect template).
2. Find the scenario ID in `qa/index.md`.
3. Read `cases/<ID>.md` plus any prerequisite case it embeds, run the steps in
   the assigned browser, and file the issue.

The agent does not provision, reset, restart or reconfigure the environment.

`apps/admin` (the internal system-admin surface) is out of scope for QA: do not
start it, sign requests for it, or file findings against it. No case requires it.

### The few scenarios that need human input first

A handful of cases depend on something only a person can provide. Treat them as
`N/D` unless the input exists; don't fake it.

| Input                                       | Scenarios                              | Without it                                                    |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| An LLM API key configured for the app       | `EDU-DECK-05`, `STU-49`                | AI features unavailable → `N/D` (the cases say so explicitly) |
| `fiszki_poprawne.csv` / `fiszki_bledne.csv` | `STU-05`, `STU-19`, `STU-20`, `STU-42` | Import steps can't run → `N/D`                                |
| `logo.png` (< 1 MB)                         | `MGR-SET-02`                           | Branding upload can't run → `N/D`                             |
| A text PDF                                  | `STU-49`                               | PDF extraction can't run → `N/D`                              |
| A PNG/JPG image and an MP3 file             | `STU-22`                               | Media upload can't run → `N/D`                                |

`STU-47` and `STU-48` need no key **in CI**: the `ai-suite` job runs them against the fake
inference server (`bun run mock:llm`, see `docs/ai/fake-inference-server.md`). A manual run
without a key and without that server stays `N/D`. Any further AI case (`EDU-DECK-05`,
`STU-49`) runs the same way once it has a spec — a key is a convenience, not a gate.

Everything else — plan/feature overrides, org switching, group setup, seeded
content — is done by the agent through the app API or the local DB.

Because a scenario often depends on state created by an earlier one (the
`Prereqs` column), run prerequisites first or re-create the required state.

## How the QA agent should use it

> **Test-plan context.** Before testing any scenario, read:
>
> 1. `qa/context.md` (accounts, seed data, plan limits, priorities, defect-template rules) — once per session.
> 2. `qa/index.md` → find the scenario ID you were given.
> 3. `qa/cases/<ID>.md` → read it **and** the "Prerequisite context" section it embeds.
>    If the case references another ID that is not embedded, read `qa/cases/<that-ID>.md` too.
>    File issues only for defects covered by the scenario in scope; use the account, active org and
>    seed state from the prerequisite chain.

## Worked example — the EDU-DECK-03 case

`qa/cases/EDU-DECK-03.md` says `prereqs: EDU-DECK-02` and embeds EDU-DECK-02's
steps and expected result, so the agent knows it needs T1 on **WSB Merito** and
the deck `"Matematyka – klasa 1"` (visibility: Grupy, group O1G1) before it can
toggle visibility to "Tylko ja". Without this file the agent only sees the five
lines you paste.

## Regenerate after a document update

The docx → markdown converter is part of the operator's QA tooling and is not
tracked in this repository. Regenerate the corpus with that converter when the
source document changes; it clears `cases/*.md` before writing, so renamed or
removed scenarios do not leave orphans, and it prints the case count and any
prerequisite IDs it could not resolve. Do not hand-edit generated case files to
update the corpus from the source document; suite workers may still reconcile
and commit a case's seed/prerequisite details for suite generation, as described
in `QA-SUITE-APPROACH.md`.

## Notes

- Seeded dev accounts use the password `pass` (see `context.md`); these are local
  test fixtures, not real credentials.
- The corpus is generated from a customer-facing test document; regenerate it
  from `source/` rather than hand-editing `cases/` to update the corpus.
- QA environment setup is maintained outside this repository and is
  intentionally not documented here.

## QA suite

One spec per case in `__tests__/qa/<AREA>/<ID>.spec.ts`, one isolated tenant per case
(and per attempt), so a shard runs its files in parallel:

```bash
bun run env:ensure --profile web                 # this checkout's app + stack
bun scripts/qa-tenant.ts STU-21 --fresh          # seed the case's tenant
bun run test:qa __tests__/qa/STU/STU-21.spec.ts  # run it
```

CI seeds a shard's areas once (`bun scripts/qa-tenant.ts --all --areas … --run ci<id>`)
and runs Playwright at `QA_WORKERS=4` across four path-scoped shards (`edu`, `stu`,
`mgr-sec-bil`, `aut-nfr-onb-pub-lim`); AI cases run in `ai-suite` against the fake
inference server. Only specs that pass **5/5** independent fresh-tenant runs are admitted,
and no spec is skipped, `fixme`d or written as expected-to-fail.

Designing, writing, mutating or pruning a case: `.agents/skills/studiq-qa-case/SKILL.md`.
The three campaign prompts (`QA-SUITE-APPROACH.md`, `QA-SUITE-MANAGER.md`,
`QA-SUITE-WORKER.md`) describe the retired shared-VM loop; they are parked for rewrite, and
nothing in them is authoritative except the retry-safety, copy-literal and admission rules the
skill now carries.
