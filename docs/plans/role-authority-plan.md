# Role-authority programme — plan and memory

This file is the programme's **shared memory**. It is updated in the same PR as
the code it describes, so it cannot drift from `main`. An agent starting a phase
reads this file first; nothing here is replaced by chat history.

- Spec: [role-authority-rollout.md](role-authority-rollout.md)
- Decision record: [ADR-0015](../decisions/0015-role-based-authority.md)
- Evidence: [audit §0](../audits/features-perms-weak-spots.md)
- Operating contract: [role-authority-orchestrator.md](role-authority-orchestrator.md)

**Context recovery.** This ledger is the authoritative memory. An orchestrator
session can be scoured with `opencode session list` and
`opencode session export <id>` (grep for decisions, command pairs and PR
numbers); chat history is never the source of truth.

## 1. Status

States: `pending` · `active` · `pr-open` · `green` · `merged` · `blocked`.

| Phase | What                                           | State   | PR    | CI  | QA shards                 | Updated    |
| ----- | ---------------------------------------------- | ------- | ----- | --- | ------------------------- | ---------- |
| 0     | docs, ADR-0015, ledger, orchestrator contract  | merged  | #1162 | —   | checks                    | 2026-11-19 |
| 0b    | batch-0 cleanup (N1, dead code, invariants)    | merged  | #1387 | —   | checks, unit, integration | 2026-11-19 |
| 1a    | database types regenerated with the pinned CLI | merged  | #1388 | —   | checks, unit, integration | 2026-11-19 |
| 1b    | catalog rename (tables, limits, permissions)   | merged  | #1389 | —   | checks, unit, integration | 2026-11-19 |
| 1c    | catalog cutover (ENTITLEMENTS, documents)      | merged  | #1390 | —   | PUB, ADM, LIM, BIL        | 2026-11-19 |
| 2     | authority cutover + control-plane RLS          | active  | —     | —   | AUT, MGR, EDU, SEC        | 2026-11-19 |
| 3     | entitlements and limits                        | pending | —     | —   | LIM, BIL, STU             |            |
| 4     | seats and personal plans                       | pending | —     | —   | MGR, BIL, LIM             |            |
| 5     | enforcement closure                            | pending | —     | —   | STU, EDU, MGR, PUB        |            |
| 6     | UI and cache                                   | pending | —     | —   | PUB, AUT, MGR, STU, EDU   |            |
| 7     | delete, full QA, close                         | pending | —     | —   | all 188 + E2E             |            |
| 8     | extendability audit (release gate)             | pending | —     | —   | all 188 + E2E             | 2026-11-19 |

**Next action:** phases 0b (#1387), 1a (#1388), 1b (#1389) and 1c (#1390,
`67cfeb16`) are merged. Phase 2 is active: **2a-3** (the closed-catalog editor),
**2a-1** (the entitlement profile), **2a-2** (role presets + the
`org.role.manage` gate and its RLS twin) and **2a-4** (org-scoped
`ctx.groupRoles`) are written on `feat/authority-2a-3`, `feat/authority-2a-1`,
`feat/authority-2a-2` and `feat/authority-2a-4`; 2a-3 lands before 2a-2 by D24.
Next slice: 2a-5 (fail-closed scope defaults), which reads `ctx.groupRoles`. The
four legacy management keys stay until slice 2b, which replaces their remaining
gates with permissions.

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

| #   | Rule                                                                                                                                                                                  | Earned from                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Workers never author migrations. SQL goes in the PR body; the integrator renumbers.                                                                                                   | `check-migration-timestamps` fails on duplicate prefixes                                                                           |
| R2  | Regenerate `database.ts` in the same PR as any schema change typed code consumes; phase 1a performed the generator cutover, so regeneration is a routine step, not a tooling project. | the pinned v3.1 generator emits a different shape and 7 RPC type errors                                                            |
| R3  | `knip.ts` and `eslint-suppressions.json` are integrator-only.                                                                                                                         | both hooks run `knip --treat-config-hints-as-errors`                                                                               |
| R4  | A rule that lives in both the API and RLS changes in the same PR.                                                                                                                     | FP-01 is exploitable through PostgREST                                                                                             |
| R5  | No `allowedAccountTypes` on an org-resource route; the only persona exceptions are org creation and classroom creation.                                                               | audit §0.2: 41 of 45 gates are permission checks                                                                                   |
| R6  | A QA case that encodes a bug is edited with its spec; it is never skipped.                                                                                                            | the corpus is the product contract                                                                                                 |
| R7  | Workers may not merge to `main` and may not report a phase done without a CI conclusion.                                                                                              | prose is not a verdict                                                                                                             |
| R8  | When a decision narrows scope, grep the whole document for every mention of the removed thing and label it.                                                                           | a v1 scope change left six sections describing the deferred table                                                                  |
| R9  | Every number in a doc is produced by a command, not by memory.                                                                                                                        | "176 specs / 188 cases" mixed two corpora; "seven tables" was nine                                                                 |
| R10 | Re-verify every checklist line against the tree before dispatch.                                                                                                                      | a six-day-old 0b checklist cited three already-shipped items                                                                       |
| R11 | Grep a named "single reference" across the whole tree; never trust one.                                                                                                               | "only reference is the generated type file" missed a seed `REVOKE`                                                                 |
| R12 | A fix is not closed until the write path that can undo it has a test.                                                                                                                 | the role save drops the `assignment.*` rows the seed grants                                                                        |
| R13 | A generated file you cannot regenerate deterministically is a tooling task, not a cleanup edit.                                                                                       | the 0b regen produced a different shape and 7 RPC type errors                                                                      |
| R14 | Never hand-edit a generated file: the next regeneration deletes the edit, including lint suppressions. Fix the call sites or exempt the file in config.                               | the committed `database.ts` carried a hand-added inline eslint-disable                                                             |
| R15 | When a phase deliberately keeps a legacy key, pin the exact exception in the invariant; never delete the assertion.                                                                   | the phase-1b `group.manage` overlap                                                                                                |
| R16 | When a phase makes a producer non-authoritative, grep the QA corpus for fixtures writing to it in the same PR and run one full shard; a case-ID smoke set misses old-writer fixtures. | 2a-1's branding fixture failed only in the CI shard                                                                                |
| R17 | A gate flip comes last: make the write path behind it unable to destroy the authority it guards before the gate changes hands.                                                        | the `org.role.manage` gate would have been deletable by one role save                                                              |
| R18 | A SECURITY DEFINER helper whose policy lives on a table it reads must bypass RLS itself (`security definer`, `search_path = ''`), or the policy recurses (42P17).                     | the `org_role_permissions` predicate read its own table                                                                            |
| R19 | Migrations own every grant: `db reset` and `db push` must end with the same privileges, and a dev-only seed may never revoke or re-grant a production privilege.                      | 2a-2's seed-revoked helper 403'd every role write after a reset while the suite stayed green; the seed was retired after the audit |

## 4. Decisions

