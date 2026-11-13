# Role-authority programme — plan and memory

This file is the programme's **shared memory**. It is updated in the same PR as
the code it describes, so it cannot drift from `main`. An agent starting a phase
reads this file first; nothing here is replaced by chat history.

- Spec: [role-authority-rollout.md](role-authority-rollout.md)
- Decision record: [ADR-0015](../decisions/0015-role-based-authority.md)
- Evidence: [audit §0](../audits/features-perms-weak-spots.md)
- Operating contract: [role-authority-orchestrator.md](role-authority-orchestrator.md)

## 1. Status

States: `pending` · `active` · `pr-open` · `green` · `merged` · `blocked`.

| Phase | What                                          | State   | PR  | CI  | QA shards                 | Updated    |
| ----- | --------------------------------------------- | ------- | --- | --- | ------------------------- | ---------- |
| 0     | docs, ADR-0015, ledger, orchestrator contract | pr-open | —   | —   | checks                    | 2026-11-13 |
| 0b    | batch-0 cleanup (N1, dead code, invariants)   | pending | —   | —   | checks, unit, integration |            |
| 1     | catalog cutover                               | pending | —   | —   | PUB, ADM, LIM, BIL        |            |
| 2     | authority cutover + control-plane RLS         | pending | —   | —   | AUT, MGR, EDU, SEC        |            |
| 3     | entitlements and limits                       | pending | —   | —   | LIM, BIL, STU             |            |
| 4     | seats and personal plans                      | pending | —   | —   | MGR, BIL, LIM             |            |
| 5     | enforcement closure                           | pending | —   | —   | STU, EDU, MGR, PUB        |            |
| 6     | UI and cache                                  | pending | —   | —   | PUB, AUT, MGR, STU, EDU   |            |
| 7     | delete, full QA, close                        | pending | —   | —   | all 188 + E2E             |            |

**Next action:** phase 0b.

## 2. How to update this file

- One writer per phase. If two lanes run at once, each appends only to its own
  phase block.
- Update the status row and add a `### Difficulty log` entry **in the same PR**
  that changes the phase. A green phase with no ledger entry is incomplete.
- The difficulty log is append-only. Never rewrite or delete an entry, even
  when it turns out to be wrong — add a correction under it.
- **Every difficulty entry ends with a `Rule:` line**, and a new rule is added
  to §3 only when an entry produced it. That is how the memory pays for itself.
- Do not record what the diff already says. Record what a future agent cannot
  infer: why a decision was taken, what was tried and failed, which constraint
  is invisible from the code.

## 3. Rules (earned, not invented)

| #   | Rule                                                                                                                    | Earned from                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1  | Workers never author migrations. SQL goes in the PR body; the integrator renumbers.                                     | `check-migration-timestamps` fails on duplicate prefixes |
| R2  | `packages/server/src/types/database.ts` is regenerated after merge, never hand-resolved.                                | it is generated and committed                            |
| R3  | `knip.ts` and `eslint-suppressions.json` are integrator-only.                                                           | both hooks run `knip --treat-config-hints-as-errors`     |
| R4  | A rule that lives in both the API and RLS changes in the same PR.                                                       | FP-01 is exploitable through PostgREST                   |
| R5  | No `allowedAccountTypes` on an org-resource route; the only persona exceptions are org creation and classroom creation. | audit §0.2: 41 of 45 gates are permission checks         |
| R6  | A QA case that encodes a bug is edited with its spec; it is never skipped.                                              | the corpus is the product contract                       |
| R7  | Workers may not merge to `main` and may not report a phase done without a CI conclusion.                                | prose is not a verdict                                   |

## 4. Decisions

All settled 2026-11-13; the full wording is ADR-0015 §15.

| #   | Decision                                                                                  |
| --- | ----------------------------------------------------------------------------------------- |
| D1  | `org.admin` is a real permission for ownership only; no superuser override                |
| D2  | Managers get a free `solo` plan; `launch` is organization-only                            |
| D3  | Personal plans are portable for `personalPortable` keys and user-scope quotas only        |
| D4  | A seat can only raise a user-scope limit: `max(org, seat, personal)`, `-1` short-circuits |
| D5  | v1 ships `entitlement_profile` (`all \| learner \| none`); allocation is deferred         |
| D6  | Teacher `all`, Member `learner`, Custom `none`                                            |
| D7  | Class invites use `group.invite` for existing org members; no external invites in v1      |
| D8  | Flags are a kill switch only (`is_enabled = false`); no rollout percentage                |
| D9  | `flashcards` and `quiz` are baseline, always on, never gated                              |
| D10 | `account_type` is not renamed in this programme; the semantics change only                |
| D11 | This programme fixes control-plane RLS only; content RLS is a separate security ADR       |
| D12 | Overrides bypass flags                                                                    |
| D13 | A `student` persona may hold the Admin role                                               |
| D14 | Persona is a UI filter for plan purchases, never a server gate                            |

New decisions discovered during execution go here **and** into ADR-0015 in the
same PR. An orchestrator that needs a decision it cannot find stops and asks.

## 5. Phase log

### Phase 0 — docs

**Difficulty log**

#### 2026-11-13 — the integration-branch draft was abandoned

What: the earlier plan required `exp/role-authority`, a conductor and a second
stack; after 13 days it held docs only, was 98 commits behind, and had disabled
the QA gate on its own PRs.
Why: the branch added a serialization point without removing risk, and the ADR
already said each batch is independently shippable.
Fix: re-verified all 22 findings, renumbered the ADR, and replaced the queue
with direct PRs to `main`.
Rule: see section 2 — the ledger and the per-PR gate replace the branch.

#### 2026-11-13 — ADR number collision

What: the ADR was written as `0008`, but `main` took `0008` for the CI scope
gate on 2026-11-04; `bun run lint` fails on a duplicate number and on ambiguous
`ADR-NNNN` citations.
Why: the branch was 13 days old and never merged `main`.
Fix: renumbered to `0015` and updated every citation.
Rule: an ADR number is taken at merge, not at draft.

#### 2026-11-13 — `entitlement_profile` replaces the boolean

What: the settled answers "inherit-only in v1" and "Member explicit" could not
both hold with a boolean plus no allocation table: a Member would either inherit
everything (builder, advanced stats) or nothing.
Why: the allocation table was deferred for cost, but the Member baseline is a
product requirement.
Fix: one three-valued column (`all | learner | none`) with the learner set as a
constant in `@studiq/authz`; no table, no trigger, no prune.
Rule: when a boolean cannot express a settled decision, widen the enum rather
than reintroduce the deferred table.

### Phase 0b — batch 0

_Not started._

**Done when:** the `assignment.*` catalog rows exist (or the checks are deleted),
`resource_permissions` is dropped, the dead header is gone, and the catalog
invariants are integration tests.

### Phase 1 — catalog

_Not started._

### Phase 2 — authority

_Not started._

### Phase 3 — entitlements and limits

_Not started._

### Phase 4 — seats and personal

_Not started._

### Phase 5 — enforcement

_Not started._

### Phase 6 — UI and cache

_Not started._

### Phase 7 — delete and close

_Not started._
