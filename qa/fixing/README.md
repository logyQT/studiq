# Issue-fixing loop

Autonomous pipeline for confirmed issues that do **not** carry `needs-design`.
The manager owns the state machine; agents only produce their own artifact.

## Crew / fixed slots

| slot           | role           | output                                                                 |
| -------------- | -------------- | ---------------------------------------------------------------------- |
| qa-env-1,2,7,8 | QA/review pool | two independent verdicts or one e2e QA run; shared demand-driven slots |
| qa-env-3,4     | designers      | root cause + implementation design (`design-rN.json`)                  |
| qa-env-5,6     | writers        | branch + implementation + tests + PR (`impl-rN.json`)                  |

## State

- Tool: `qa/tools/qa-fix.py`
- Map: `/workspaces/studiq/.qa-fix/issue-map.json` (human: `issue-map.md`)
- Queue: `/workspaces/studiq/.qa-fix/queue.txt`
- Per-issue dossier: `/workspaces/studiq/.qa-fix/issues/<number>/`
- Pipeline state: `/workspaces/studiq/.qa-fix/state.json` — **tool/manager only**
- Durable manager memory: `/workspaces/studiq/.qa-memory/fix-manager.md`

Stages: `queued → designing → design_ready → implementing → pr_open →
reviewing → approved → qa_testing → qa_passed → done`, with
`changes_requested` looping through designer → writer and
`needs_design`/`blocked` stopping the issue.

## Why not one shared "core" file?

A single mutable file watched by agents would race: every stage would overwrite
the same content, and there is no reliable "notify all agents working on X"
primitive in the opencode session model. Instead:

1. Each issue has an append-only dossier directory.
2. Each role owns exactly one file in it (`design-rN.*`, `impl-rN.*`,
   `review-N-rN.*`, `qa-rN.*`); no two agents write the same path.
3. The manager reads the artifact and dispatches the next role. Events come from
   the dashboard slot transitions, so the manager does not poll.
4. `state.json` is the only shared mutable state and only the manager/tool
   writes it.

This gives shared context per issue without shared writes, and a retry always
points at the previous attempt's artifacts.

## Restart/checkout tooling

- `qa-env rebuild-app` — force a fresh production build and restart (needed
  after `gh pr checkout`; `restart-app` would keep the stale `.next`).
- `qa-env restart-browser` — restart that slot's Chromium.
- `qa-env reset` — destructive reseed, only when the repro needs clean data.
- `.qa-app.building` is respected by `qa-supervisor`, so it does not race the
  build with a restart.

## Commands

```bash
python3 qa/tools/qa-fix.py sync
python3 qa/tools/qa-fix.py map
python3 qa/tools/qa-fix.py next
python3 qa/tools/qa-fix.py design 140 --env 3
python3 qa/tools/qa-fix.py implement 140 --env 5
python3 qa/tools/qa-fix.py rebase 167 --env 6   # only from qa_passed: PR conflicted after main moved
python3 qa/tools/qa-fix.py migration-ts 176 --count 1
python3 qa/tools/qa-fix.py migration-check 176
python3 qa/tools/qa-fix.py assign-migrations 176 --timestamps 20261023233121
python3 qa/tools/qa-fix.py rebase 176 --env 5 --note "Renumber the PR migrations to the assigned timestamps."
python3 qa/tools/qa-fix.py review 140
python3 qa/tools/qa-fix.py qa 140 --env 1
python3 qa/tools/qa-fix.py collect 140
python3 qa/tools/qa-fix.py merge 140
python3 qa/tools/qa-fix.py status
python3 qa/tools/qa-fix.py repair-state   # recover valid prefix; corrupt file is backed up
```

`review` dispatches two reviewers from the shared pool (up to two pairs can run
at once); `collect` is idempotent enough for the manager to call after each
`finished` event. The merge gate requires two `approve` reviews, a QA `pass`, and
an open non-draft PR.