All settled 2026-11-13; the full wording is ADR-0015 §15.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `org.admin` is a real permission for ownership only; no superuser override                                                                                                                                                                                                                                                                                                                                                                                         |
| D2  | Managers get a free `solo` plan; `launch` is organization-only                                                                                                                                                                                                                                                                                                                                                                                                     |
| D3  | Personal plans are portable for `personalPortable` keys and user-scope quotas only                                                                                                                                                                                                                                                                                                                                                                                 |
| D4  | A seat can only raise a user-scope limit: `max(org, seat, personal)`, `-1` short-circuits                                                                                                                                                                                                                                                                                                                                                                          |
| D5  | v1 ships `entitlement_profile` (`all \| learner \| none`); allocation is deferred                                                                                                                                                                                                                                                                                                                                                                                  |
| D6  | Teacher `all`, Member `learner`, Custom `none`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D7  | Class invites use `group.invite` for existing org members; no external invites in v1                                                                                                                                                                                                                                                                                                                                                                               |
| D8  | Flags are a kill switch only (`is_enabled = false`); no rollout percentage                                                                                                                                                                                                                                                                                                                                                                                         |
| D9  | `flashcards` and `quiz` are baseline, always on, never gated                                                                                                                                                                                                                                                                                                                                                                                                       |
| D10 | `account_type` is not renamed in this programme; the semantics change only                                                                                                                                                                                                                                                                                                                                                                                         |
| D11 | This programme fixes control-plane RLS only; content RLS is a separate security ADR                                                                                                                                                                                                                                                                                                                                                                                |
| D12 | Overrides bypass flags                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D13 | A `student` persona may hold the Admin role                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D14 | Persona is a UI filter for plan purchases; the one server check is seat assignment against `audience`                                                                                                                                                                                                                                                                                                                                                              |
| D15 | Org plans grant ZERO licences; licences are sold separately. A licence is the purchased unit (`org_seat_pools` = the licence pool, its `plan_key` must be `scope='personal'` + `seatEligible`); `org_seat_assignments` is one member occupying one licence. No `plan_seat_grants`, no `org_seat_licenses`.                                                                                                                                                         |
| D16 | `org.admin` is `assignable = false`: ownership (delete org, transfer ownership) is not grantable through a custom role. The system Admin template keeps it; every other catalog key is assignable.                                                                                                                                                                                                                                                                 |
| D17 | Role templates are editor presets, not extra org rows: every org keeps admin/teacher/member; Assistant/Billing/Read-only/Blank are created from a template via POST /organization/roles. ADR §4.2 is amended to match §9.                                                                                                                                                                                                                                          |
| D18 | Teacher profile 'all' means the org ceiling minus the four legacy management markers; markers resolve only from org_role_features rows, so a Teacher never inherits member.manage/role.builder.                                                                                                                                                                                                                                                                    |
| D19 | entitlement_profile is authoritative for non-marker entitlement keys; legacy rows are read only for marker grants and explicit is_enabled=false revokes. Phase 3 deletes the legacy writer.                                                                                                                                                                                                                                                                        |
| D20 | Role changes are logged (actor, role, before, after) through @studiq/server/lib/log until an audit table exists; no audit subsystem is invented in phase 2.                                                                                                                                                                                                                                                                                                        |
| D21 | Changing or removing a grant requires authority over the current scope as well as the target; org.admin holders are exempt from 'no self-edit', or a single-admin org could never edit its own Admin role.                                                                                                                                                                                                                                                         |
| D22 | Entitlements are an open catalog: a key ships with its surface. `documents` is absent in v1 because the surface is not implemented (roadmap), not deleted permanently; re-entry is catalog + flag + plan rows, no resolver change.                                                                                                                                                                                                                                 |
| D23 | **Extendability is a release gate.** Phase 7 is not closed until a new entitlement can be added to a **live** app as data + one surface call, with no resolver change and no user-visible surface broken; any code change required for a data-only change is a defect fixed before close.                                                                                                                                                                          |
| D24 | **The editor lands before the gate flip.** 2a-3 (closed-catalog editor + complete payload) precedes 2a-2 (`requirePermission('org.role.manage')`): `setPermissions` deletes every row for the role and re-inserts only the payload, while the old editor rendered 20 hardcoded keys, so flipping the gate first would let one save on the Admin role delete `org.role.manage` and every `group.*`/`org.*` row and lock the org out of role management permanently. |

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
  `org.manage` stays in `feature_flags` and `ADMIN_ONLY_FEATURES` until phase 2.
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

### Phase 1b — catalog rename (behaviour-neutral)

