# QA corpus — StudiQ manual test plan (agent context)

Agent-readable version of the StudiQ manual test plan, so agents can run the
manual scenarios end-to-end and file defects with real root causes.

Source of truth: `source/Studiq_Dokument_Testera_v1.3.docx`
(Dokument testera v1.3, 2026-10-17 — 215 scenarios, P1 60 / P2 150 / P3 5; STU-25, M:N flashcard
linking, is dropped as not planned (#893), and the admin module + 5 admin-dependent cases
are out of scope, so 188 cases remain).

Automation: the campaign that turns these cases into the Playwright suite is
[`docs/e2e-campaign.md`](../docs/e2e-campaign.md); current mapping in
[`coverage.md`](coverage.md).

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

| Input                                       | Scenarios                                   | Without it                                                    |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| An LLM API key configured for the app       | `EDU-DECK-05`, `STU-47`, `STU-48`, `STU-49` | AI features unavailable → `N/D` (the cases say so explicitly) |
| `fiszki_poprawne.csv` / `fiszki_bledne.csv` | `STU-05`, `STU-19`, `STU-20`, `STU-42`      | Import steps can't run → `N/D`                                |
| `logo.png` (< 1 MB)                         | `MGR-SET-02`                                | Branding upload can't run → `N/D`                             |
| A text PDF                                  | `STU-49`                                    | PDF extraction can't run → `N/D`                              |
| A PNG/JPG image and an MP3 file             | `STU-22`                                    | Media upload can't run → `N/D`                                |

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
prerequisite IDs it could not resolve. Do not hand-edit generated case files.

## Notes

- Seeded dev accounts use the password `pass` (see `context.md`); these are local
  test fixtures, not real credentials.
- The corpus is generated from a customer-facing test document; regenerate it
  from `source/` rather than hand-editing `cases/`.
- QA environment setup is maintained outside this repository and is
  intentionally not documented here.

## QA suite generation

`QA-SUITE-APPROACH.md` defines the QA-suite loop: one spec per case, a fresh
browser session per run and one isolated tenant per case. Only tests that pass
5/5 independent runs are admitted to `qa-suite`; legacy `@dev.local` accounts are
not used in the suite. Manager and worker prompts are in
`QA-SUITE-MANAGER.md` and `QA-SUITE-WORKER.md`.
