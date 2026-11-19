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

| Phase | What                                           | State   | PR    | CI  | QA shards                 | Updated    |
| ----- | ---------------------------------------------- | ------- | ----- | --- | ------------------------- | ---------- |
| 0     | docs, ADR-0015, ledger, orchestrator contract  | merged  | #1162 | —   | checks                    | 2026-11-19 |
| 0b    | batch-0 cleanup (N1, dead code, invariants)    | merged  | #1387 | —   | checks, unit, integration | 2026-11-19 |
| 1a    | database types regenerated with the pinned CLI | active  | —     | —   | checks, unit, integration | 2026-11-19 |
| 1     | catalog cutover                                | pending | —     | —   | PUB, ADM, LIM, BIL        |            |
| 2     | authority cutover + control-plane RLS          | pending | —     | —   | AUT, MGR, EDU, SEC        |            |
| 3     | entitlements and limits                        | pending | —     | —   | LIM, BIL, STU             |            |
| 4     | seats and personal plans                       | pending | —     | —   | MGR, BIL, LIM             |            |
| 5     | enforcement closure                            | pending | —     | —   | STU, EDU, MGR, PUB        |            |
| 6     | UI and cache                                   | pending | —     | —   | PUB, AUT, MGR, STU, EDU   |            |
| 7     | delete, full QA, close                         | pending | —     | —   | all 188 + E2E             |            |

**Next action:** phase 0b is merged (#1387); phase 1a (the type-generation
cutover) is in PR; phase 1 starts after it merges.

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

| #   | Rule                                                                                                                                                                                                            | Earned from                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| R1  | Workers never author migrations. SQL goes in the PR body; the integrator renumbers.                                                                                                                             | `check-migration-timestamps` fails on duplicate prefixes                |
| R2  | Regenerate `database.ts` in the same PR when the schema change is consumed by typed code; a dropped, unreferenced table may leave its block until the toolchain is pinned — phase 1 owns the generator cutover. | the pinned v3.1 generator emits a different shape and 7 RPC type errors |
| R3  | `knip.ts` and `eslint-suppressions.json` are integrator-only.                                                                                                                                                   | both hooks run `knip --treat-config-hints-as-errors`                    |
| R4  | A rule that lives in both the API and RLS changes in the same PR.                                                                                                                                               | FP-01 is exploitable through PostgREST                                  |
| R5  | No `allowedAccountTypes` on an org-resource route; the only persona exceptions are org creation and classroom creation.                                                                                         | audit §0.2: 41 of 45 gates are permission checks                        |
| R6  | A QA case that encodes a bug is edited with its spec; it is never skipped.                                                                                                                                      | the corpus is the product contract                                      |
| R7  | Workers may not merge to `main` and may not report a phase done without a CI conclusion.                                                                                                                        | prose is not a verdict                                                  |
| R8  | When a decision narrows scope, grep the whole document for every mention of the removed thing and label it.                                                                                                     | a v1 scope change left six sections describing the deferred table       |
| R9  | Every number in a doc is produced by a command, not by memory.                                                                                                                                                  | "176 specs / 188 cases" mixed two corpora; "seven tables" was nine      |
| R10 | Re-verify every checklist line against the tree before dispatch.                                                                                                                                                | a six-day-old 0b checklist cited three already-shipped items            |
| R11 | Grep a named "single reference" across the whole tree; never trust one.                                                                                                                                         | "only reference is the generated type file" missed a seed `REVOKE`      |
| R12 | A fix is not closed until the write path that can undo it has a test.                                                                                                                                           | the role save drops the `assignment.*` rows the seed grants             |
| R13 | A generated file you cannot regenerate deterministically is a tooling task, not a cleanup edit.                                                                                                                 | the 0b regen produced a different shape and 7 RPC type errors           |
| R14 | Never hand-edit a generated file: the next regeneration deletes the edit, including lint suppressions. Fix the call sites or exempt the file in config.                                                         | the committed `database.ts` carried a hand-added inline eslint-disable  |

## 4. Decisions

