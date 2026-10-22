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

Four slots are provisioned ahead of time by `scripts/qa-env` (run it from the
main checkout): **`qa-env-1` … `qa-env-4`**. Each slot is a detached
`qa-testing` worktree with its own Supabase stack, web app, admin app and
`qa/env.json`. Agents do **not** create, reset or tear down environments.

1. Bring the slots up once: `scripts/qa-env up all` (check with
   `scripts/qa-env status`; stop with `scripts/qa-env down all`).
2. Open an agent session with its working directory set to one slot's worktree
   (`.worktrees/qa-env-N`) so `qa/env.json` is found.
3. Copy the prompt from `AGENT-PROMPT.md` and set the scenario ID on the last
   line (`## SCENARIO ▶ <ID>`).
4. The agent reads `qa/context.md` → `qa/index.md` → `cases/<ID>.md` (plus any
   prerequisite case), uses the slot's `appUrl` / `adminUrl` / `dbContainer`,
   runs the steps and files the issue. It does not touch the stack.

Ports per slot N: web `3009+N`, admin `4009+N`, Supabase `54321+100N`.
Supabase runs without realtime / analytics / edge-runtime / imgproxy / vector /
pooler — the app uses none of them.

### Live QA browser dashboard

The operator dashboard runs at **<http://localhost:4000/>** and shows four
tiles, one per slot. Each tile is a live Chromium page at 1920×1080 (CDP
screencast) with that slot's opencode chat in a collapsible drawer. The agent
drives the **same** browser the operator sees:

- **MCP** (preferred): `qa_browser_navigate`, `qa_browser_state`,
  `qa_browser_click`, `qa_browser_type`, `qa_browser_press`,
  `qa_browser_scroll`, `qa_browser_wait_for`, `qa_browser_evaluate`,
  `qa_browser_screenshot`, `qa_browser_tabs`, `qa_browser_new_tab`,
  `qa_browser_select_tab`, `qa_browser_close_tab`, `qa_browser_back`,
  `qa_browser_forward`, `qa_browser_reload`, `qa_browser_network`,
  `qa_browser_console`. The env defaults to `qa/env.json` in the session
  workspace.
- **CLI fallback** (works via the normal shell tool):

  ```bash
  bun /workspaces/studiq/.worktrees/qa-env/dashboard/browser-cli.ts navigate "$APP_URL/login"
  bun /workspaces/studiq/.worktrees/qa-env/dashboard/browser-cli.ts click --text "M1"
  bun /workspaces/studiq/.worktrees/qa-env/dashboard/browser-cli.ts screenshot --name login
  ```

  It reads `qa/env.json` from cwd (or `QA_ENV_ID` / `--env qa-env-N`) and prints
  JSON. Screenshots are written to `dashboard/shots/qa-env-N-<ts>.png`; use the
  returned absolute `path` with `gh issue create --attach`.

Do **not** use opencode's built-in `browser.*` tools — they drive a different,
unobservable browser. The dashboard and its Chromiums are operator-managed
(`dashboard/run.sh`); agents do not start, stop or reset them.

### The few scenarios that need human input first

A handful of cases depend on something only a person can provide. Treat them as
`N/D` unless the input exists; don't fake it.

| Input | Scenarios | Without it |
|---|---|---|
| An LLM API key (`LLM_API_KEY` in `apps/web/.env`) | `EDU-DECK-05`, `STU-47`, `STU-48`, `STU-49` | AI features unavailable → `N/D` (the cases say so explicitly) |
| `admin_podpisz_zadanie.mjs` (Ed25519 signer from the „Studiq dane testowe" pack) | `ADM-SEC-01`, `ADM-SEC-02` | PEM gate can't be exercised; not improvised under "never change code" → `N/D` |
| `fiszki_poprawne.csv` / `fiszki_bledne.csv` | `STU-05`, `STU-19`, `STU-20`, `STU-42` | Import steps can't run → `N/D` |
| `logo.png` (< 1 MB) | `MGR-SET-02` | Branding upload can't run → `N/D` |
| A text PDF | `STU-49` | PDF extraction can't run → `N/D` |
| A PNG/JPG image and an MP3 file | `STU-22` | Media upload can't run → `N/D` |

Everything else — plan/feature overrides, org switching, group setup, seeded
content — is done by the agent through the app, the admin app, or the local DB.

Because a scenario often depends on state created by an earlier one (the
`Prereqs` column), run prerequisites first or re-create the required state.

## How the QA agent should use it

> **Test-plan context.** Before testing any scenario, read:
> 0. Drive the slot's live browser through the `qa_browser_*` MCP tools or the
>    `browser-cli.ts` fallback described above — not the built-in browser.
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
python3 tools/convert_docx.py source/Studiq_Dokument_Testera_v1.4.docx . "StudiQ Dokument Testera v1.4"
```

The third argument is the `- source:` label written into every case (defaults to
the input filename). The converter clears `cases/*.md` before writing, so renamed
or removed scenarios don't leave orphans. It is dependency-free (stdlib only) and
prints the case count and any prerequisite IDs it could not resolve.

## Notes

- Seeded dev accounts use the password `pass` (see `context.md`); these are local
  test fixtures, not real credentials.
- The corpus is generated from a customer-facing test document; regenerate it
  from `source/` rather than hand-editing `cases/`.