**Shipped (#1389):**

- One migration, `20261119140000_catalog_rename.sql`: `limit_catalog` (the eight
  `LIMITS` keys with their scopes), `entitlement_catalog` (the eleven `FEATURES`
  keys — seven entitlements plus the four management markers phase 2 removes),
  `feature_flags` → `entitlement_flags`, `plan_features` →
  `plan_entitlements` (`feature_key` → `entitlement_key`, FK to the catalog),
  `plan_limits.limit_key` FK, `permissions` reshaped to the 44-key catalog
  (`key` PK, `category`, `allowed_scopes`, `assignable`, `description`;
  `org.admin` not assignable, D16), the `org_role_permissions` rewrite (a real
  function, below), and the three functions that read the old names.
- The migration owns the catalog write contract: both catalog tables have RLS
  and an authenticated read policy, and the migration revokes
  `insert, update, delete, truncate, references, trigger` from `authenticated`
  and grants `select`. Production applies migrations (`db push`) and never runs
  the seeds, so relying on `99_dev_grants.sql` alone would leave the default
  `arwdDxtm` (TRUNCATE bypasses RLS) in place there.
- Seeds: `00_plans.sql` and `99_dev_grants.sql` renamed (the latter later
  retired); `09_perms.sql` now seeds the 44-key catalog and derives the
  system-role grants from `category = 'content'`, exactly like the org-creation
  trigger.
- `PERMISSIONS` (44 keys with metadata) ships beside the unchanged `Permission`
  (26) and `DEFAULT_ROLE_PERMISSIONS`; the readers (`FeatureResolver`,
  `SubscriptionPlanService`, the `feature-flag` and `plan-feature` admin
  services, the admin pages) use the new names, and `database.ts` is
  regenerated.
- New-org row counts: **admin 31, teacher 31, member 25** content permissions.
  Existing orgs keep their 26/26/20 rows: the quiz/stats keys have no reader
  until phase 5, and phase 2 backfills them with the `permission_key` FK.
- `catalog-invariants` now asserts the DB `permissions` table equals
  `PERMISSIONS` (key, category, scopes, assignable), `Permission ⊆ PERMISSIONS`,
  and `entitlement_catalog`/`limit_catalog` equal `FEATURES`/`LIMITS`.
  `assignment-permissions-seed` derives its expectations from the catalog for
  both a seeded and a trigger-created org.
- The live-row rewrite ships as
  `public.migrate_org_role_permission_names()` (service-role only) and is
  exercised by `__tests__/integration/catalog-rename-rewrite.test.ts`, which
  installs the shipped statement over the direct connection and calls the
  function through PostgREST.
- Write-path change (intended, not a read-path no-op): the two foreign keys turn
  an admin free-text write of an unknown entitlement or limit key into a
  `23503`, which the admin services map to `BAD_REQUEST`. Every key that exists
  today is in its catalog; only a stale or hand-crafted write now fails closed.
- Gates: `env:reset-db --yes`, serial integration (821 passed, 11 skipped),
  `typecheck:all` + `typecheck:admin`, `lint:all`, `test:unit`, `review:static`,
  `knip`, `dup:base`, `format:check`; the four catalog mutations and the rewrite
  mutations KILLED.

**Follow-ups this phase creates (for the next readers):**

- **1c** re-pins `catalog-invariants` from `FEATURES` to `ENTITLEMENTS` and
  starts asserting entitlement metadata (`category`, `scope`, `seat_eligible`,
  `personal_portable`, `quota_limit_key`), which nothing checks in 1b. **Done in
  phase 1c.**
- **Phase 2** must delete `plan_entitlements` rows **before** catalog rows:
  `plan_entitlements_entitlement_key_fkey` has no `ON DELETE CASCADE`, so
  removing a legacy management marker from `entitlement_catalog` first fails
  with `23503`. The same order applies to `entitlement_flags` and
  `org_role_features` rows.
- **Phase 4**'s seat-eligibility check (`a pool's plan keys are all
seat-eligible`) is only satisfiable after phase 2 removes the four management
  markers: they are `seat_eligible = false` and appear in `lite`/`launch`/`hub`
  plan entitlements, so a plan containing them can never be a seat plan until
  they are gone.
- The stale constraint names `plan_features_feature_key_fkey` /
  `plan_features_plan_key_fkey` survive the table rename (Postgres keeps
  constraint OIDs). They are internal names with no reader; rename them in
  phase 2 (the same ALTER that adds the child FKs) or drop the dead constraints
  in phase 7.

**Difficulty log**

#### 2026-11-19 — the catalog split temporarily puts `group.manage` in both namespaces

What: 0b's `permissions ∩ FEATURES = ∅` assertion cannot hold in 1b:
`group.manage` is a catalog permission (ADR §4.1) and one of the four legacy
management entitlement keys phase 2 deletes, so it is in `FEATURES`,
`entitlement_catalog` and `plan_entitlements` too.
Why: the queue keeps the four markers in the entitlement tables until the route
and RLS gates read permissions; the permission catalog adds `group.manage`
unconditionally.
Fix: the test pins the exact overlap (`['group.manage']`) instead of an empty
list, so the rest of the namespace split stays under test; phase 2 restores
`[]`.
Rule: R15.

#### 2026-11-19 — the live-row rewrite was a no-op in every automated run

What: the rewrite of `org_role_permissions` ran inline in the migration, and a
`db reset` executes migrations before `01_seed.sql` creates any organization —
so no row was ever touched in CI or locally. Production (`db push`) is the only
place it did work, and nothing tested it.
Why: a migration-time statement is invisible to the suite by construction; the
failure it prevents would only surface when phase 2 adds the `permission_key`
foreign key over a stale name.
Fix: the statement list is now
`public.migrate_org_role_permission_names()` (SECURITY DEFINER, service-role
only) and the migration calls it; a new integration test seeds hostile rows on a
real org, installs the shipped function from the migration text over the direct
connection, and calls it through PostgREST. It asserts the dedupe, both
renames, the six entitlement-name deletes, the catalog sweep and idempotence.
Rule: a data fix that runs where no data exists yet needs a callable form,
because "it ran in the migration" is not evidence.

#### 2026-11-19 — the permission rename had to happen before the foreign key

What: `org_role_permissions` rows named `member.manage`/`role.builder` moved to
`org.member.manage`/`org.role.manage` in this PR, not with phase 2's
`permission_key` FK. The rows are not read by any code path (only
`assignment.*` literals are read through `permissionScopes`), so the rewrite is
behaviour-neutral. The old role editor accepted free strings, so a role can hold
both names and the unique key is `(org_role_id, permission_name)`.
Why: a plain `update` aborts on the duplicate key; deleting the assertion or
leaving the rows would move the failure into phase 2's migration.
Fix: delete the old-name row where the role already holds the new name, then
update, then delete the six entitlement names 0b removed, then prune anything
the closed catalog does not know (the old editor's free strings).
Rule: a rename a later foreign key will enforce needs a delete-then-update, not
an update.

#### 2026-11-19 — entitlement metadata had to be derived from the constraint it serves

What: ADR §5.1 gives portability and quotas for seven keys but does not settle
`seatEligible` for the baseline keys, and the four management markers have no
metadata by design.
Why: from phase 4 a seat's plan keys must all be `seatEligible`, and every
personal plan contains the baseline keys — `false` would make every seat plan
ineligible.
Fix: `seatEligible` is true for the six personal-scope keys (baseline
`flashcards`/`quiz` included) and false for `branding` and the four markers;
`personalPortable` is true only for the four paid personal surfaces.
Rule: derive metadata from the constraint it will serve, and record the
derivation where the next phase reads it.

### Phase 1c — catalog cutover

**Shipped (#1390):**

- `packages/authz/src/entitlements.ts` replaces `features.ts` (deleted, no
  alias): `ENTITLEMENTS` with the metadata the DB row carries (`category`,
  `scope`, `seatEligible`, `personalPortable`, `quota`), the ten keys the 1b
  catalog holds minus `documents`, plus `EntitlementKey`, `isEntitlementKey`,
  `ENTITLEMENT_KEYS`, `SURFACE_ENTITLEMENT_KEYS`, `ADMIN_ONLY_ENTITLEMENTS`
  (the three markers) and `ORG_SCOPED_ENTITLEMENTS` (derived from
  `scope === 'org'`, so the second denylist can no longer drift from metadata).
  The four legacy management markers stay; phase 2 deletes them.
- `packages/authz/src/limits.ts` receives `LIMITS` and its helpers from
  `packages/server/src/services/limit.catalog.ts` (deleted, no shim); every
  importer reads `@studiq/authz`.
- `20261119160000_documents_removed.sql` removes `documents` (absent until its
  surface ships) in dependency order: `plan_entitlements` (the catalog FK has no
  cascade), then `org_role_features` (no foreign key on `feature_key` at all, so
  nothing cascades and the delete is load-bearing; phase 2 must constrain the
  column or remove it with the table), then `user_feature_overrides` (its flag
  FK cascades, but the delete is explicit), then `entitlement_catalog` and
  `entitlement_flags`. It also re-creates `handle_new_organization()` and
  `apply_org_plan()` with `documents` removed from their member allowlists, so a
  future data-only re-entry cannot be silently granted to `member`. The catalog
  is open (D22): re-entry is catalog metadata, a flag row and the plan/seed rows
  that should carry it — no resolver change, because the resolver resolves keys
  from the catalog.
- Seeds: `documents` removed from every plan's entitlement list in
  `00_plans.sql`; nothing else.
- Readers: `FeatureResolver` orders by `ENTITLEMENT_KEYS`, guards with
  `isEntitlementKey`, and uses the two new sets; `lib/features.ts`,
  `features.controller.ts` and `subscription-plan.service.ts` speak
  entitlement types; the admin flag/plan-feature override models validate with
  `isEntitlementKey` and name the request field `entitlementKey`; the admin
  feature-flags page lists `ENTITLEMENT_KEYS`; `pricing-benefits.ts` drops
  `documents` from `FEATURE_PRIORITY`; `pricing-ladders.ts` keeps
  `ROLE_MARKER_FEATURES`. The API payload key `features` and its field names
  are unchanged until phase 6.
- `catalog-invariants` now pins `entitlement_catalog` to `ENTITLEMENTS`
  including `category`/`scope`/`seat_eligible`/`personal_portable`/
  `quota_limit_key` (1b pinned the key set only) and narrows the flag assertion
  to `SURFACE_ENTITLEMENT_KEYS`; `limit_catalog` still equals `LIMITS` key and
  scope from its new home. `org-features` and `org-role-features-rls` pin the
  member set to `['flashcards', 'quiz']`; the resolver, pricing and
  subscription-plan fixtures drop `documents`.
- Docs: this ledger, the rollout phase-1 block, `docs/limits.md` (catalog paths,
  key list, member set), the STU-03 case text/spec comment and the
  `EDU-GRP-01`/`EDU-GRP-05` spec premise comments are corrected. No spec
  assertion changed.

**Follow-ups this phase creates:**

- **Phase 2** still deletes the four management markers, and must keep the 1b
  delete order: plan rows before catalog rows.
- `docs/audits/features-perms-weak-spots.md` keeps the pre-cutover identifiers
  on purpose: it records the state the ADR was written against.

**Difficulty log**

#### 2026-11-19 — the catalog's declaration order is the API payload order

What: the 1b `entitlement_catalog` insert lists keys in ADR §5.1 order (paid
surfaces first); declaring `ENTITLEMENTS` in that order and letting
`ENTITLEMENT_KEYS` order the resolver would have reordered `/features/me` for
every user. The DB order has no reader, so the two orders were free to differ.
Why: `FEATURES`' order had become the de-facto payload contract without any
test asserting the catalog order — the resolver unit tests assert exact arrays.
Fix: declared `ENTITLEMENTS` in the legacy order minus `documents` (appending a
key is the only reordering), and pinned metadata rather than order in
`catalog-invariants`.
Rule: a catalog array a resolver emits is an API contract, not a set — reordering
it is a behaviour change and needs its own PR.

#### 2026-11-19 — one key, two foreign keys, opposite delete rules

What: `documents` is a child of both `entitlement_catalog` (1b's FK, no
cascade) and `entitlement_flags` (the original FK, `ON DELETE CASCADE`).
Deleting the flag first would have removed the plan/role/override rows through
the cascade while the catalog FK's rule would have rejected the same delete in
the other order.
Why: 1b added a restrictive FK beside a cascading one; nothing records which is
authoritative for a removal.
Fix: the migration deletes explicitly in dependency order (`plan_entitlements`
first) and deletes the role/override rows itself, so it does not depend on
either constraint's rule; the comment names the two rules.
Rule: when two constraints disagree about a delete, delete explicitly in
dependency order; never rely on one constraint's CASCADE to satisfy another.

**Correction (2026-11-19, review).** The second "foreign key" does not exist:
`pg_constraint` shows only `org_role_id` and the unique pair on
`org_role_features`, so nothing cascades and the explicit delete is what removes
the rows. `user_feature_overrides.feature_key` does keep its cascading flag FK.
The rule stands; the unconstrained column is phase-2 debt.

#### 2026-11-19 — the membership set is prose in the docs and the QA corpus

What: after dropping `documents` from the catalog and the seeds, `docs/limits.md`
and STU-03's case text still told a reader the member role receives it, and the
`EDU-GRP-01`/`EDU-GRP-05` spec premise comments repeat the set.
Why: the set is written out in prose instead of being derived from
`ENTITLEMENTS`/`LEARNER_ENTITLEMENTS`.
Fix: corrected `docs/limits.md` and STU-03 (in the pre-approved 37-case map, its
assertions unchanged) here, plus the two spec premise comments (no assertion
changes).
Rule: grep a removed key in `docs/` and `qa/cases/`, not only in code — the case
text is the product spec.

### Phase 2 — authority

**Settled 2026-11-19 — five slices on one short-lived branch.** Phase 2 started
after 1c merged; 2a-1 imports `ENTITLEMENTS`/`LIMITS` from `@studiq/authz`.

| Slice    | Contents                                                                                                                                                              | Size                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **2a-1** | `entitlement_profile` + trigger/seed/backfill + profile-driven resolver + RLS fallback. Closes the RLS twin of FP-01 in the same PR.                                  | ~750 (`size:exception`) |
| **2a-3** | closed-catalog editor + complete payload + audit log. Lands **before** 2a-2 (D24).                                                                                    | ~400 (`size:exception`) |
| **2a-2** | role templates + `requirePermission('org.role.manage')` + editor gate + the RLS predicate (rewrites MGR-ROL-01, deletes the out-of-map e2e `manage-roles-plan-gate`). | 460 (`size:exception`)  |
| **2a-4** | `ctx.groupRoles` + org-scoped group query (closes the cross-org group union).                                                                                         | 59 (`bun run pr:size`)  |
| **2a-5** | fail-closed scope defaults.                                                                                                                                           | ~110                    |

The table is in **landing order**, not the original plan's order: 2a-3 goes before
2a-2 because the gate flip is only safe once the editor sends the complete catalog
(D24).

**2a-1 shipped on `feat/authority-2a-1` (PR pending):**

- `supabase/migrations/20261119180000_authority_entitlement_profile.sql`:
  `org_roles.entitlement_profile` (`all | learner | none`, NOT NULL, CHECK,
  fail-closed default), a one-time backfill (`is_system is true` and an explicit
  name predicate, so a NULL `is_system` keeps `none`), and
  `public.seed_system_role_permissions(p_org_id)` (SECURITY DEFINER, service-role
  only, `ON CONFLICT DO NOTHING`) as the callable seed matrix.
  `handle_new_organization` writes the profile and calls the function; the
  `org_role_features` plan loop is untouched (D19). `has_org_feature`'s zero-row
  fallback now reads the profile and unions the seat plan instead of inheriting
  `plan_entitlements(organizations.plan)`, closing FP-01 on PostgREST.
- `@studiq/authz`: `LEARNER_ENTITLEMENTS`, `LEGACY_MANAGEMENT_ENTITLEMENTS`,
  `ENTITLEMENT_PROFILES`/`EntitlementProfile`/`isEntitlementProfile`, and
  `SYSTEM_ROLE_TEMPLATES` (the three seeded roles, profile + permission map, the
  source the SQL matrix is pinned to). `ADMIN_ONLY_ENTITLEMENTS` stays the three
  keys. `DEFAULT_ROLE_PERMISSIONS` is deleted with both re-exports.
- `FeatureResolver`: org layer is profile → legacy rows (markers grant,
  `is_enabled = false` revokes) → seat (additive, admin-only strip) → personal →
  overrides → flags. `ctx.orgRoleId === null` resolves ∅ with no plan read.
- `supabase/seeds/09_perms.sql` calls the function for every seeded organization
  (the org-creation trigger already created their roles and profiles).
- Tests: a table-driven resolver truth table (admin/teacher/member/custom,
  hub/launch, no role, seated non-admin), a new
  `__tests__/integration/entitlement-profile.test.ts` (trigger profiles, CHECK,
  idempotence, `SYSTEM_ROLE_TEMPLATES` pin with literal spot checks, and the
  user-session RLS fallback for all three profiles), plus rewrites of
  `org-features`, `assignment-permissions-seed` and the two custom-role
  RLS-tenant-isolation premises that encoded zero-row inheritance. QA:
  MGR-SET-02's fixture now takes branding from the plan ceiling through
  `apply_org_plan(org, 'hub')` instead of an `org_role_features` upsert (5/5
  independent runs + LIM-05).
- `database.ts` regenerated with the pinned CLI 3.1 (column + RPC only).

**Follow-ups this slice creates:**

- **Phase 4** closes the seat-parity gap in `has_org_feature`: the seat `OR` sits
  inside the `NOT EXISTS(org_role_features)` block, so a role that owns any row
  never sees its seat plan while the resolver applies it unconditionally. Hoist
  the `OR` out of the zero-row block, or guarantee every seat-eligible key is
  reachable through the row branch — required once `org_seat_pools.plan_key` is
  all-`seatEligible` (D15). No user-visible gap today.
- **Phase 5** must not assume Teacher `stats.read` is `own`: `SYSTEM_ROLE_TEMPLATES`
  and `seed_system_role_permissions` grant `group` (ADR §4.2), but existing
  organizations keep the `own` row the old matrix wrote, because the function's
  `ON CONFLICT DO NOTHING` cannot rewrite it.

**Difficulty log**

#### 2026-11-19 — the profile governs surfaces, the rows still govern the markers

What: the org layer now grants non-marker entitlement keys from
`org_roles.entitlement_profile`, but the four legacy management markers
(`org.manage`, `member.manage`, `role.builder`, `group.manage`) still resolve
only from an enabled `org_role_features` row. The `all` profile is therefore
the ceiling **minus** those four, not the ceiling.
Why: `handle_new_organization` seeds Teacher rows as "the plan except
`member.manage` and `role.builder`", so a Teacher profile of `all` would
otherwise hand back exactly the two keys the row filter exists to withhold —
FP-04, the reason 2a-1 was split from 2b. Markers become permissions in 2b;
until then the row is the only authority over them.
Fix: `LEGACY_MANAGEMENT_ENTITLEMENTS` is a named constant consumed by the
resolver, and `ADMIN_ONLY_ENTITLEMENTS` stays the three-key seat strip so
`group.manage` is not accidentally denied to a Teacher. The truth table asserts
`teacher/all` equals `admin/all` minus `member.manage` and `role.builder`.
Rule: when one column becomes authoritative, scope it to the keys whose writers
are gone; anything a legacy writer still owns stays row-sourced until that
writer is deleted.

#### 2026-11-19 — the RLS fallback had to be a union, not a substitution

What: `has_org_feature`'s zero-row branch reads the profile, then **unions** the
seat plan, rather than choosing one. Selecting the seat plan when seated (the
pre-2a-1 shape) or the profile otherwise would be narrower than the API for a
seated learner: `FeatureResolver` composes `profile base ∪ seat plan`, and the
admin-only strip runs after both.
Why: the resolver's seat layer is additive by design (a seat is an upgrade, not
a replacement), and RLS must never be narrower than the API or a request that
passes `requireEntitlement` fails at the table. A substitution also silently
dropped the profile's `ai.chat` for a seated member on a plan without it.
Fix: the branch is `CASE profile … END OR (seat-plan EXISTS …)` with the same
three-key strip the resolver applies. The seated custom-role RLS test now pins
`group.manage` (a seat-plan key that is not admin-only) and `advanced.stats`.
Rule: when the resolver unions two layers, its SQL twin unions them too — a
fallback that picks one is a parity bug even when both are plausible.

#### 2026-11-19 — the backfill is a no-op in every reset, so the function is the contract

What: the one-time profile backfill writes only organizations that exist when
the migration runs, and a `db reset` executes migrations before `01_seed.sql`
creates any organization. Production (`db push`) is the only place the inline
statement does work.
Why: this is the phase-1b failure mode repeating one layer up — a data fix
evaluated only in production is not evidence, and the org-creation trigger only
covers organizations created after the migration.
Fix: the matrix ships as `public.seed_system_role_permissions(p_org_id)`
(SECURITY DEFINER, service-role only) and the trigger, the seed and the
integration suite all call it; the suite proves idempotence and equality with
`SYSTEM_ROLE_TEMPLATES`.
Rule: a data fix that runs where no data exists yet needs a callable form,
because "it ran in the migration" is not evidence.

#### 2026-11-19 — the seeded organizations never touch the org-creation trigger

What: `01_seed.sql` inserts organizations and their three `org_roles` rows
directly, so `handle_new_organization` — the only writer of
`entitlement_profile` — never runs for the dev/QA tenants. A reset therefore
left every seeded role on the fail-closed `none` default, and the seeded
students resolved nothing.
Why: the dispatch note said "the trigger does cover it, prefer no duplicate",
which is true only for the organizations the trigger creates.
Fix: `09_perms.sql` also sets the profile for the seeded system roles, guarded
by `entitlement_profile = 'none'` so a re-run cannot overwrite a profile an
admin changes later. The trigger stays the writer for real org creation.
Rule: a column written by a trigger needs a seed-side value too whenever the
seed inserts its rows directly instead of going through the trigger.

**Correction (2026-11-19, review).** The premise above is false.
`handle_new_organization` fires `AFTER INSERT ON public.organizations`
(`20260707000006_handle_new_organization_trigger.sql`) and `01_seed.sql` inserts
the organizations with a plain `INSERT`, so the trigger creates the three roles —
profiles and permissions included — before the seed's own `org_roles` rows
conflict on `(organization_id, name)` and do nothing. The observation was taken
before the migration had been applied on that stack, so the roles looked
trigger-less. The seed's profile guard was unnecessary and is deleted, and the
seeded-org assertion now pins the trigger write (`all`/`all`/`learner`). R10
already covers this — re-verify every checklist line against the tree before
dispatch — so the correction yields no new rule.

#### 2026-11-19 — a QA fixture still wrote to the layer this phase retires

What: CI's `qa-suite (mgr-sec-bil)` caught MGR-SET-02 — its fixture granted
`branding` by upserting `org_role_features`, the non-marker writer 2a-1 makes
non-authoritative. The case passed on 2a-1's own tree and failed only in CI's
full shard; the coordinator's local smoke set (MGR-ROL-*, SEC-06, STU-03,
LIM-05, BIL-01) did not include it, and the rollout map scheduled the fixture
change at phase 3, one phase late.
Why: a phase that changes which layer is authoritative changes the meaning of
every fixture that writes to the retired layer, and those fixtures live in the QA
corpus, not next to the resolver.
Fix: the fixture uses the case's own "plan with branding" alternative —
`apply_org_plan(org, 'hub')` — and branding resolves from the Admin profile `all`
∩ the plan ceiling; the case text moved with the spec (R6). 5/5 independent
MGR-SET-02 runs plus LIM-05 green.
Rule: when a phase makes a producer non-authoritative, grep the QA corpus for
fixtures that write to that producer **in the same PR**, and run at least one
full shard; a smoke set chosen by case ID will miss the cases whose _fixtures_
depend on the old writer.

**2a-3 shipped on `feat/authority-2a-3` (PR pending; lands before 2a-2 — D24):**

- `RolePermissionEntrySchema` is a **closed catalog**: `permissionName` is one of
  the 44 `PERMISSIONS` keys, `scope` is `own | group | organization | null`
  (`null` = revoke). `SetRolePermissionsSchema` adds a `superRefine` that
  requires exactly one entry per catalog key (a missing or duplicate key is a 422
  whose issue path names it) and a scope inside that key's `allowedScopes`
  (`group.invite` has no `own`, `org.*` only `organization`). The name check is an
  own-property check (`isPermissionCatalogKey`), so `constructor`/`__proto__`/
  `toString` are rejected rather than resolved through the prototype chain. The
  schema is the controller's write contract; `isCompleteCatalogPayload` in the
  same model repeats the completeness rule for the service, which is a direct
  entry point too (tests, scripts), so a partial payload is rejected before it can
  delete anything.
- `OrgRoleService.setPermissions` keeps the #263 tenant proof untouched and adds,
  in order: the completeness check (`isCompleteCatalogPayload` → 422, before the
  tenant lookup); the no-self-edit rule (`id === ctx.orgRoleId` → 403 unless the
  caller holds `org.admin`, D21); a per-key authorization pass over **every** key
  that changes (a grant needs the caller to hold the key at a scope covering the
  target, a removal over the current scope); the D16 rule that a non-assignable
  key may only be re-sent as a no-op (`org.admin` grant or revoke → 422); then
  the write, target-first: upsert every non-null entry on
  `(org_role_id, permission_name)`, then prune the rows whose name is not in the
  granted set. That order keeps a failure recoverable — a failed upsert leaves
  the previous set untouched, a failed prune leaves a superset the next save
  prunes, whereas delete-then-insert would empty the Admin role on a write
  timeout and the self-edit guard would then refuse the retry. Each successful
  change logs actor, org, role id/name and the before/after key→scope maps
  through `@studiq/server/lib/log` (D20 — no audit table).
- `org_roles.entitlement_profile` is read by `listRoles`/`getRole` and written by
  `createRole` (default `none` for a custom role) and `updateRole`, guarded by
  `isEntitlementProfile`. `CreateOrgRoleSchema`/`UpdateOrgRoleSchema` accept
  `entitlementProfile`; there is **no** `template` field yet (2a-2).
- `@studiq/authz` exports `scopeCovers(held, wanted)` beside `evaluateScope`
  (own < group < organization), so the editor's authority rule and the runtime
  evaluator share one order table.
- `/manage/roles` renders the closed catalog instead of the hardcoded 20 keys:
  sections are derived from `PERMISSIONS` (10 sections — the eight content
  families then groups and org), each row has a grant checkbox and only that
  key's allowed scope radios (113 radios in total), `org.admin` is permanently
  disabled (held = no-op at `organization`, absent = never granted), and Save
  sends one entry per catalog key. The entitlement-profile picker
  (`all | learner | none`) writes `entitlementProfile` through
  `PUT /organization/roles/:id` in the same save, and is withheld for a system
  role — the Admin role's `all` is not movable from the permission editor. The
  `role.builder` gate, the locked card and the `featuresPending` guard are
  unchanged (the gate flip is 2a-2).
- i18n (`pl` + `en`): the five legacy section labels stay, five new sections
  (`section_quizzes`, `section_assignments`, `section_stats`, `section_classes`,
  `section_organization`), the derived action labels (`action_*`) and the
  profile strings; both locales carry the same 68 keys.
- Tests: `__tests__/unit/models/org-role.model.test.ts` (closed catalog,
  duplicate and missing key names, prototype names, `allowedScopes`, profile
  enum) and `__tests__/unit/controllers/org-role.controller.test.ts` (a rejected
  payload never reaches the service) pin the schema; the service suite covers
  unknown tenant, a payload that is not the whole catalog, the upsert-before-prune
  order, self-edit vs the `org.admin` exemption, grant escalation, removal
  escalation, the `org.admin` no-op and both write failures; the integration
  suite keeps #263 and adds "a complete payload preserves a no-op row the caller
  cannot change", a complete payload that leaves exactly its two granted rows,
  and the `entitlement_profile` round-trip. QA `MGR-ROL-03` asserts 44 rows, 10
  sections, the complete payload on every save and a reset as "untick every row"
  (its case text moved with the spec); `MGR-ROL-01/02/04` only name
  `role.builder` and the permission button, so their premise is unchanged.
- Gates: `typecheck:all`, `typecheck:admin`, `lint:all`, `test:unit`,
  `review:static`, `knip`, `dup:base`, `format:check` (the coordinator runs
  integration, QA, the build and the merge). Six mutations, one named test each,
  all KILLED on their own assertion: the closed-catalog name check, the
  completeness `superRefine`, the self-edit guard, both escalation directions and
  the `org.admin` assignable guard. The review round added five more, all KILLED:
  the prototype-name lookup, the service completeness guard, the
  upsert-before-prune order, the upsert error path and the legacy-scope filter in
  `getRole`.

**Follow-ups this slice creates:**

- **2a-2** adds `org_role_permissions.permission_key` → `permissions(key)` and the
  backfill, then flips the gate to `requirePermission('org.role.manage')`. **Not
  shipped in 2a-2** (its scope was the gate, the RLS twin and the presets; a
  foreign key plus the backfill of old free-text names is its own change). The gap
  is unchanged and still fails closed: a row the catalog does not know is neither
  renderable nor grantable, so it cannot widen authority; the FK and backfill move
  to 2b, where the catalog-pruning migration runs anyway. The complete payload is
  the prerequisite (D24); when the FK lands, its backfill must run before the
  constraint, because existing orgs keep rows the old free-text editor could have
  written.
- **2a-2 acceptance criterion**: `is_org_manager` RLS is
  `has_org_feature(..., 'member.manage')` (the legacy row), not
  `org.role.manage`. When the controller gate flips, a custom role holding
  `org.role.manage` passes the app check and then has its write refused by RLS, so
  the RLS predicate must move to the permission in the same PR (R4).
- **2a-2 / phase 6** may disable rows the _caller_ cannot change. Today only
  non-assignable keys are disabled; an escalation attempt reaches the server and
  surfaces as the generic `perms_save_failed` toast, because the editor does not
  read the caller's own scopes.
- The profile write is a second request after the permission write; a failure
  between them leaves the permissions saved and the profile unchanged, and the
  retry is idempotent. Merging both into one endpoint is a phase-6 API change.
- `getRole` drops a stored row whose `scope` is outside the catalog's three
  scopes. Those rows predate the current editor, which only ever wrote
  `own | group | organization`: `any`/`granted` come from the older
  `role_permissions` era and the DB CHECK still allows them. Nothing in the
  product writes them now; the editor shows such a key as ungranted and a save
  rewrites (or prunes) it.

**Difficulty log**

#### 2026-11-19 — the gate flip would have deleted the permission that gates it

What: the planned order was 2a-2 (flip writes to `org.role.manage`) then 2a-3
(the editor). `setPermissions` deletes **every** row for the role and re-inserts
only the payload, and the old editor rendered 20 hardcoded keys; the seeded Admin
role holds all 44. One save on the Admin role after the flip would delete
`org.role.manage` and every `group.*`/`org.*` row, and no member of the org could
re-open the editor to restore them — an unrecoverable lockout written by the very
slice that was meant to tighten authority.
Why: the two slices were sized independently and the order came from the plan's
numbering, not from what each write path does. A complete payload has to exist
before the gate can safely move, because the gate is one of the rows the payload
rewrites.
Fix: swapped the landing order (2a-3 first, D24), kept the `role.builder` gate in
this PR, and recorded the order in the slice table, the rollout plan and D24. The
schema's completeness rule is what makes the write safe — a partial payload is now
a 422 that writes nothing — and the write is target-first (upsert, then prune), so
even a failed save can only leave a superset.
Rule: R17.

#### 2026-11-19 — a seed's blanket function revoke undid the migration's grant

What: the 2a-2 migration grants `authenticated` EXECUTE on
`public.rls_caller_has_permission(uuid, text)`, and the six role-write policies
call it. `db reset` then runs `supabase/seeds/99_dev_grants.sql`, whose
`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated`
runs after every migration and removes that grant; the seed re-grants only the
helpers it lists, and this one was not on the list. After a reset every role
write raised `42501 permission denied for function rls_caller_has_permission`,
which the route maps to 403: on a fresh local/QA/CI database `POST
/api/v1/organization/roles` failed for the org's own manager, while the same
request kept working on a long-lived stack that had already had the grant
restored. `rls-tenant-isolation` B5 UPDATE returned `data: null` for the same
reason. Production (`db push`) never runs seeds, so only dev/QA/CI were wrong.
Why: two layers write one privilege from opposite directions — the migration
grants, the seed revokes and re-grants a hand-maintained list — and nothing
compares the two. The suite that should have caught it
(`org-role-manage-rls`) installs the migration in `beforeAll`, which re-applied
the migration's GRANT and repaired the function for the rest of the run, so it
was green on a database where every other role write failed.
Fix: the helper joins the seed's grant list; the RLS suite applies the seed's
grant state after the migration, and a named test calls the helper as an
`authenticated` session (true for the permission holder, false for the control),
so a forgotten grant is red instead of masked. Symptom to recognise: role writes
403 on a fresh reset only.
Rule: R19.

**2a-2 shipped on `feat/authority-2a-2` (PR pending):**

- **Gate.** `Permission.ORG_ROLE_MANAGE = 'org.role.manage'` joins the
  code-readable map (`Permission ⊆ PERMISSIONS`); `ORG_ROLE_MANAGE` is the first
  `org.*` key there, the rest follow with 2a-5. `requirePermission(ctx, key)` in
  `packages/server/src/lib/authz.ts` is `can()` + `throw new AppError('FORBIDDEN')`,
  so the controller cannot forget the branch; the four write handlers
  (`createRole`, `updateRole`, `deleteRole`, `setPermissions`) use it and drop
  `requireFeature(ctx, 'role.builder')`. `getRole`/`listRoles` stay ungated: the
  list is read by `/manage/members` and the invite picker. `setPermissions` also
  refuses (409) a save that would remove `org.role.manage` from the last role in
  the org holding it: an `org.admin` holder may self-edit, so without the guard
  the owner could untick the gate on the Admin role and leave no role able to
  manage roles (`org.admin` is not a fallback, §4.1). The count reads the stored
  rows, so a legacy `scope = 'any'` gate row — which the editor renders as revoked
  but `can()` and RLS still honour — also counts as a holder.
- **RLS twin (R4).** `20261119190000_org_role_manage_rls.sql` adds
  `public.rls_caller_has_permission(p_organization_id, p_permission)` (SECURITY
  DEFINER, `search_path = ''`, execute to `authenticated`/`service_role`) and
  moves the six write policies on `org_roles` and `org_role_permissions` —
  insert/update/delete each — from `rls_caller_is_org_manager` (the legacy
  `member.manage` feature) to `rls_caller_has_permission(…, 'org.role.manage')`,
  keeping `rls_caller_org_ids()`. The two SELECT policies and every other table
  stay as they were; `is_org_manager` still guards members, settings, seats and
  invitations until 2b. The migration grants execute on the new helper itself:
  the dev seed that used to blanket-revoke every function and re-grant a hand
  list was retired in `chore(dev): retire the dev-grants seed`, so a missing
  grant here is red in the RLS suite instead of repaired after the run (R19).
- **Presets (D17).** `ROLE_TEMPLATES` in `@studiq/authz` holds Assistant / Billing
  / Read-only / Blank (`ROLE_TEMPLATE_NAMES`, `isRoleTemplateName`), each
  `entitlementProfile: 'none'`, every key/scope from `PERMISSIONS`, no
  `org.admin`. `CreateOrgRoleSchema.template` accepts only those four;
  `OrgRoleService.createRole` defaults an omitted field to `blank` (the schema is
  what rejects an unknown name, so the service needs no second check), and
  `UpdateOrgRoleSchema` has no field, so an edit cannot re-apply a preset.
  `createRole` resolves the preset, inserts the role, then its rows, and deletes
  the role if the row insert fails (the `createAndJoin` shape). The `org.*` keys
  in a preset take effect when 2b replaces the legacy feature gates; the content
  keys are live now — an Assistant preset today gets 403 on the member/invitation
  operations it promises.
- **UI.** `/manage/roles` gates on `usePermission()('org.role.manage', { orgId })`
  instead of `useFeature()('role.builder')`; the locked card, the
  `featuresPending` guard, the `ORGANIZATION_PRICING_URL` import and the
  `locked_*` keys in both locales are deleted. The create dialog gains the preset
  picker (default „Pusty”/Blank), create-only — an existing role keeps its
  permissions editor.
- **Tests.** `__tests__/unit/lib/org-roles.test.ts` derives the preset shape from
  `PERMISSIONS` (closed catalog, allowed scopes, no `org.admin`, `none` profile,
  per-preset matrices), the model suite covers the enum and the create-only
  field, the controller suite pins `requirePermission(ctx, 'org.role.manage')` on
  all four writes and the ungated reads, the service suite covers preset rows,
  the blank/omitted case, the failed-insert rollback, the self-edit exemption and
  the last-`org.role.manage`-holder guard (409 refused, and the removal succeeds
  once another role holds it), and
  two integration files prove the DB matrix equality
  (`org-role-templates.test.ts`) and the RLS predicate in both directions with
  real signed-in sessions (`org-role-manage-rls.test.ts`: an `org.role.manage`
  role writes roles and permission rows, a role holding only the legacy
  `member.manage` feature is refused 42501, and the foreign-org write stays
  denied).
- **QA/docs.** `MGR-ROL-01` is rewritten around the permission contract (a Launch
  admin creates and edits a role; a member without the key is refused 403 and has
  no editor), and its tenant gains a manager-account-type member holding a custom
  role without the gate — the client deny case: the page and list render, there is
  no „Nowa rola”/actions column, and `POST /organization/roles` is 403. That is
  the half the teacher could not prove, because the persona rule keeps an educator
  out of `/manage`. `MGR-ROL-02/04` prerequisites move to `org.role.manage` +
  `/permissions/me`, `MGR-ROL-03`'s plan note is corrected, and the out-of-map e2e
  `manage-roles-plan-gate.spec.ts` is deleted. ADR §4.2 now separates the three
  seeded roles from the four presets and §9's picker list drops Teacher. The
  slice measured **438** reviewable lines at review and **460** after the review
  fixes (`bun run pr:size`); both over the 400 budget, hence `size:exception`.
- **Gates:** `typecheck:all`, `typecheck:admin`, `lint:all`, `test:unit`,
  `review:static`, `knip`, `dup:base`, `format:check`, the touched integration
  files serially, and the five mutations below.
- **One-PR incoherence (accepted).** The pricing surfaces still advertise
  „Kreator ról” / `role.builder` and MGR-ROL-01's „Zobacz plany” path is gone from
  the page. The entitlement row and its plan/flag rows are deleted in 2b with the
  other three markers; until then the plan still _claims_ a capability it no
  longer gates. Recorded rather than half-removed, because deleting the marker
  needs the plan-row-before-catalog-row order and the same PR as the remaining
  predicates.

**Follow-ups this slice creates:**

- **2b security debt (recorded, not implemented).** The last-holder guard above is
  API-only. PostgREST can still delete the last `org.role.manage` row — the RLS
  predicate checks that the **caller** holds the permission, not that one holder
  remains — and can delete a system role, because system-role protection is
  app-level (`deleteRole`). Both are reachable with a signed-in session and the
  anon key, so the action is an RLS-side guard (a `with check`/`using` that
  refuses a write leaving zero holders, and `is_system = false` on the role
  delete), landed with 2b's predicate sweep. No trigger now: the app guard is the
  editor's contract, and a trigger would freeze the SQL shape 2b has to change.
- **2b** must delete `org.role.manage`'s entitlement twin (`role.builder`) from
  `plan_entitlements`, `org_role_features`, `entitlement_flags` and
  `entitlement_catalog` — in that order — and move `is_org_manager`'s callers
  (members, settings, seats, invitations) to `rls_caller_has_permission`.
  `role.builder` currently has no reader in role writes but is still resolved by
  the resolver and advertised by pricing.
- **Phase 6** may pass the caller's own scope into the editor (the 2a-3
  follow-up): today a grant beyond the caller's authority passes the client and
  surfaces as `perms_save_failed`.
- The six `org_role_permissions`/`org_roles` write policies are now the only
  place `rls_caller_has_permission` is used. 2b's migration can reuse it
  unchanged for the remaining control-plane tables.

**Difficulty log**

#### 2026-11-19 — the API gate and the RLS predicate disagreed by construction

What: the controller moved from the `role.builder` entitlement to
`org.role.manage` while `is_org_manager` (which guards all six role-write
policies) still meant `has_org_feature(..., 'member.manage')`. A custom role
holding only `org.role.manage` would pass the route and then have its write
refused at the table — through PostgREST directly, regardless of the UI.
Why: the two gates were built in different phases and only the app-layer one was
on the flip list; `member.manage` looked like the same capability because the
seeded Admin role holds both.
Fix: `public.rls_caller_has_permission(org, key)` and the six policies move in
the same PR (R4), pinned by a two-direction integration test — the permission
holder writes, the legacy `member.manage` holder does not.
Rule: when a permission replaces a feature as an app gate, its RLS twin moves in
the same PR; the feature name and the permission name being different strings is
exactly how the divergence hides.

#### 2026-11-19 — a preset is a row writer, not a role

What: D17's four presets could have been modelled as extra seeded system roles.
They are materialised per organization instead, as ordinary custom roles.
Why: a system role is protected from rename/delete and is created for every
organization by the trigger; a preset is a starting point an admin may edit,
rename or discard, and an org that never picks "Billing" should not carry it.
Fix: `ROLE_TEMPLATES` lives in `@studiq/authz` as a closed matrix the service
copies into `org_role_permissions`; the schema accepts the four names only, the
DB assertion compares the rows to the constant, and the failed-insert path
deletes the half-created role.
Rule: a preset writes rows; a system role is an identity. Do not seed a preset.

#### 2026-11-19 — the RLS helper had to be SECURITY DEFINER for the table it guards

What: the new predicate reads `org_role_permissions`, and three of the policies
it replaces live on `org_role_permissions` itself. A SQL function without
`SECURITY DEFINER` would re-enter its own policy and raise 42P17.
Why: `rls_caller_org_ids()` solves the same recursion for `org_members`; the
pattern is invisible from the policy text.
Fix: `rls_caller_has_permission` runs as the owner, `search_path = ''`, execute
granted to `authenticated`/`service_role` only, `PUBLIC` revoked; verified by
running the migration in a rolled-back transaction before the reset.
Rule: an RLS helper that reads the table whose policy calls it must be SECURITY
DEFINER — otherwise it recurses, and the error surfaces only at query time.

#### 2026-11-19 — the dev seed was a second grant system

What: `supabase/seeds/99_dev_grants.sql` ran after every migration on a
`db reset` (local and CI) and never on a `db push`. It re-opened the schema with
`GRANT ALL ON ALL TABLES`, blanket-revoked function EXECUTE and re-granted a
hand-maintained allowlist, then repeated the column narrowings. An audit of the
reset state with and without it found exactly two kinds of difference: three
seed-only table grants (`MAINTAIN` on `billing_subscriptions`, `notifications`,
`payments`, the privilege PostgreSQL 17 added to `ALL` that no revoke list
names) and six seed-only function revokes (`question_bank_counts` and five
triggers, all created after the 2026-10-24 hardening migration). Everything
else — table/column/sequence/default grants, the `authenticated` RPC allowlist,
the three `anon` pricing reads — was already identical, which is the point: the
migrations had learned to grant what they need while the seed kept describing a
local-only schema.
Why: two layers wrote one privilege from opposite directions and nothing
compared them. Locally the seed was stricter about functions and looser about
tables than a deploy, so "works after a reset" and "works in production" were
different claims. 2a-2 is the symptom on record: the seed's blanket function
revoke removed the grant its own six write policies call, every role write
answered 42501 after a reset, and the suite stayed green because it applied the
seed's grants itself (R19). A seed that runs after migrations can also never be
caught by one — it runs last.
Fix: deleted the seed and moved the one real gap into
`20261119200000_function_execute_parity.sql` (revoke `PUBLIC`/`anon` EXECUTE on
the six, which is exactly the privilege state local and CI already ran with:
`authenticated` keeps `question_bank_counts` and the helpers, and `service_role`
is untouched). `__tests__/integration/grant-parity.test.ts` is the missing
comparison: it derives the helper set from `pg_policies` and asserts EXECUTE for
`authenticated`, pins the answer-key column revokes and the table-wide revoke
behind them, the three `anon` pricing reads with no other table privilege and no
executable function, and the absence of TRUNCATE/REFERENCES/TRIGGER — all from
`pg_catalog`, so there is no list to keep in sync. `docs/database.md` now says
seeds carry data, never privileges. The residual `MAINTAIN` grant is on both
sides (parity) and unreachable through PostgREST, which issues none of its
commands; recorded rather than fixed here so the change stayed a retirement.
Rule: a seed may carry data; migrations own grants. A local-only file that
changes a privilege is a production bug wearing a dev hat — fix the migration and
prove reset-vs-deploy parity with a test that reads the catalog.

**2a-4 shipped on `feat/authority-2a-4` (PR pending):**

- **The read.** `withAuth` now asks `group_members` for
  `group_id, role, groups!inner(organization_id)` and filters on
  `groups.organization_id = active org`, inside the existing verified-membership
  block. The embedded join is the org filter (the `group.service#listMyGroups`
  shape), so a membership in another org's group never reaches the context:
  `ctx.groupIds` is the caller's groups **in the active org** (ADR-0015 §7.1 — no
  cross-org union). One query, not two; the `Promise.all` with the membership
  lookup is unchanged.
