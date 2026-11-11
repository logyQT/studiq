---
name: studiq-qa
description: "Run StudiQ web-app QA against a live environment. Use when asked to QA the app, manually test a PR or branch end-to-end, click through a feature, verify a claim in the running app, smoke-test a change, or reproduce a user-reported bug. Also the mandatory QA worker for the studiq-review skill: it returns machine-readable PASS/FAIL/BLOCKED verdicts per PR claim with screenshots, network entries and trace evidence."
metadata:
  version: "0.1.0"
---

# StudiQ QA

Repo-owned manual QA skill. **Report-only**: find, prove and file defects; never fix, commit or open a PR.

Two callers:

| Mode      | Trigger                                          | Output                                             |
| --------- | ------------------------------------------------ | -------------------------------------------------- |
| Standalone | "QA <feature>", a scenario, a branch to smoke-test | filed issues + a verdict per step                  |
| Review worker | `studiq-review` delegates PR claim verification | the handoff block at the end; no extra prose       |

`qa/AGENT-PROMPT.md` is the operator contract, `qa/context.md` holds the account/seed/plan/priority tables and the defect template, `qa/README.md` explains the corpus. Read all three once per session; do not work from memory of them. Nothing here overrides them.

## Environment

- In a fresh worktree, run `bun install --frozen-lockfile` once before anything else; dependencies are per checkout.
- Bring up your own checkout with `bun run env:ensure --profile web` — idempotent: this checkout's Supabase stack + production build + serve. Agents never run `next dev`, `env:dev` or `dev:web`.
- Confirm with `bun run env:status --json` (`stackId`, branch, endpoints, app health). `bun run env:ports --json` prints a free `APP_PORT`.
- Logs: `bun run env:logs` (follow) or `--no-follow` for the last 100 lines.
- If a caller handed you an `APP_URL`/`stackId` (review flow), verify it with `env:status --json` and use it. Do not start a second environment in that checkout — `env:ensure` refuses with exit 6 when another environment owns it.
- Stop only what this session started: `bun run env:down` (web) / `--all` (also the stack). Never `env:reset-db`, `supabase start/stop`, `db reset`, or stop/reset a stack you did not start.
- The shared QA environment — app `:3010`, Supabase `:54421`, browser tiles `9221–9228` — is protected. Never start, stop, reset or seed it, and never point a run at it unless the operator handed it to you (`SUPABASE_SHARED=1`, `QA_APP_URL`).
- Observability is **one stack per machine**, owned by the primary checkout (`git worktree list` first entry; `/workspaces/studiq` on this VM). Never start or stop `docker compose` from your worktree. If Grafana/Tempo/Loki are down, `bun run env:doctor` prints the primary path and the exact start command; start it there once. `env:ensure` sets `OTEL_SERVICE_NAME=studiq-<branch>` (explicit `.env.local` wins), so filter by that name, not a hard-coded `studiq`.
- Once the app is serving, treat the environment as read-only. If it is broken (unreachable, every route 500s, no telemetry), gather `env:status`, `env:doctor`, `env:logs --no-follow`, then report `BLOCKED/env` and stop. Do not rebuild, reset or restart to paper over a failure. A broken environment is never a `bug`.
- `apps/admin` is out of QA scope: do not start it, sign requests for it, or file findings against it.
- Use the session's browser (the one the operator watches), one fresh context/page per scenario, and leave it open. Do not drive a second browser.

## Accounts and login

Accounts, orgs/groups and seeded content are in `qa/context.md`; the alias list (M1, M2, T1, T2, TC, S1, S2, S3, SC, TS) is in `qa/AGENT-PROMPT.md`. All use password `pass`.

- Authenticate **only** with `POST /api/v1/auth/login` and `{"email","password"}`, against the app origin, and keep the returned session cookie. There is no Dev Quick Login in a production build, and the login form is not a supported entry point.
- Org context matters: `POST /api/v1/me/orgs/switch` with `{orgId}` (ids in `qa/AGENT-PROMPT.md`; list them with `GET /api/v1/me/orgs`). Set it deliberately and record it — several cases assert an org-specific view.
- Locale: `NEXT_LOCALE` cookie (`pl` default, `en`). Theme through the app's own toggle.
- Mail (signup, activation, reset): Mailpit at `MAILPIT_URL`, else the Supabase API port + 3. Read only the message addressed to your own address; never list or delete another worker's mail.
- The seed is shared. Treat every account, org, group and row you did not create as read-only unless the case explicitly acts on it.
- A fresh stack is seeded from `supabase/seeds/` (`[db.seed] enabled`). If a seeded login is rejected, the database is not the seeded one — report `BLOCKED/env`; do not reset it.

