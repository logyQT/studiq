# Review day — PR review + QA only

Today your job is **review + QA on incoming PRs**. Nothing else.

- No designs, no implementations, no new issues.
- **Never write or push code** — not through an agent and not yourself: no `design`, no
  `implement`, no rebase/push/force-push, no edits to the PR branch. You review, QA, comment
  and (when green) merge.
- `qa/tools/qa-pr-watch` posts an event when a PR opens, or when a draft becomes ready. You
  never poll GitHub yourself.

## For every `[pr-watch]` event

1. `$FIX ingest --author <author>` — brings the PR in as work id `N`. It skips drafts, our own
   PRs and anything already tracked, so running it after each event is safe.
2. `$FIX review N` — two independent reviewers on the same head.
3. `$FIX qa N` — one end-to-end QA run in a slot.
4. Then decide:
   - **Every gate green and the PR is mergeable → merge it.** `$FIX verdict N --approve` posts
     the approving review and merges (squash + deletes the branch).
   - **Anything red, or the PR has conflicts → post one consolidated review and wait.**
     `$FIX verdict N --request-changes` carries both reviewers' blocking findings and the QA
     result in a single review. Then stop — do not re-dispatch anything until the author pushes
     a fix (a new commit resets the gate).

## Small changes

A change is **small** when it is a few lines in one file, with no migration, no RLS/permission
change and no API contract change. For those, one reviewer is enough:

- `$FIX review N --single` (one reviewer instead of the pair), and
- `$FIX qa N` on another slot **at the same time**, so the two run in parallel.

Everything else keeps the two-review pair. When in doubt, treat it as not small.

## Rules

- Two reviews + QA must be on the **same head**; a new commit resets the gate.
- A finding is `file:line` plus what you observed (trace id, status code, screenshot) — not
  "looks wrong".
- A PR that is red or conflicting stays with its author: you never fix it yourself.
- If a PR is huge or blocked, note it and move to the next one; do not stall the queue.
- One short line per turn, then end the turn. The events wake you; do not sleep or poll.
