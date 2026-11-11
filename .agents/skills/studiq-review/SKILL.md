---
name: studiq-review
description: 'Review a StudiQ pull request, branch, or local diff by verifying its claims in code, docs and the running app. Use when asked to review a PR, review a branch, or do a code review — triggers on "review PR", "review #<n>", "review branch", "code review", "is this PR ready to merge", "verify this PR", "review my changes". Spawns a mandatory QA subagent for user-visible behaviour and never approves on green CI alone.'
---

# StudiQ PR review

Repo-owned review skill. Verify what a PR **claims** in three places: the code,
the docs, and the running app. `lint`/`typecheck`/tests are supporting evidence,
never proof. Absent from `skills-lock.json`; edit it like any repo file.
`.agents/skills/studiq-qa/SKILL.md` is the QA worker's companion.

## When to use

Trigger phrases: "review PR 1234", "review this branch", "code review", "is this
ready to merge". Do **not** use it for read-only exploration of `main` with no diff.

## Rules (non-negotiable)

1. **Never review the diff alone.** Diffs show change; files show what exists.
   Open every touched file at the PR head (`git show <sha>:<path>`).
2. **Never trust the PR description or green CI.** Convert it into claims and test
   each one; a claim with no evidence is `BLOCKED`, not "probably fine". `checks`,
   `unit`, `integration`, `e2e` prove the suites pass, not that the feature works.
3. **A QA subagent is mandatory for every user-visible claim.** No QA run → no
   approval. If the environment cannot run, say `BLOCKED` and stop.
4. **Do not fix code, push commits, or open PRs during review** unless the user
   explicitly asks for fixes. This skill is report-only.
5. **Every finding carries evidence**: `file:line`, a repro command/step, and a
   screenshot, network entry (`x-trace-id`) or Grafana trace. Conventions live in
   `AGENTS.md`; link to them, do not restate them.

## Step 1 — Collect the change

```bash
gh pr view <n> --json number,title,body,headRefName,headRefOid,baseRefName,labels,closingIssuesReferences,files
gh pr diff <n>
gh pr view <n> --json closingIssuesReferences --jq '.closingIssuesReferences[].number' | xargs -r -n1 gh issue view --json number,title,body,labels
```

Read title, body, linked issue, commit messages and labels. Review in a
**dedicated worktree** (one environment per checkout) so the app runs the PR head:

```bash
scripts/spin review/pr-<n>
cd ../studiq-worktrees/review/pr-<n>
bun install --frozen-lockfile   # fresh worktree: hooks/typecheck need deps
git fetch origin pull/<n>/head
git checkout -B review/pr-<n> FETCH_HEAD
git log --oneline origin/main..HEAD
```

For a stack, read each PR against its own base (`gh pr diff <n>` is relative to
that base, so a "+" line may already be on `main`; see `AGENTS.md`).

## Step 2 — Turn the PR into claims

Write `C1..Cn`, one per promise a reader could falsify:

- explicit claims (body, linked issue, acceptance criteria, title) and the
  PR's stated exclusions;
- **implied** claims (a new `/api/v1/x` route implies auth + isolation; a new UI
  route implies a `routeRules` entry; a new permission implies UI gating).

Keep claims behavioural ("a teacher can publish a quiz to one group only"), not
structural ("adds a service"); structural claims need a code check, not QA.

## Step 3 — Verify each claim in three places

**Code** — diff + full files at head, callers, and the layer the claim crosses:

```bash
git show <head-sha>:apps/web/src/app/\(frontend\)/edu/<area>/page.tsx
rg -n "withAuth|routeRules|Permission\.|usePermission|feature\(" <paths>
```

Check the shape a StudiQ change must keep: route → controller → model → service,
`withAuth()` on every non-public API route, `routeRules` for a new UI route,
`Permission` + `accessibleFilter`/RLS for data scoping, `usePermission`/
`useFeature` for UI gating, keys in **both** `pl.json` and `en.json`, migration in
`supabase/migrations/` + `supabase/schemas/` for new tables.

**Docs** — every factual statement must match the repo: `AGENTS.md`, `docs/`,
`docs/decisions/`, `README.md`, `qa/`, command tables in `package.json`,
`.env.schema`, i18n messages. Stale docs are findings (env var not in
`.env.schema`, command not in `AGENTS.md`, an ADR the code contradicts).

**Real world** — the QA subagent (Step 4); the only evidence that turns a
user-visible claim into `PASS`.

## Step 4 — Spawn the QA worker (mandatory)