- **The roles.** The same rows build `ctx.groupRoles: Readonly<Record<groupId,
'teacher' | 'member'>>`, so the ids and the roles cannot disagree. `GroupRole`/
  `GROUP_ROLES`/`isGroupRole` live in `@studiq/authz` beside `RequestContext`, and
  the column value is narrowed by `isGroupRole` (the table's CHECK allows those two
  values; nothing is cast). No active org, or a cookie org with no `org_members`
  row, leaves both empty — the membership rule is untouched.
- **No new verified-org helper.** The org scoping rides the `cookieOrgId` block
  that already is the verified-org helper: `activeOrgId` becomes the cookie only
  when an `org_members` row exists (lines above the group read, unchanged). No
  second rule about what "active org" means was added; the block was not
  rewritten for this phase.
- **Deleted** `packages/server/src/lib/request-context.ts`: a dead duplicate of the
  `@studiq/authz` interface (grep across `packages/`, `apps/`, `__tests__/`,
  `scripts/` found no importer; only two archived docs mention the path). No shim.
  `group.service#canShareContentToGroups`'s "Do NOT use ctx.groupIds: withAuth
  resolves memberships without an org filter" comment was false after this change
  and now says `ctx.groupIds` answers a different question from the tenant check
  (it is the caller's own active-org memberships, not every group of
  `contentOrgId`).