All settled 2026-11-13; the full wording is ADR-0015 §15.

| #   | Decision                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `org.admin` is a real permission for ownership only; no superuser override                                                                                                                                                                                                                                 |
| D2  | Managers get a free `solo` plan; `launch` is organization-only                                                                                                                                                                                                                                             |
| D3  | Personal plans are portable for `personalPortable` keys and user-scope quotas only                                                                                                                                                                                                                         |
| D4  | A seat can only raise a user-scope limit: `max(org, seat, personal)`, `-1` short-circuits                                                                                                                                                                                                                  |
| D5  | v1 ships `entitlement_profile` (`all \| learner \| none`); allocation is deferred                                                                                                                                                                                                                          |
| D6  | Teacher `all`, Member `learner`, Custom `none`                                                                                                                                                                                                                                                             |
| D7  | Class invites use `group.invite` for existing org members; no external invites in v1                                                                                                                                                                                                                       |
| D8  | Flags are a kill switch only (`is_enabled = false`); no rollout percentage                                                                                                                                                                                                                                 |
| D9  | `flashcards` and `quiz` are baseline, always on, never gated                                                                                                                                                                                                                                               |
| D10 | `account_type` is not renamed in this programme; the semantics change only                                                                                                                                                                                                                                 |
| D11 | This programme fixes control-plane RLS only; content RLS is a separate security ADR                                                                                                                                                                                                                        |
| D12 | Overrides bypass flags                                                                                                                                                                                                                                                                                     |
| D13 | A `student` persona may hold the Admin role                                                                                                                                                                                                                                                                |
| D14 | Persona is a UI filter for plan purchases; the one server check is seat assignment against `audience`                                                                                                                                                                                                      |
| D15 | Org plans grant ZERO licences; licences are sold separately. A licence is the purchased unit (`org_seat_pools` = the licence pool, its `plan_key` must be `scope='personal'` + `seatEligible`); `org_seat_assignments` is one member occupying one licence. No `plan_seat_grants`, no `org_seat_licenses`. |

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
Rule: a queue of small PRs into `main`, gated per PR, replaces a long-lived
integration branch — the branch added a serialization point and no safety.

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

#### 2026-11-13 — the review caught a contract/queue collision

What: the first draft deferred the allocation table but kept six sections
describing it as the v1 shape; the queue claimed phase 3 closes FP-08 while its
residual sits in phase 4; the QA map mixed two corpus counts; and the audit's
"no paid key is enforced" was false (`branding` is).
Why: the v1 scope was settled _after_ the ADR was written, so only the touched
sections were updated — and two numbers came from a summary instead of a command.
Fix: marked the allocation design v1.1 everywhere, moved the N1 backfill and the
seat-tier revalidation to their phases, split the counts, corrected the FP-10
row, and added N3 (seat↔role tier not revalidated on role change).
Rule: R8 and R9.

### Phase 0b — batch 0