Spawn a subagent with OpenCode's `subagent` tool (**`agent: general`**) and paste
the handoff below with every `<...>` filled. Bring the app up in that worktree
first (`bun run env:ensure --profile web`; the `qa` profile seeds per-case
tenants for the QA suite, not the manual `@dev.local` accounts). The worker reads
and follows `.agents/skills/studiq-qa/SKILL.md` before touching the app. Give it the worktree, `APP_URL` from
`env:status --json`, and the seeded accounts; it clicks through the feature and
its edge cases, it does not just run tests. If subagents are unavailable, mark
every user-visible claim `BLOCKED` and do not approve.

````markdown
# QA handoff — PR review verification

You are the QA worker for a PR review. Report-only: no code edits, commits, push
or PRs. Read and follow `.agents/skills/studiq-qa/SKILL.md` (corpus, accounts,
evidence, defect rules, handoff contract).

- PR: #<n> `<title>` · branch `<headRefName>` · head `<sha>` · base `<baseRefName>`
- Worktree `<abs path>` · app `<APP_URL>` · stack `<stackId>` · service `<service>`
  · `grafana` MCP (Tempo/Loki/Prometheus), read-only.
- Accounts: `<S1/T1/M1/...>` (password `pass`, login via `POST /api/v1/auth/login`)

## Claims to prove or break

| ID  | Claim (behavioural) | Expected user-visible result |
| --- | ------------------- | ---------------------------- |
| C1  | <claim>             | <what a user should see>     |

## Relevant QA cases

`<IDs from qa/index.md, e.g. EDU-ASG-04, SEC-01, LIM-02, NFR-02>` — read each
`qa/cases/<ID>.md` plus its prereq chain; with no matching case, walk the claim's
happy path, one alternate path and one negative.

## Edge-case matrix to exercise

<rows from the matrix in the review skill that apply, with account + expected result>

## Evidence (required per claim)

- Screenshot(s) named by exact filename; state which step each proves and how the
  environment was reached (`env:status --json`, commit).
- Failed request plus console errors: method, URL, status, body, `x-trace-id`.
- Failure root cause from Grafana: span name, `error.code`, `db.error.*`, log line.

## Verdict (required)

Reply with a table and exactly one fenced `json` block, nothing after it:

```json
{"pr": <n>, "head": "<sha>", "claims": [{"id": "C1", "verdict": "PASS|FAIL|BLOCKED", "evidence": ["<file>", "<url/x-trace-id/span>"], "notes": "..."}], "env": "<ok|broken: why>"}
```

`PASS` requires reproduced, observed behaviour with evidence. `BLOCKED` means the
check could not run (env, unrun prerequisite, API-only) — say why, never guess;
use `N/D` only for a human-provided fixture the case names. State which edge-case
rows you exercised and which you skipped. File confirmed defects per the QA skill.
````

## Step 5 — Supporting evidence (not proof)

```bash
bun run lint                      # whole-repo lint (no typecheck)
bun run typecheck:all             # root + web + packages
bun run test:unit                 # mocked; proves nothing about the app
bun run pr:size                   # budget, see below
bun run env:ensure --profile web  # stack + build + serve for the QA run
bun run env:status --json         # APP_URL, stackId, health — the agent contract
```

- When the static gate lands: `bun run review:static -- --changed origin/main` → exit ≠ 0 is a finding; cite the rule id.

Never run `env:dev`/`next dev` (human-only) or bare `bun test`. A green suite on a
broken app is a `FAIL` whose finding names the gap (a service test mocking the
permission check the claim rests on).

## Claim table template

| ID  | Claim (source) | Code evidence | Docs evidence | Real-world evidence | Verdict |
| --- | -------------- | ------------- | ------------- | ------------------- | ------- |
| C1  | <claim> (`PR body`/`#issue`) | `path:line`, `git show <sha>:<path>` | `docs/x.md`, `AGENTS.md#...` | QA `<case>` + evidence ref | PASS/FAIL/BLOCKED |
| C2  | <implied claim> | | | | |

`PASS` = all three checks agree, evidence cited. `FAIL` = contradicted somewhere
(a finding). `BLOCKED` = could not verify, reason stated; code + docs alone cannot
make a user-visible claim `PASS`.

## Edge-case matrix (app-specific)

