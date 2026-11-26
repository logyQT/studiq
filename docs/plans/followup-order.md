# Follow-up order after the authority programme

**Status:** active. Ordered 2026-11-25, after ADR-0015 phase 8 merged (`d287fd61`).
**Scope:** the open follow-ups. This file gives their order and their dependencies. It does not
replace the issues. Each issue holds the detail.

Update this file in the same PR that closes a step. Move a row to "Done" and add the PR number.

## Rule

Fix open defects before new features. The order below follows that rule.

## A. Close the open defects

| Step                                                                             | Issue | What it fixes | Exit criterion | Depends on |
| -------------------------------------------------------------------------------- | ----- | ------------- | -------------- | ---------- |
| A2 closed the seed half of A1's rule. A3 merged the public pricing filter, so B1 |
| and B2 are unblocked on it. A6 closes the last A-step: the defect list is empty. |

## Done

| Step | Issue     | PR    | Result                                                                                                                                                                                                                                                |
| ---- | --------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | **#1494** | #1499 | Migrations own the plan catalogue; the seed writes no plan data.                                                                                                                                                                                      |
| A2   | **#1502** | #1503 | Seeds hold test data only; migrations own the permission catalogue and all DDL.                                                                                                                                                                       |
| A3   | **#1484** | #1506 | The public pricing read hides a kill-switched key and a DB-ahead key.                                                                                                                                                                                 |
| A4   | **#1482** | #1510 | The stats triggers are definer-only; INSERT/UPDATE/DELETE are revoked; an integration case pins it.                                                                                                                                                   |
| A5   | **#1478** | #1474 | The queue waits for settled checks and merges on `mergeStateStatus == CLEAN`, so a docs-only PR lands.                                                                                                                                                |
| A6   | **#1492** | #1512 | `--name` is the exact, anchored title; `--name-regex` is the pattern escape hatch.                                                                                                                                                                    |
| B1   | **#1193** | #1513 | One individual ladder: Free / Plus / Pro / Max on `base` / `spark` / `ace` / `pro`. `audience` retires; no personal `-1`; the organization ladder stays for B2. The operator settled four tiers on 2026-11-26, not the three this row first proposed. |
| B2   | **#1493** | #1517 | Three capacity-only organization tiers: Launch 5/3, Hub 50/20, Campus 1000/100. `team` folds into `hub`; no org entitlement (baseline kept); seats frozen at the UI; AI deferred to #1511.                                                            |

A4 moved the two stats triggers behind definer functions, so no user client writes the
table. A fresh local review and served QA ran before the PR opened.

## B. Simplify the plans

| Step | Issue     | What it does                                                         | Exit criterion                                                                                                             | Depends on                                       |
| ---- | --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| B3   | **#1495** | Unlisted plans, pinned to one organization, for sales-led contracts. | A plan can be `unlisted`, assigned to one org, and refused for every other org. Checkout refuses it. Public reads hide it. | B2 (the enterprise tier), A3 (the public filter) |

Target: seven public SKUs. Four individual (Free / Plus / Pro / Max), three organization
(Launch / Hub / Campus). Enterprise is an unlisted plan (B3).

## C. Build the shell

| Step | Issue     | What it does                                                                         | Exit criterion                                                                                                                     | Depends on                       |
| ---- | --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| C1   | **#1490** | One nav manifest and one shell across `/manage`, `/edu` and `/app`. No route change. | One manifest declares each item's permission and entitlement. No page file holds a `permissions[]` array. A corpus shard is green. | B (the shell shows the plan set) |
| C2   | **#1488** | Per-user nav preferences: order, custom categories, renames.                         | One row per user. Two devices show the same layout. A new shipped category appears without a backfill.                             | C1                               |

## D. Decide the route shape

| Step | Issue     | What it does                                                  | Exit criterion                                                                                                          | Depends on                          |
| ---- | --------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| D1   | **#1491** | Decide one `/app` for every persona, or keep the three areas. | The decision is in ADR-0015 §7.1. If the answer is "one `/app`", R47 is superseded and the corpus moves in the same PR. | C1, and the operator decision below |

C1 gives most of the code reduction with no route change. Do D1 only after C1.

## E. Rework onboarding

| Step | Issue     | What it does                                                | Exit criterion                                                                                                              | Depends on |
| ---- | --------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| E1   | **#1489** | Rework onboarding on top of the shell and the new plan set. | A new user reaches a usable shell with the right items. Onboarding asks nothing that the shell or the plan already answers. | B, C, D    |

## Decisions the operator must make

1. **B1: the AI price — settled 2026-11-26.** AI moves down to Plus at 19.99; Pro and Max add
   insights and higher limits. The entry price does not rise and educators keep one entry tier.
2. **B2: the org tier to fold — settled 2026-11-26.** `team` folds into `hub`; org plans sell
   capacity only (no entitlements, baseline keys kept); the seat sale and assign entries are
   hidden while the data path stays read-only; AI moves to #1511.
3. **D1: one `/app` or three areas.** This reopens R47, a do-not-reopen item. It needs an explicit
   decision.
4. **D37 (proposed, not scheduled):** a default entitlement outside any plan. It needs an ADR-0015
   amendment before any code.

## Not scheduled

- Per-role or per-org sidebar layouts. This is O(orgs × roles) writes. Phase 7 deleted that shape.
- Per-org entitlement override tables. A pinned plan (B3) gives the same result with no resolver
  change.
- Dashboards and widgets per user. Wait for C2 to settle.

## Gate for every step

Run the standard gates: `typecheck:all`, `typecheck:admin`, `lint`, `review:static`, `knip`,
`format:check`, `dup:base`, `pr:size`, `test:unit`. Use a fresh reviewer. Use a fresh fixer for
corrections. Run served QA for each changed surface. Record the result in the issue and in this
file.
