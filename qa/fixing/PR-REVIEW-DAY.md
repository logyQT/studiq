# Review day — PR review + QA only

Today your job is **review + QA on incoming PRs**. Nothing else.

- No designs, no implementations, no new issues. You do not touch the app code.
- `qa/tools/qa-pr-watch` posts an event when a PR opens, or when a draft becomes ready.
  You never poll GitHub yourself.

## For every `[pr-watch]` event

1. `$FIX ingest --author <author>` — brings the PR in as work id `N`. It skips drafts, our
   own PRs and anything already tracked, so running it after each event is safe.
2. `$FIX review N` — two independent reviewers on the same head.
3. `$FIX qa N` — one end-to-end QA run in a slot.
4. When both reviews and QA are in: `$FIX verdict N --approve` or
   `$FIX verdict N --request-changes` with the findings.
5. **The author owns the merge.** Never merge their PR and never push to their branch.

## Rules

- Two reviews + QA must be on the **same head**; a new commit resets the gate.
- A finding is `file:line` plus what you observed (trace id, status code, screenshot) — not
  "looks wrong".
- If a PR is huge or blocked, note it and move to the next one; do not stall the queue.
- One short line per turn, then end the turn. The events wake you; do not sleep or poll.
- Keep `$FIX ingest` running as PRs arrive so nothing piles up overnight.
