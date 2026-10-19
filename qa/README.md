# QA corpus — StudiQ manual test plan (agent context)

Agent-readable version of the StudiQ manual test plan, so agents can run the
manual scenarios end-to-end and file defects with real root causes.

Source of truth: `source/Studiq_Dokument_Testera_v1.3.docx`
(Dokument testera v1.3, 2026-10-17 — 215 scenarios, P1 60 / P2 150 / P3 5).

## Layout

```
qa/
  README.md        this file
  AGENT-PROMPT.md  the copy-paste agent prompt (includes the scenario slot)
  context.md       global rules: accounts, org+seed data, plans, priorities, defect template (PL, verbatim)
  index.md         all 215 scenarios: ID | Prio | Title | Prereqs | Module
  cases/<ID>.md    one scenario per file, steps verbatim (PL) + embedded prerequisite context
  source/          the original .docx (regeneration source)
  tools/           convert_docx.py (regenerator)
```

Scenario text is kept **verbatim in Polish**; the wrapper (headings, field keys,
index, agent prompt) is English, matching the repo/issue convention.

## Running a scenario

The agent handles its own environment. Give it a scenario ID and the prompt from
`AGENT-PROMPT.md`; it will bring up what it needs, run the steps, and file the
issue.

1. Copy the prompt from `AGENT-PROMPT.md` into a fresh agent session.
2. Set the scenario ID on the last line (`## SCENARIO ▶ <ID>`).
3. Done. The agent reads `context.md` once, then `index.md` → `cases/<ID>.md`
   (plus any prerequisite case it references), starts the stack and app if they
   are down, executes the steps in the browser, and files defects with
   trace/log evidence.

Nothing needs to be pre-configured for the vast majority of the plan: the stack,
seed data and dev accounts are all local and reproducible.

### The few scenarios that need human input first

A handful of cases depend on something only a person can provide. Treat them as
`N/D` unless the input exists; don't fake it.

| Input | Scenarios | Without it |
|---|---|---|
| An LLM API key (`LLM_API_KEY` in `apps/web/.env`) | `EDU-DECK-05`, `STU-47`, `STU-48`, `STU-49` | AI features are unavailable → mark `N/D` (the cases say so explicitly) |
| A PNG/JPG image and an MP3 file | `STU-22` | Upload steps can't run → mark `N/D` |

Everything else — plan/feature overrides, org switching, group setup, seeded
content — is done by the agent through the app, the admin app, or the local DB.

Because a scenario often depends on state created by an earlier one (the
`Prereqs` column), run prerequisites first or re-create the required state.

## How the QA agent should use it

> **Test-plan context.** Before testing any scenario, read:
> 1. `qa/context.md` (accounts, seed data, plan limits, priorities, defect-template rules) — once per session.
> 2. `qa/index.md` → find the scenario ID you were given.
> 3. `qa/cases/<ID>.md` → read it **and** the "Prerequisite context" section it embeds.
>    If the case references another ID that is not embedded, read `qa/cases/<that-ID>.md` too.
> File issues only for defects covered by the scenario in scope; use the account, active org and
> seed state from the prerequisite chain.

## Worked example — the EDU-DECK-03 case

`qa/cases/EDU-DECK-03.md` says `prereqs: EDU-DECK-02` and embeds EDU-DECK-02's
steps and expected result, so the agent knows it needs T1 on **WSB Merito** and
the deck `"Matematyka – klasa 1"` (visibility: Grupy, group O1G1) before it can
toggle visibility to "Tylko ja". Without this file the agent only sees the five
lines you paste.

## Regenerate after a document update

```bash
# inside the container
cd qa
cp /path/to/new/Studiq_Dokument_Testera_v1.4.docx source/
python3 tools/convert_docx.py source/Studiq_Dokument_Testera_v1.4.docx .
```

The converter is dependency-free (stdlib only) and prints the case count and any
prerequisite IDs it could not resolve.

## Notes

- Seeded dev accounts use the password `pass` (see `context.md`); these are local
  test fixtures, not real credentials.
- The corpus is generated from a customer-facing test document; regenerate it
  from `source/` rather than hand-editing `cases/`.
