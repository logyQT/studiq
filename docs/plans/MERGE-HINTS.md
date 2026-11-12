# Merge Hints — Overlapping Plans

> **Purpose:** Guide for an agent tasked with consolidating duplicate/stale plans.
> **Refreshed 2026-11-12 against `main` after #1119.** Re-check the tree before acting; plans land faster than this file.
> **P0–P3 executed 2026-11-12:** duplicate docs and handoffs deleted; stale statuses and links corrected; completed plans archived.

---

## Out of scope: handled by #1119

These files were deleted or moved by the docs prune. Do **not** add them to an overlap group, resurrect them, or "rescue" content from them:

| File                        | Outcome                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `docs/GIT-FOR-NOOBS.md`     | Deleted — git tutorial with no audience                                                            |
| `docs/api.md`               | Deleted — pre-monorepo route dump; billing content moved to `docs/deployment.md#billing-endpoints` |
| `docs/authentication.md`    | Deleted — retired middleware-era auth flow                                                         |
| `docs/project-structure.md` | Deleted — `AGENTS.md` owns the layout                                                              |
| `docs/e2e-campaign.md`      | Moved to `docs/plans/archive/e2e-campaign.md`; parked, no merge work                               |

New from #1119 and **not** merge candidates: `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/*`, and the `docs/deployment.md#billing-endpoints` section.

---

## Rules of Thumb

1. **Keep the newest, most complete doc** in each group. Archive or delete the rest.
2. **Prefer PRDs over design docs** — PRDs have acceptance criteria and execution steps.
3. **Don't merge across concerns** — a groups doc and a test doc shouldn't be combined.
4. **After merging, delete the old files** (don't just add cross-links — that's the whole point).
5. **Update `ROADMAP.md` cross-references** if any merged file had `> See: docs/plans/X.md` links.

---

## Resolved — no action

### Study groups (3 archived)

| File                       | Lines | Verdict                                                                       |
| -------------------------- | ----- | ----------------------------------------------------------------------------- |
| `archive/GROUPS.md`        | 241   | Old table names (`study_groups`), superseded by both PRDs                     |
| `archive/groups-prd.md`    | 259   | P1 implementation, all steps done                                             |
| `archive/p2-groups-prd.md` | 652   | Primary reference — most complete P2 picture (DB, API, frontend, divergences) |

Already archived. No merge.

### Test parallelism (resolved)

`archive/integration-parallelism.md` (126 lines) is the final result. The superseded handoff prompt (`archive/test-parallelism.md`) and its stale pointer in `foundation-agentic-testing.md` were deleted. No merge.

---

## Group 1: Seat licensing / org limits — shipped, close the paper trail

| File                                 | Lines | Status                                        |
| ------------------------------------ | ----- | --------------------------------------------- |
| `archive/org-features-and-limits.md` | 250   | Phase 1, archived                             |
| `archive/seat-based-licensing.md`    | 253   | Phase 2, **implemented** (ROADMAP Phase 6 ✅) |
| `foundation-agentic-testing.md` §B.5 | —     | **COMPLETE** — reconciled 2026-11-12          |