## Scenario source

1. `qa/context.md` — once per session.
2. `qa/index.md` — find the case ID, its priority and its `Prereqs`.
3. `qa/cases/<ID>.md` — the steps **and** the embedded prerequisite chain. If a referenced ID is not embedded, read `qa/cases/<that-ID>.md` too, and reproduce the prerequisite state first.
4. Case text is Polish and generated: do not edit it, and quote expected copy verbatim (a wording difference is a P3 language remark unless it misleads).
5. For a PR/branch with no matching case, derive claims from the PR body and the touched UI/API, then take the account, org and plan baseline from `qa/context.md`.

## Test data

- Create what the case needs through the UI or the app API first. Direct DB writes are only for setup the app cannot express, always scoped to the case.
- Tag everything you create with a run token (`qa-<CASEID>-<epoch>`), so cleanup is exact and another worker's rows stay untouched.
- Environment-wide rows — `plan_limits`, feature flags, platform settings, plan catalogue, singletons — are only touched when the case says to: record the prior values, change the minimum, run serially, restore afterwards. Never reset the DB to undo.
- Clean up in reverse order (content → group → membership → invitee). Leave seed orgs, groups and content intact.
- No real personal data, credentials or card numbers. Payment is simulated (`PAYMENT_DRIVER=mock`); plans/features may be overridden only as instructed.

## Execution

- One scenario at a time, one fresh session, from a state that satisfies the prerequisites.
- Walk the real user path: click the UI. APIs are for login, setup and confirming persisted state — not a substitute for the clicks the case describes.
- If the harness has no browser tool, drive Chromium with Playwright in a throwaway spec/script outside the repo (never commit it), or report `BLOCKED: no browser`. A claim verified through API/curl only is not a `PASS`.
- Capture the visible result, then reload (or SPA-navigate) and confirm the state persisted. A toast is not proof; a 200 is not proof.
- Feature-gated UI appears only after `/api/v1/features/me` resolves. Wait for it before declaring a menu item or button missing.
- A full reload clears the React Query cache: reproduce a suspected cache bug with SPA navigation, never a reload.
- Radix triggers need pointerdown → pointerup → click (real mouse press/release, not a JS `.click()`).
- Long or ambiguous "note it" expectations: record the actual behaviour and decide per `qa/context.md`; do not invent a pass.
- Known harness quirk: re-typing into a non-empty field may append instead of replace. That is the harness, not a defect — clear the field and continue.
- Never block on a user-facing question tool. Collect decisions and raise them in the end-of-run report.

## Edge-case checklist

Run the rows the change can reach; say which you skipped and why.

- **Accounts/roles** — student (`/app`), educator (`/edu`), manager (`/manage`): each on its own surface and on another's route; expect a redirect or 403, never data.
- **Isolation** — cross-org (S1 vs S2), cross-group (O1G1 vs O1G2), personal vs group content, IDOR on a foreign UUID.
- **Gates** — plan limit and feature flag both on and off (`/api/v1/me/plan`, `/api/v1/features/me`, `/api/v1/permissions/me`); gated action hidden or `402 FEATURE_REQUIRES_UPGRADE`; limit hit → `USAGE_LIMIT_EXCEEDED`.
- **Direct access** — paste the URL of a forbidden page and call the matching API with a lower role; both must refuse.
- **States** — empty (new account), loading/skeleton, error, retry, offline → a message, not a blank screen.
- **Validation/limits** — required fields, max lengths, duplicates, file type/size, attempt/seat/member limits; Zod errors surfaced per field.
- **i18n** — PL and EN: no raw keys, no hard-coded English, ICU plurals, switching locale keeps state.
- **Responsive/theme** — 375×812 and desktop; light/dark; no clipped or overlapping controls.
- **Destructive actions** — confirmation names the object, cancel changes nothing, confirm removes only the target and leaves no orphans.
- **Persistence/navigation** — reload, browser back, deep link to the new detail route.
- **Payments (mock)** — wrong account type refused, logged-out checkout blocked, entitlements apply after purchase, no real card data.
- **AI unavailable** — no `LLM_API_KEY` → disabled state or clear error, never a hang or crash; the feature flag still gates it.
- **A11y basics** — labels, focus order and visible focus, keyboard-only path, dialog focus trap and Esc.