| Dimension | Check | Seeds / cases |
| --- | --- | --- |
| Account type & role | student/educator/manager on their own surface and on another's route; no cross-role data or 404/500 instead of a redirect | AUT-15…AUT-19 |
| Org isolation | switch active org (`POST /api/v1/me/orgs/switch`); no rows from the other org; nullable-org personal content still visible | SEC-02, SEC-04, ONB-07 |
| Plan & feature gates | gated action hidden or `402 FEATURE_REQUIRES_UPGRADE`; limit hit → `USAGE_LIMIT_EXCEEDED`; flags from `/api/v1/features/me` | LIM-02, LIM-04, LIM-05, STU-45 |
| Permissions, deep links, API | direct URL and direct `curl` with a lower role; `withAuth` on every non-public route; IDOR on another user's id; RLS on new tables | SEC-01, SEC-05, SEC-08, SEC-13 |
| Empty / loading / error / offline | brand-new account with no content; slow/failed request; network off → message, not a blank screen | NFR-06, NFR-07 |
| i18n PL/EN | key present in both catalogues, no hard-coded copy, no raw key; switch locale without reload losing state | NFR-01, NFR-02 |
| Reload / back / deep link | full reload clears React Query cache; browser back restores the list; deep link to the new route | STU-10, ONB-09 |
| Validation & limits | Zod errors surfaced per field; max lengths, CSV/media type and size limits | STU-20, SEC-11, MGR-SET-03 |
| Destructive actions | confirm dialog, cancel is safe, delete/leave actually removes state, no orphan rows | STU-18, MGR-MEM-04, EDU-GRP-03 |
| Payments (mock) | `PAYMENT_DRIVER=mock`; plan/account-type mismatch refused; no real card data; entitlements apply after purchase | BIL-03…BIL-06 |
| AI unavailable | no `LLM_API_KEY` → disabled state or clear error, never a hang or a crash; feature flag still gates it | STU-47, EDU-DECK-05 |
| Responsiveness / theme / a11y basics | 375×812, dark mode, keyboard-only path, focus visible, labels, contrast | NFR-03…NFR-05 |

Use `qa/cases/<ID>.md` when one exists, else put the steps in the handoff. Never
invent fixtures (CSV, logo, PDF, media, LLM key) — record `BLOCKED`.

## PR size context

- Budget: **400 reviewable lines** (`PR_SIZE_LIMIT`); tests, docs, generated
  files, lockfile and `.agents/skills/**` are excluded but reported.
  `bun run pr:size` (`--json`, `--limit 300`, `--enforce`), committed changes only.
  `pr-triage.yml` labels every PR `size/XS|S|M|L|XL`; over budget is always
  `size/XL`. The label is informational and never replaces verification.
- Over budget: review **cumulatively** against the PR's own base, separate lines
  inherited from a parent PR (`git show <sha>:<path>`), and flag it for splitting.
  `size:exception` is an operator bypass needing a reason in the body — note it
  if absent, never treat it as approval.
- Under budget changes nothing: an `XS` PR touching auth or RLS still needs every
  claim verified. Over budget never lowers the bar either.

## Output format

```markdown
## Review — PR #<n> <title> @ <sha>
Verdict: APPROVE | REQUEST CHANGES | COMMENT (not approved)
Scope: <n> reviewable lines (`size/S`), <files>, QA run: <yes/path/no + why>

### Claims
| ID | Verdict | Evidence |
| -- | ------- | -------- |
| C1 | PASS | `path:line`; docs; QA `<case>` + screenshot `<file>` |

### Findings
1. **[critical]** `path:line` — what is wrong, how to reproduce, expected vs actual, evidence.
2. **[high]** / **[medium]** / **[low]** / **[nit]** ...

### Residual risk
What this review did not cover and why (feature area, browser, data volume, load).

### Not verified
Explicit list: claim/element · reason (`BLOCKED: env would not start`, `no LLM key`).

### Evidence index
Screenshots, `x-trace-id`s, spans, commands run.
```

Post with `gh pr review <n> --comment|--request-changes --body-file <file>` (write
the body to `/tmp/opencode/review-<n>.md` first). Approve only when every
user-visible claim is `PASS` with real-world evidence, no `critical`/`high`
finding is open, and nothing that matters is `BLOCKED`. "CI is green" is not a
reason; an approval without a QA run is never allowed.

## Severity

`critical` — data loss/leak, auth bypass, broken core flow, cross-org exposure.
`high` — the PR does not do what it claims, or a gate/enforcement is missing.
`medium` / `low` / `nit` — happy-path-only behaviour, wrong empty/error state, i18n
or a11y gap, polish, naming, docs drift, non-user-visible test gap.

## Specialists

QA is the only specialist wired today. Security, performance and a11y can be
added later as sibling skills; until then put them under "Residual risk" rather
than implying they were covered.