**Shipped (#1387):**

- `resource_permissions` dropped (`20261119120000_authority_batch0_cleanup.sql`)
  and removed from the `99_dev_grants.sql` `REVOKE` list, which has no
  `IF EXISTS` and would otherwise break `db reset`. The generated
  `database.ts` still carries its block: the pinned generator cannot reproduce
  the committed file (R2/R13), and nothing reads the block.
- The six entitlement rows deleted from `permissions` (`study.create`,
  `study.participate`, `test.create`, `test.participate`, `ai.chat`,
  `org.manage`). Existing orgs are unchanged — their `org_role_permissions`
  rows are left dangling on purpose because `withAuth` still serves them, so the
  sweep lands with the phase 2 foreign key. Newly created orgs get the corrected
  catalog: `handle_new_organization` copies `permissions`, so their
  `admin`/`teacher` roles carry 32 → 26 rows and `member` 26 → 20, and a new-org
  member's `/permissions/me` no longer lists `ai.chat`/`org.manage`.
  `org.manage` stays in `feature_flags` and `ADMIN_ONLY_FEATURES` until phase 1.
- The dead `X-Feature-Rollout` header and its two comments deleted; the `rollout`
  field still ships in the response body, and `feature_flags.rollout_percentage`
  stays, until phase 3 / D8 removes both.
- New unit guard: every literal key read through `permissionScopes['…']` or
  `resolveScope(ctx, '…')` in `packages/server/src` and `apps/*` must be a
  `Permission` key. Runtime-assembled keys are out of scope.
- New integration invariants: `permissions` ∩ `FEATURES` = ∅, `permissions` is
  exactly `Permission`, and every `FEATURES` key has a `feature_flags` row
  (narrows in phase 1, when baseline keys no longer need one).
- Already shipped before this PR: the `assignment.*` catalog rows and the
  system-role backfill (#1256), and the limit-key invariant (#233,
  `plan-limit-catalog.test.ts`).
- **Not closed:** `orgRoleService.setPermissions` deletes every row for a role
  and re-inserts only the client payload, and `/manage/roles` does not render
  `assignment.*` — saving a system role from the editor drops the family again.
  Phase 2 owns the catalogue-driven editor and the test.

**QA baseline (2026-11-19):** all 37 at-risk cases from
[role-authority-rollout.md](role-authority-rollout.md) §4, one run each against
`main` @ `8aab828e`, fresh tenant per case, `--workers=1`, zero retries:
**37/37 PASS**, 59 Playwright tests green. Per case:

```bash
bun run env:run -- bun scripts/qa-tenant.ts <CASE-ID> --fresh --run baseline
bun run env:run -- bunx playwright test -c __tests__/qa/playwright.qa.config.ts __tests__/qa/<AREA>/<CASE-ID>.spec.ts --workers=1
```

One infra note (not product): the browser cache held chromium-1248 while the
config expects 1254; `bunx playwright install chromium` fixed it.

**QA smoke (2026-11-19):** 5/5 PASS — MGR-ROL-03 (20 content radios), MGR-ROL-04 (system-role guards), MGR-SET-02 (branding upload survives org switch), PUB-04 (plan cards from the catalogue), LIM-05 (branding refused after Hub→Launch); no catalog-related console or network errors.

**Difficulty log**

#### 2026-11-19 — the 0b checklist was six days old and three lines were already shipped

What: the checklist written on 2026-11-13 still asked for the `assignment.*`
catalog rows, the N1 backfill and the limit-key invariant. `#1256` shipped the
first two on 2026-11-16 and `plan-limit-catalog.test.ts` (#233) already covered
the third.
Why: the checklist was verified against `b4186312` and nothing re-read the tree
when the phase was picked up six days later.
Fix: re-checked every line; 0b keeps only what was still missing — the drop and
its seed line, the six catalog rows, the header, the two new tests, the docs.
Rule: re-verify every checklist line against the tree before dispatch.

#### 2026-11-19 — "only reference is the generated type file" missed a `REVOKE`

What: the plan named `packages/server/src/types/database.ts` as
`resource_permissions`' only reference. `supabase/seeds/99_dev_grants.sql`
also lists it in a `REVOKE`, and `REVOKE` has no `IF EXISTS`, so the drop alone
fails a fresh `db reset`.
Why: one known reference was treated as an inventory.
Fix: grepped the identifier across `supabase/`, `packages/`, `apps/` and
`__tests__/`, and removed the seed line in the same commit as the migration.
Rule: grep a named "single reference" across the whole tree; never trust one.

#### 2026-11-19 — the seed closes N1 on read, and the role save drops the rows again

What: `#1256` gives `admin` and `teacher` their `assignment.*` rows, but
`orgRoleService.setPermissions` deletes every row for the role and re-inserts
only the payload, while `/manage/roles` renders a hardcoded group list without
`assignment.*`. Saving a system role silently removes the family and N1 returns.
Why: the fix was proven against seeded data, not against the write path that
rewrites the same rows.
Fix: recorded here; phase 2 adds the catalogue-driven editor and the test, with
an acceptance criterion in the rollout plan.
Rule: a fix is not closed until the write path that can undo it has a test.

#### 2026-11-19 — the type generator cannot reproduce the committed `database.ts`

What: `bunx supabase gen types` at the pinned v3.1 emits a different shape and
7 RPC-argument type errors in 4 files; the committed file came from an older
generator that cannot parse the v3 stack config.
Why: the 0b checklist listed "type regen" as free work, and R2 assumed
regeneration is always available.
Fix: `database.ts` is untouched and `resource_permissions` keeps a dead block
that nothing reads. Phase 1 pins the toolchain or fixes the call sites.
Rule: R13.

#### 2026-11-19 — integration is green serially and red in parallel on this host

What: `bun run env:run -- bun run test:integration` on this 16-core host fails
10–20 assignment/exposure tests, different files each run;
`bun run env:run -- bunx vitest run --no-file-parallelism` is green (813 passed,
11 skipped, 93 files). The parallelism exceeds the 4-vCPU CI runner.
Why: the per-file fixtures share the seeded org and are not safe at that
concurrency; CI's smaller runner never exposed it.
Fix: recorded here; the coordinator runs the serial form on this host.
Rule: none — host/CI concurrency difference, not a programme rule.

**Done when:** the `assignment.*` catalog rows exist (shipped, #1256),
`resource_permissions` is dropped, the dead header is gone, and the catalog
invariants are integration tests. The generated `database.ts` keeps the dead
table block until the toolchain is pinned (R2/R13); the role-editor write path is
phase 2.

### Phase 1a — database types

**Shipped in PR (active):**

- `packages/server/src/types/database.ts` regenerated with the pinned CLI 3.1
  (`bun run env:supa gen types typescript --schema public`, then `bun fmt`).
  The stale file was produced by an older generator: the new one drops the
  `graphql_public` schema and its `graphql` function, drops the
  `resource_permissions` block (dropped in 0b), fills the two billing tables'
  `Relationships` arrays that the old file left empty, and adds four RPCs the
  old file never saw (`activity_stamp_client_write`,
  `rls_caller_can_read_assignment_items`, `rls_caller_can_read_assignment_targets`,
  `rls_caller_is_sealed_item`). Every table and enum the live schema has is
  present (52 tables, 0 views); the only functions absent are trigger functions,
  which the generator omits on purpose.
- Nullable RPC parameters are now `?: T` instead of `?: T | null`, so the seven
  call sites in `notification`, `search`, `flashcard-stats` and `stats` pass
  `undefined` (the argument is omitted and PostgREST applies the SQL
  `DEFAULT NULL`, proven from `pg_get_function_arguments`) instead of `null`;
  `notifications.payload` narrows to `NonNullable<Json>` because the column is
  `NOT NULL DEFAULT '{}'`. No runtime change.
- The generated file's one lint finding is exempted in `bunfig.toml`, not with an
  inline disable.

**Gates:** `typecheck:all`, `lint:all`, `test:unit`, `review:static`, `knip`,
`dup:base`, `format:check`, and the serial integration run (813 passed, 11
skipped), all green.

**Difficulty log**

#### 2026-11-19 — the committed `database.ts` had been hand-edited

What: regenerating exposed more than the seven RPC type errors. The committed
file carried an inline `eslint-disable-next-line` that the generator never
emits, so `bun run lint` failed on the fresh output with a warning budget of
zero; and `bunx oxfmt` — the formatter the CLI itself prints — is not this
repo's formatter, so `format:check` still failed until the file went through
`bun fmt`. The old file's populated-looking `Relationships: []` entries were
also stale: only a regen shows which foreign keys the old generator could not
introspect.
Why: the previous generation was patched by hand, so the committed "baseline"
was not reproducible; every fix that lived in the file was invisible until the
next regen deleted it.
Fix: the call sites carry the real fix (`undefined` where the SQL default is
NULL, `NonNullable<Json>` for the `NOT NULL` payload column), the lint
exemption moved to `bunfig.toml` as a file override, and the file went through
`bun fmt`. Nothing is edited in the output.
Rule: pin the generator or accept its new shape; never hand-edit the generated
file — a hand edit only survives until the next regeneration.

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
