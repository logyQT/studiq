# Merge Hints — Overlapping Plans

> **Purpose:** Guide for an agent tasked with consolidating duplicate/stale plans.
> Created 2026-09-16 as part of docs cleanup.

---

## Rules of Thumb

1. **Keep the newest, most complete doc** in each group. Archive or delete the rest.
2. **Prefer PRDs over design docs** — PRDs have acceptance criteria and execution steps.
3. **Don't merge across concerns** — a groups doc and a test doc shouldn't be combined.
4. **After merging, delete the old files** (don't just add cross-links — that's the whole point).
5. **Update `ROADMAP.md` cross-references** if any merged file had `> See: docs/plans/X.md` links.

---

## Overlap Group 1: Study Groups (3 files → 1)

These three docs all describe the same "groups" feature at different stages of design:

| File | Lines | Age | Verdict |
|------|-------|-----|---------|
| `archive/GROUPS.md` | 238 | Oldest | **Archive already** — uses old table names (`study_groups`), superseded by both PRDs |
| `archive/groups-prd.md` | 253 | Mid | **Archive already** — P1 implementation, all steps done |
| `archive/p2-groups-prd.md` | 634 | Newest | **Keep as primary** — P2 PRD, has the most complete picture including DB, API, frontend, and diverged design notes |

**Merge action:** Already archived. No further work needed — all three are in `archive/`.

---

## Overlap Group 2: Test Parallelism (2 files → 1)

| File | Lines | Status | Verdict |
|------|-------|--------|---------|
| `test-parallelism.md` | 133 | Superseded | **Already archived** |
| `integration-parallelism.md` | 126 | Final result | **Already archived** |

**Merge action:** Already archived. Both in `archive/`.

---

## Overlap Group 3: Seat Licensing / Org Limits (3 files, spread across layers)

These aren't duplicate — they describe **different layers** of the same system. But they should be cross-referenced:

| File | Lines | Scope | Status |
|------|-------|-------|--------|
| `org-features-and-limits.md` | 264 | Per-org role features + capacity limits | ✅ Implemented, archived |
| `seat-based-licensing.md` | 240 | Seat pools + per-user assignment (builds on above) | ❌ Not started |
| `foundation-agentic-testing.md` | 235 | Phase B.5 cleanup of seat licensing defaults | ❌ Not started |

**Merge action (for future agent):**
- When starting Phase B.5 or seat-based licensing, read all three.
- `seat-based-licensing.md` is the PRD. Use it as the primary.
- `foundation-agentic-testing.md` B.5 section has specific cleanup tasks — fold them into the seat licensing execution plan.
- `org-features-and-limits.md` is implemented context — reference for what already exists.
- Consider adding a "See also" note in `seat-based-licensing.md` pointing to `foundation-agentic-testing.md` §B.5.

---

## Overlap Group 4: Test Coverage / AI Test Pipeline (3 files)

These overlap on "how to test things better" but cover different scopes:

| File | Lines | Scope | Status |
|------|-------|-------|--------|
| `coverage-improvement-handoff.md` | 156 | Backend unit test coverage (43% → 60%) | ❌ Not started |
| `flashcard-testing-pipeline.md` | 630 | AI flashcard generation regression tests | ❌ Not started |
| `100-test-cases.md` | 137 | High-level test case catalog for AI flashcards | ❌ Not started |

**Merge action (for future agent):**
- `100-test-cases.md` is a subset of `flashcard-testing-pipeline.md` — the pipeline doc already incorporates these as fixtures.
- **Delete `100-test-cases.md`** and fold any unique cases into `flashcard-testing-pipeline.md` Appendix A.
- `coverage-improvement-handoff.md` is orthogonal (backend services vs. AI pipeline). Keep separate.

---

## Overlap Group 5: AI Architecture (2 files)

| File | Lines | Scope | Location |
|------|-------|-------|----------|
| `archive/AI-integration.md` | 924 | Full AI spec (Phases 1-3), now historical | `archive/` |
| `archive/ReAct-approach.md` | 362 | ReAct multi-agent implementation record | `archive/` |
| `agent-security.md` | 275 | AI security audit + hardening plan | Active |

**Merge action:** No merge needed — they serve different purposes. But if a new AI spec is written, it should reference `agent-security.md` for the hardening requirements.

---

## Summary: What an Agent Should Do

### Quick wins (no-brainer deletes)

- [ ] **Delete `100-test-cases.md`** — fully subsumed by `flashcard-testing-pipeline.md`. Check for any unique test IDs not in the pipeline doc's Appendix A first.

### Cross-reference additions

- [ ] Add `> See also: docs/plans/foundation-agentic-testing.md §B.5` to `seat-based-licensing.md`
- [ ] Add `> See also: docs/plans/agent-security.md` to any new AI-related PRDs

### Not mergeable (keep separate)

- `agent-security.md` — security concerns are orthogonal to feature PRDs
- `coverage-improvement-handoff.md` — backend coverage, not AI pipeline
- `flashcard-testing-pipeline.md` — AI-specific regression plan
- `teacher-assignments-prd.md` — independent feature
- `SEARCH_SCOPES.md` — independent feature vision

### tbd/ folder — backlog, don't touch

- `QUESTION_TYPES_SPEC.md` — large feature, spec ready
- `RESOURCES.md` — "My Resources" feature
- `AlternativeDashboardUI.md` — unapproved sidebar redesign

---

## Current plans/ after cleanup

```
docs/plans/
├── archive/              # 13 completed/historical docs
│   ├── GROUPS.md
│   ├── groups-prd.md
│   ├── p2-groups-prd.md
│   ├── rbac-overhaul.md
│   ├── org-features-and-limits.md
│   ├── test-parallelism.md
│   ├── integration-parallelism.md
│   ├── FLASHCARD_IMPROVEMENTS.md
│   ├── minor-flash-ui-improvments.md
│   ├── minor-topic-ui-improvements.md
│   ├── ReAct-approach.md
│   ├── MARKDOWN-FLASHCARDS.md
│   └── AI-integration.md
├── tbd/                  # Backlog (not started)
│   ├── QUESTION_TYPES_SPEC.md
│   ├── RESOURCES.md
│   └── AlternativeDashboardUI.md
├── agent-security.md     # Active — security hardening
├── coverage-improvement-handoff.md  # Active — test coverage
├── flashcard-list-timeout-fix.md    # Active — awaiting decision
├── flashcard-testing-pipeline.md    # Active — AI test plan
├── foundation-agentic-testing.md    # Active — phase tracking
├── api-gaps.md           # Active — mostly resolved
├── seat-based-licensing.md          # Pending — future PRD
├── teacher-assignments-prd.md       # Pending — future PRD
├── SEARCH_SCOPES.md      # Pending — vision doc
└── MERGE-HINTS.md        # This file
```