B.5 landed: `20260915000003_drop_plan_seat_allocations.sql` removed default allocation; `seat.service.ts` is role-aware; `feature.resolver.ts` / `limits.resolver.ts` have the seat branch. Only the Stripe quantity wiring remains deferred (owned by #662 / #1019). The PRD was archived 2026-11-12.

Do **not** re-plan B.5 or fold it into a new seat-licensing execution plan; the work is done.

---

## Group 2: Testing plans — 3 docs, no merge

These overlap on "test the app better" but are not one document. Keep the scopes separate.

| File                            | Lines | Scope / status                                                                                    |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| `foundation-agentic-testing.md` | 340   | Tracking plan. Phases A/B/B.5/C complete; C8 and D deferred. **Primary tracker.**                 |
| `frontend-component-testing.md` | 312   | Decisions locked (Vitest Browser Mode); Phase-C blocker removed, so it is an execution candidate. |
| `flashcard-testing-pipeline.md` | 685   | AI flashcard regression pipeline. Appendix A contains all 100 routes. **Primary AI test plan.**   |

Two former docs are gone: `100-test-cases.md` was a strict duplicate of Appendix A, and `coverage-improvement-handoff.md` was a stale handoff (removed paths, Biome, deleted services) — both deleted 2026-11-12.

**Action:** keep `flashcard-testing-pipeline.md` as the AI-test primary; do not merge the frontend component plan into it.

---

## Group 3: AI architecture — no merge

| File                        | Lines | Purpose                                                 |
| --------------------------- | ----- | ------------------------------------------------------- |
| `archive/AI-integration.md` | 1110  | Historical full AI spec (Phases 1–3)                    |
| `archive/ReAct-approach.md` | 365   | Historical ReAct multi-agent record                     |
| `agent-security.md`         | 277   | Live security audit + hardening plan                    |
| `docs/ai.md`                | —     | Unified current architecture, tools and extension guide |

No merge. If a new AI spec is written, point it at `docs/ai.md` and `agent-security.md`; do not re-open the archived specs as current design.

---

## Group 4: Implemented / close-out plans — no merge

| File                                       | Lines | Status                                                                                    |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------------------------- |
| `archive/prometheus-metrics-monitoring.md` | 271   | **Implemented**, archived 2026-11-12.                                                     |
| `archive/bun-native-toolchain.md`          | 156   | Phase 1 + strict core implemented; `perf`/`style` rejected. Follow-ups live in the audit. |
| `archive/seat-based-licensing.md`          | 253   | Implemented, archived 2026-11-12 (see Group 1).                                           |
| `662-stripe-integration.md`                | 1606  | Implementation complete; **keep active only for go-live #1019**.                          |

**Do not delete #662 yet** — #1019 is the remaining go-live tracker. When it closes, archive the whole doc rather than folding it into another plan.

---

## Group 5: Environment / deployment — related, not duplicates

| File                     | Lines | Status                                                         |
| ------------------------ | ----- | -------------------------------------------------------------- |
| `env-tool.md`            | 340   | Phase 0 complete; phases 1–3 unblocked. Active execution plan. |
| `staging-environment.md` | 408   | Proposed, not started.                                         |

Keep separate: local developer environment vs. hosted staging are different layers. Add a "See also" from `staging-environment.md` to `env-tool.md` / `docs/deployment.md` if useful — but do not merge them.

---

## Independent plans — don't merge

- `api-gaps.md` (55) — mostly closed; only the **Subjects** create route remains as a documented gap.
- `flashcard-list-timeout-fix.md` (81) — awaits a decision (trigram GIN vs. full-text search).
- `teacher-assignments-prd.md` (180) — independent feature PRD.
- `SEARCH_SCOPES.md` (97) — independent search vision.
- `tbd/QUESTION_TYPES_SPEC.md` (836), `tbd/RESOURCES.md` (286), `tbd/AlternativeDashboardUI.md` (115) — backlog, not approved; don't touch.

---

## Action checklist

### Done 2026-11-12

- [x] Delete `docs/plans/100-test-cases.md` — fully covered by `flashcard-testing-pipeline.md` Appendix A.
- [x] Delete `docs/plans/coverage-improvement-handoff.md` and `docs/plans/archive/test-parallelism.md` — stale handoffs.
- [x] `foundation-agentic-testing.md`: remove the test-parallelism handoff, fix the e2e label, mark Phase B and B.5 complete, correct Phase C/E status.
- [x] `662-stripe-integration.md`: point the two deleted-`api.md` references at `docs/deployment.md#billing-endpoints`.
- [x] `frontend-component-testing.md`: remove the expired Phase-C blocker and update the dependency diagram.
- [x] `flashcard-list-timeout-fix.md`: repair code fences/encoding and the old `src/server` path.

### P2 — archive completed plans

- [x] `prometheus-metrics-monitoring.md` → `archive/`.
- [x] `seat-based-licensing.md` → `archive/` (implemented).
- [x] `bun-native-toolchain.md` → `archive/`; follow-ups stay in `docs/audits/173-bun-strictness-premise.md`.
- [ ] Keep `662-stripe-integration.md` active until #1019 closes.

### P3 — cross-link

- [x] Add a "See also" between `staging-environment.md`, `env-tool.md` and `docs/deployment.md`.
- [x] Update links to the archived plans (`ROADMAP.md`, `docs/observability-debugging.md`, ADR-0007, the Bun audit).

---

## Current `docs/plans/` after the 2026-11-12 cleanup

```
docs/plans/
├── archive/                                  # 16 historical/parked docs
│   ├── e2e-campaign.md                       # moved here by #1119; parked
│   ├── groups-prd.md, p2-groups-prd.md, GROUPS.md
│   ├── integration-parallelism.md            # final test-parallelism result
│   ├── org-features-and-limits.md, rbac-overhaul.md
│   ├── AI-integration.md, ReAct-approach.md
│   ├── seat-based-licensing.md               # implemented
│   ├── prometheus-metrics-monitoring.md      # implemented
│   ├── bun-native-toolchain.md               # implemented
│   └── ...                                   # 4 more historical docs
├── tbd/                                      # backlog, not approved
│   ├── QUESTION_TYPES_SPEC.md
│   ├── RESOURCES.md
│   └── AlternativeDashboardUI.md
├── 662-stripe-integration.md                 # active — go-live #1019
├── MERGE-HINTS.md                            # this file
├── SEARCH_SCOPES.md                          # independent vision
├── agent-security.md                         # active security plan
├── api-gaps.md                               # active — mostly closed
├── env-tool.md                               # active — phases 1–3
├── flashcard-list-timeout-fix.md             # awaiting decision
├── flashcard-testing-pipeline.md             # active — AI test primary
├── foundation-agentic-testing.md             # active — tracking plan
├── frontend-component-testing.md             # decisions locked — unblocked
├── staging-environment.md                    # proposed
└── teacher-assignments-prd.md                # pending PRD
```