## Evidence and root cause

On every failure, capture in this order:

1. **Screenshot** of the failing visible state: `qa-<CASEID>-<step>-<what>.png`. Cite the exact filename in the finding.
2. **Network entry**: method + URL, status, redacted request body, response body, `x-trace-id`.
3. **Console/server errors**: message, stack, `x-error-code`.
4. **Root cause** via the `grafana` MCP (read-only): resolve datasource UIDs once, then `get_tempo_trace({ datasourceUid, trace_id })` from `x-trace-id` — or `search_tempo_traces` with `resource.service.name` and `http.status_code >= 400`; then `query_loki_logs` with `trace_id` and `startRfc3339`/`endRfc3339`; Prometheus metrics are `studiq_`-prefixed. Quote the span error / `db.error.*` / log line.
   - Export is batched (~15 s): re-query once before concluding "no data".
   - No `x-trace-id`, or empty telemetry while the app answers → stale environment/telemetry, report `env`.
   - Unhealthy datasource → fall back to browser + DB evidence and say observability was unavailable.
   - In a parallel environment filter by **your** service name (`studiq-<branch>` from `OTEL_SERVICE_NAME`) or you will read another worker's telemetry.

"The API returned 500" is a symptom; the failing span, Postgres code or log line is the cause. State the cause you actually observed.

## Reporting

Verdicts: **PASS** / **FAIL** / **BLOCKED** (environment, missing fixture, unrun prerequisite). Use `N/D` only for inputs the case names as human-provided (LLM key, CSV/logo/PDF/media fixtures) — never substitute invented data or file a bug for a missing fixture.

Before filing, search duplicates: `gh issue list --repo logyQT/studiq --state all --limit 200 --search "<keywords>"`. One bug = one issue; several distinct defects → several issues.

Issue body: scenario ID + step; severity; exact numbered repro from a clean state; expected (quoted from the case) vs actual; evidence filenames + network/console/trace summary; environment (`<branch> @ <commit>`, `APP_URL`, account, active org, `stackId`).
Labels: `bug` + exactly one severity (`critical|high|medium|low`) + 1–2 areas (`frontend|backend|database|i18n|visual|security|accessibility|performance|payments`) + `manual-testing` for manual runs. English. Design ambiguity is still filed, with `needs-design` and the options.
Attach screenshots: `gh issue create ... --attach "<path>#<alt text>"`.

Report-only: no code edits, commits, branches or PRs during QA. Only when explicitly asked to turn a confirmed case into a durable test, follow `qa/QA-SUITE-APPROACH.md` — branch `qa/<CASEID>` off `qa-suite` (never `main`, never commit to `qa-suite`), and only after 5/5 green independent runs.

## Not defects (do not file)

- Breadcrumbs show URL segments and raw UUIDs app-wide — tracked in #136.
- Automation re-typing appends text into a populated field — harness quirk.
- Missing AI key or missing fixture — `N/D`, not `bug`.
- `apps/admin` gaps — out of QA scope.
- `/edu/classroom` has no index page — decision #292 (PUB-08).

## Handoff — when `studiq-review` calls this skill

The review skill owns the prose. Do the work, then return a short table plus exactly one fenced `json` block (the shape it parses), nothing after it.

- Use the `APP_URL`, `stackId`, branch/commit and accounts from the handoff; confirm them with `env:status --json` and record them.
- One verdict per supplied claim ID, in the supplied order. `PASS` requires reproduced, observed behaviour with evidence. A claim you only read in code or only exercised through the API is `BLOCKED` with reason `not-executed` / `api-only`.
- State which edge-case rows you exercised and which you skipped.
- Every `FAIL` names its filed issue, or says why it could not be filed (duplicate number, no `gh` auth).
- No fixes, commits, PR edits or review comments.

```json
{
  "pr": 1234,
  "head": "<sha>",
  "claims": [
    {
      "id": "C1",
      "verdict": "PASS",
      "evidence": ["qa-C1-03-deck-visibility.png", "PATCH /api/v1/decks/<id> 200 x-trace-id=<id>"],
      "notes": "Group visibility hides the deck from S2 after reload; S1 keeps read-only view."
    }
  ],
  "env": "ok"
}
```

`verdict` ∈ `PASS | FAIL | BLOCKED`; `env` is `ok` or `broken: <why>`. Keep it valid JSON — it is machine-read.