- **Tests.** `__tests__/unit/lib/with-auth.test.ts` (6 cases before this branch, 10
  at the 2a-4 commit, 12 after the correction below) adds an org-filtering stub
  that applies `groups.organization_id` the way the PostgREST embed does and
  applies `user_id` to the row list, and six cases: another org's group is absent
  from both `groupIds` and `groupRoles` (and the filter is requested); a group the
  caller is not a member of is absent; in-org `teacher`/`member` rows arrive with
  their roles; an unrecognised `role` keeps the group id but adds no role; a cookie
  org without a membership row leaves both empty; no cookie leaves both empty. The
  three legacy cases were extended rather than left alone: "honours the cookie org
  …" now also asserts `groupIds` and `groupRoles` (through the same org filter)
  alongside its permission scopes; the forged-cookie case and the no-cookie case
  also assert both empty.
  `__tests__/integration/group-roles-org-scope.test.ts` drives the same through
  real signed-in sessions: a user who is `teacher` in org A's group and `member`
  in org B's group sees exactly one group per active org, with that org's role, and
  nothing with no active org. A second group in org A, whose only member is another
  user, is absent from both contexts — without it the file passed with the org
  filter deleted (correction entry below).
- **Consumers.** 2a-5 reads `groupRoles` for scope resolution; 2b's group manage
  and invite are teacher-only. `groupIds` stays for every current reader.
- **Gates:** `typecheck:all`, `typecheck:admin`, `lint:all`, `test:unit` (4632
  passed, 1 skipped — before the fix below), `review:static`, `knip`, `dup:base`,
  `format:check`, and the new integration file against this branch's stack (2
  passed — the coordinator runs the full serial suite). Two mutations KILLED on
  the unit file (the org filter; the role value); the integration file was proven
  red by the same filter removal, applied by hand because `bun run mutate` refuses
  to edit a test file. `bun run pr:size` **59/400** at that commit. Both
  red-proofs were weaker than they read and were re-done after review — see the
  difficulty-log entry below for what actually failed to fail. Re-run after the
  correction: `test:unit` 4634 passed, 1 skipped; the integration file 2 passed;
  `bun run pr:size` **59/400** (the correction is all tests and Markdown).

**Difficulty log**

#### 2026-11-19 — the role guard's mutation survived, and that is the right answer

What: narrowing `group_members.role` with `isGroupRole` instead of a cast cannot
be killed from a unit test. With the org filter present, the stub can only return
in-org rows, and the column's CHECK (`role IN ('teacher', 'member')`,
`20260703000012_create_groups.sql`) has already rejected every other value before
the row leaves the database; a test that hands the handler a `'staff'` row would
pin a database the product never has. The mutation that replaces the guard with an
unguarded cast SURVIVED, and that is recorded rather than papered over.
Why: the guard is a type-system boundary over a text column, not a business rule.
Its value is that the record's type is honest at the one place the column becomes
a `GroupRole`, not that a second runtime check will ever fire.
Fix: no test added for the guard; the org-scoping and role-value invariants are
proven instead. A value outside the CHECK stays impossible at the table, and a
future write path that widens the CHECK must widen `GroupRole` with it — TypeScript
fails there, which is the cheaper gate.
Rule: none — this is the "a test must be able to fail" check returning an honest
negative, already covered by AGENTS.md's mutation-gate section.

##### Correction (same day, before merge) — the negative was wrong in two places

The entry above is left as written; two of its facts did not survive review.

The guard. The claim "cannot be killed from a unit test" assumed the test may only
hand `withAuth` rows the CHECK allows. That is one question — _can the database
hold a `'staff'` row?_ — and the handler's behaviour is another: _given a row whose
`role` is not one of the two, what reaches the context?_ The stub is a fake, not a
database, and the handler's answer is observable: the group stays in `groupIds`
and gets no entry in `groupRoles`. That is what keeps the record's type honest at
the boundary, and it is exactly what a later write path that widens the CHECK
without widening `GroupRole` would first break. `__tests__/unit/lib/with-auth.test.ts`
now pins it ("reports a group whose role it does not recognise as a group without a
role": two in-org rows, one `teacher`, one `staff`). Both recorded mutations are
KILLED by that one case, nothing else: `groupRoles[row.group_id] = row.role as
GroupRole` (the original unguarded cast) and `groupRoles[row.group_id] =
isGroupRole(row.role) ? row.role : 'member'`. The CHECK argument above is still
true and still worth having — it is simply not the reason the guard is untestable,
because the guard is not untestable.

The org filter. The 2a-4 entry above says the unit file kills the filter removal.
It did not. Two legacy cases (`honours the cookie org …`, `drops the cookie org …`)
answered `group_members` from a flat per-test list that ignored both the org and
`user_id`, so with the org filter deleted they still got their rows. Only the
newer org-scoped cases were real, and the integration file had the opposite
defect: every user in it was a member of every group it asserted on, so deleting
`.eq('groups.organization_id', cookieOrgId)` left it green as well. A filter that
can be dropped without a failure is not tested, and a stub that ignores the query
is a fixture that asserts nothing about it.

Fix: `group_members` has one stub in the unit file (`groupMembersStub`) and it
applies every filter the read sends — `groups.organization_id` and `user_id` —
so the legacy cases can no longer be answered independently of the query. The
integration file seeds a second group in org A whose only member is another user:
readable through "Org members read group members" RLS, outside the caller's own
membership. Derivative assertion ("`groupIds` is exactly the keys of `groupRoles`")
deleted — both are filled in one loop, so nothing inside the handler can make them
disagree; the guard case above is what that line was pretending to be.

Rule: a stub answers the query it is given, never a fixture the test prepared
apart from it — otherwise the mutation that deletes a filter changes nothing, and
a test that cannot tell is not a test of the filter. An untestable guard is a
claim to check, not a conclusion: ask what the code does with a value the schema
forbids before accepting that nothing can.

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

### Phase 8 — extendability (release gate)

_Not started._ Specified in
[role-authority-rollout.md](role-authority-rollout.md#8--extendability-audit-post-phase-7-release-gate);
phase 7 is not closed until it passes (D23).
