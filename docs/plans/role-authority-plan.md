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

| Phase | What                                           | State                            | PR          | CI  | QA shards                 | Updated    |
| ----- | ---------------------------------------------- | -------------------------------- | ----------- | --- | ------------------------- | ---------- |
| 0     | docs, ADR-0015, ledger, orchestrator contract  | merged                           | #1162       | —   | checks                    | 2026-11-19 |
| 0b    | batch-0 cleanup (N1, dead code, invariants)    | merged                           | #1387       | —   | checks, unit, integration | 2026-11-19 |
| 1a    | database types regenerated with the pinned CLI | merged                           | #1388       | —   | checks, unit, integration | 2026-11-19 |
| 1b    | catalog rename (tables, limits, permissions)   | merged                           | #1389       | —   | checks, unit, integration | 2026-11-19 |
| 1c    | catalog cutover (ENTITLEMENTS, documents)      | merged                           | #1390       | —   | PUB, ADM, LIM, BIL        | 2026-11-19 |
| 2     | authority cutover + control-plane RLS          | merged                           | #1397–#1404 | —   | AUT, MGR, EDU, SEC        | 2026-11-21 |
| 3     | entitlements and limits                        | active (3d, `feat/authority-3d`) | —           | —   | LIM, BIL, STU             | 2026-11-22 |
| 4     | seats and personal plans                       | active (4a, `feat/authority-4a`) | —           | —   | MGR, BIL, LIM             | 2026-11-22 |
| 5     | enforcement closure                            | pending                          | —           | —   | STU, EDU, MGR, PUB        |            |
| 6     | UI and cache                                   | pending                          | —           | —   | PUB, AUT, MGR, STU, EDU   |            |
| 7     | delete, full QA, close                         | pending                          | —           | —   | all 188 + E2E             |            |
| 8     | extendability audit (release gate)             | pending                          | —           | —   | all 188 + E2E             | 2026-11-19 |

**Next action:** phases 0b (#1387), 1a (#1388), 1b (#1389), 1c (#1390,
`67cfeb16`) and **2 are merged — phase 2 closed 2026-11-21 with 2b-9**
(`feat/authority-2b-9`, delivered block below): the 2a slices plus all nine 2b
slices are on `main`, 2b-7 as `f62b896d` (#1403) and 2b-8 as `9747f372` (#1404).
The only `allowedAccountTypes` left on the API surface are the four declared
exceptions (R5 org/classroom creation ×2, phase-5 `ai/*` ×2), pinned by
`__tests__/unit/guards/persona-gates.test.ts`; the remaining persona branches
are named with owners in the 2b-9 deferral register. **Phase 4a is active on
`feat/authority-4a` (2026-11-22):** the four plan-resolution rows the register
named to phase 4 are closed (D32–D34, block below); 3c and 3d are delivered
below and the Teacher content-read gap is closed (D29).

Phase 2b is complete — nine slices, in the settled order recorded in the
phase-2b table below: **2b-1** (the `permission_key` foreign key and its
backfill) merged as `6ec591dd` (#1397), **2b-2** (group permissions and their
RLS twin) merged as `6b6554f2` (#1398) together with its follow-up pass (the
`/edu/groups` nav gate and EDU-GRP-05's settled text), **2b-3** (the
org-control route sweep and its RLS twin) merged as `929b3cd9` (#1399),
**2b-4** (the remaining control-plane RLS and the billing gate) merged as
`9da8c9b3` (#1400), **2b-5** (class invites: `invitations.group_id` +
`target_group_role`, `group.invite` at group scope, the invitation read moved
with the write, `can_assign_org_role`'s manager half onto
`org.invitation.manage`, the teacher-name exception deleted) merged as
`e2f90bb9` (#1401), **2b-6** (the content-route sweep) merged as `67fab892`
(#1402), **2b-7** (the legacy-marker deletion) merged as `f62b896d` (#1403),
**2b-8** (the RLS half of the role-editor guards) merged as `9747f372` (#1404),
and **2b-9** (the phase-2 closure: the deferral register and its source-scan
guard) delivered on `feat/authority-2b-9`. The phase-2 row is `merged` — nine
slices plus 2b-9's guard make phase 2 done.

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

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                              | Earned from                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Workers never author migrations. SQL goes in the PR body; the integrator renumbers.                                                                                                                                                                                                                                                                                                                               | `check-migration-timestamps` fails on duplicate prefixes                                                                                                                                                                                                                                                                                                                                                                |
| R2  | Regenerate `database.ts` in the same PR as any schema change typed code consumes; phase 1a performed the generator cutover, so regeneration is a routine step, not a tooling project.                                                                                                                                                                                                                             | the pinned v3.1 generator emits a different shape and 7 RPC type errors                                                                                                                                                                                                                                                                                                                                                 |
| R3  | `knip.ts` and `eslint-suppressions.json` are integrator-only.                                                                                                                                                                                                                                                                                                                                                     | both hooks run `knip --treat-config-hints-as-errors`                                                                                                                                                                                                                                                                                                                                                                    |
| R4  | A rule that lives in both the API and RLS changes in the same PR.                                                                                                                                                                                                                                                                                                                                                 | FP-01 is exploitable through PostgREST                                                                                                                                                                                                                                                                                                                                                                                  |
| R5  | No `allowedAccountTypes` on an org-resource route; the only persona exceptions are org creation and classroom creation.                                                                                                                                                                                                                                                                                           | audit §0.2: 41 of 45 gates are permission checks                                                                                                                                                                                                                                                                                                                                                                        |
| R6  | A QA case that encodes a bug is edited with its spec; it is never skipped.                                                                                                                                                                                                                                                                                                                                        | the corpus is the product contract                                                                                                                                                                                                                                                                                                                                                                                      |
| R7  | Workers may not merge to `main` and may not report a phase done without a CI conclusion.                                                                                                                                                                                                                                                                                                                          | prose is not a verdict                                                                                                                                                                                                                                                                                                                                                                                                  |
| R8  | When a decision narrows scope, grep the whole document for every mention of the removed thing and label it.                                                                                                                                                                                                                                                                                                       | a v1 scope change left six sections describing the deferred table                                                                                                                                                                                                                                                                                                                                                       |
| R9  | Every number in a doc is produced by a command, not by memory.                                                                                                                                                                                                                                                                                                                                                    | "176 specs / 188 cases" mixed two corpora; "seven tables" was nine                                                                                                                                                                                                                                                                                                                                                      |
| R10 | Re-verify every checklist line against the tree before dispatch.                                                                                                                                                                                                                                                                                                                                                  | a six-day-old 0b checklist cited three already-shipped items                                                                                                                                                                                                                                                                                                                                                            |
| R11 | Grep a named "single reference" across the whole tree; never trust one.                                                                                                                                                                                                                                                                                                                                           | "only reference is the generated type file" missed a seed `REVOKE`                                                                                                                                                                                                                                                                                                                                                      |
| R12 | A fix is not closed until the write path that can undo it has a test.                                                                                                                                                                                                                                                                                                                                             | the role save drops the `assignment.*` rows the seed grants                                                                                                                                                                                                                                                                                                                                                             |
| R13 | A generated file you cannot regenerate deterministically is a tooling task, not a cleanup edit.                                                                                                                                                                                                                                                                                                                   | the 0b regen produced a different shape and 7 RPC type errors                                                                                                                                                                                                                                                                                                                                                           |
| R14 | Never hand-edit a generated file: the next regeneration deletes the edit, including lint suppressions. Fix the call sites or exempt the file in config.                                                                                                                                                                                                                                                           | the committed `database.ts` carried a hand-added inline eslint-disable                                                                                                                                                                                                                                                                                                                                                  |
| R15 | When a phase deliberately keeps a legacy key, pin the exact exception in the invariant; never delete the assertion.                                                                                                                                                                                                                                                                                               | the phase-1b `group.manage` overlap                                                                                                                                                                                                                                                                                                                                                                                     |
| R16 | When a phase makes a producer non-authoritative, grep the QA corpus for fixtures writing to it in the same PR and run one full shard; a case-ID smoke set misses old-writer fixtures.                                                                                                                                                                                                                             | 2a-1's branding fixture failed only in the CI shard                                                                                                                                                                                                                                                                                                                                                                     |
| R17 | A gate flip comes last: make the write path behind it unable to destroy the authority it guards before the gate changes hands.                                                                                                                                                                                                                                                                                    | the `org.role.manage` gate would have been deletable by one role save                                                                                                                                                                                                                                                                                                                                                   |
| R18 | A SECURITY DEFINER helper whose policy lives on a table it reads must bypass RLS itself (`security definer`, `search_path = ''`), or the policy recurses (42P17).                                                                                                                                                                                                                                                 | the `org_role_permissions` predicate read its own table                                                                                                                                                                                                                                                                                                                                                                 |
| R19 | Migrations own every grant: `db reset` and `db push` must end with the same privileges, and a dev-only seed may never revoke or re-grant a production privilege.                                                                                                                                                                                                                                                  | 2a-2's seed-revoked helper 403'd every role write after a reset while the suite stayed green; the seed was retired after the audit                                                                                                                                                                                                                                                                                      |
| R20 | A dotted key makes `toHaveProperty` useless in both directions — assert `Object.keys(map)` or index the map, and grep the corpus when a payload's shape changes.                                                                                                                                                                                                                                                  | a flat `group.manage` map made the positive assertion fail and the negative one pass regardless of the map's contents                                                                                                                                                                                                                                                                                                   |
| R21 | A read route's SELECT policy is part of its gate: a filter that runs after the gate turns a refusal into an empty page, not an error.                                                                                                                                                                                                                                                                             | the seat-assignment list admitted a key holder and RLS filtered every row silently                                                                                                                                                                                                                                                                                                                                      |
| R22 | When one policy carries two authorities, moving one is a split, not a sweep — name the conjunct that still owns the other half, or the next reader calls its 42501 a bug.                                                                                                                                                                                                                                         | the invitation UPDATE kept `can_assign_org_role`'s membership-marker manager half                                                                                                                                                                                                                                                                                                                                       |
| R23 | An API gate may stay deliberately narrower than its data-plane policy when the policy predates it and narrowing it means auditing every reader; the asymmetry is recorded with a named owner in the same PR, never left as two unnamed answers.                                                                                                                                                                   | D25 kept the roster read at four named keys while the `org_members` SELECT policy still admits any same-org member (2b-4)                                                                                                                                                                                                                                                                                               |
| R24 | A QA persona's authority is its org-role row, not its account type: audit the seeded **default** accounts around a role change (not just the ones a profile promotes), and a case built on the old default declares its own roster.                                                                                                                                                                               | the `content` profile's "teacher" was an educator persona on the Member role until D25's roster read refused it                                                                                                                                                                                                                                                                                                         |
| R25 | A write policy cannot move before the read policy it depends on: PostgREST refuses an UPDATE whose row the SELECT policy hides, so the write and the read move in the same slice.                                                                                                                                                                                                                                 | the half-moved `can_assign_org_role` left an `org.invitation.manage` + `org.member.manage` role unable to retarget an invitation it could not read; 2b-5 now owns both (2b-4)                                                                                                                                                                                                                                           |
| R26 | A guard that asserts a predicate must also assert the row exists: `count(*) = 0 … not like` is vacuously true when the policy is dropped, so the thing it guards can be deleted and the guard stays green.                                                                                                                                                                                                        | 2b-4's boundary block passed with `Visible teacher assignments` dropped; requiring the row (`count(*) = 1`) raised (2b-4 review pass)                                                                                                                                                                                                                                                                                   |
| R27 | A migration's closing guard pins the state its own file creates, so once a later slice rewrites the same object, the earlier file can no longer be replayed on top — the suite's replay list is the newest file that owns the object, not the whole chain.                                                                                                                                                        | 2b-5 rewrote the four `invitations` policies, and replaying 2b-3's file afterwards raised at 2b-3's own guard (it pins the pre-2b-5 SELECT); the RLS suite now replays only 2b-5's file                                                                                                                                                                                                                                 |
| R28 | An authority invariant is proven from the path that APPLIES the value, with a fixture that differs from the asserted outcome — a test minted and asserted with the same value (the invitee's own role as the invite's target) cannot fail on the escalation it claims to guard.                                                                                                                                   | the 2b-5 review: the class-invite accept test minted with `targetOrgRoleId = memberRoleId` and asserted `org_role_id === memberRoleId`, so flipping the RPC's class branch to `do update set org_role_id = excluded.org_role_id` stayed green; the tampered-row case used Admin only for a non-member, refused before any write                                                                                         |
| R29 | A check and the write it guards must be ONE statement when the guarded row can change concurrently: READ COMMITTED gives every statement a fresh snapshot, so `not exists` in one statement and `insert … on conflict do nothing` in the next leaves a window — fold the check into the insert (`insert … select … where exists …`).                                                                              | the 2b-5 review TOCTOU: a membership row deleted between the accept RPC's D7 pre-check and its class-branch insert was re-created with the invite's target role (reproduced by hand: `INSERT 0 1` with the Admin role); the self-guarding insert wrote `INSERT 0 0`                                                                                                                                                     |
| R30 | A `WITH CHECK` evaluates the NEW row, so it cannot express "this column may not change" — column/identity immutability belongs in a `BEFORE` trigger; a policy decides which rows may be written.                                                                                                                                                                                                                 | 2b-8: the `org_roles` UPDATE `is_system` conjunct refused every legitimate system-role edit, while the `custom → is_system` flip it targeted passed `guard_system_org_role_identity`, which checks only `OLD.is_system`                                                                                                                                                                                                 |
| R31 | A phase closes when every remaining branch is named with an owner and a phase, and the exit criterion is pinned by a source-scan guard, not a promise.                                                                                                                                                                                                                                                            | 2b-9: the phase-2 closure shipped a deferral register plus `persona-gates.test.ts` instead of "the only gates left are the declared ones" prose — a fifth gate or a stale entry now fails a test, not a review                                                                                                                                                                                                          |
| R32 | A blacklist→whitelist switch is behaviour-preserving only if the metadata already partitions the key space; pin the key that differs in a ported case.                                                                                                                                                                                                                                                            | 3a: the `personalPortable` whitelist dropped `flashcards`/`quiz` from the personal layer inside orgs — the design had called the switch "equivalent for today's catalog" because `scope` and `personalPortable` are different axes                                                                                                                                                                                      |
| R33 | A per-request query-count target is a structural claim, not a loop-count claim: count the tables the resolution actually reads and pin the number in a test, because "one per table" can exceed the target if the table list is longer than the target.                                                                                                                                                           | 3b: `resolveEntitlements` reads 11 tables, so flat reads cost 11 queries in the full case; FK embeds plus batched catalog reads brought it to 7, pinned by `entitlement.resolver.limits.test.ts`                                                                                                                                                                                                                        |
| R34 | A reader that tests `NOT EXISTS (any row)` changes meaning when a table flips from grants to revokes-only: "any row" becomes "any revoke", and existence stops being evidence of anything. The replacement is not `NOT EXISTS (enabled row)` — an enabled row must stay inert in every reader — but no existence gate at all plus a subtraction of what the new polarity carries.                                 | 3c: `has_org_feature`'s profile fallback was guarded by `NOT EXISTS (any row)`; once `org_role_features` holds only revokes, that predicate skips the profile for any role with one revoke. The re-creation first became `NOT EXISTS (enabled row)`, which let a stray enabled row deny a whole role; it is now profile − revokes + seat ∩ ceiling with the revoke subtraction inside the profile arm (R34 review pass) |
| R35 | A matrix change is a data migration, not a template edit: a callable seed with `on conflict do nothing` only creates missing rows and can never reconcile existing ones, so the template, the function and a backfill must land together behind a guard that pins the resulting rows. Read the newest definition of a callable across the migrations, not the file a note names — a later slice can re-create it. | 3d: moving the Teacher content reads to `group` changed the TS template and the function, but every live system Teacher kept its `own` rows; `20261119211000` (not the `20261119180000` body the phase note named) owns the live function, and the guard requires reads `group` / writes `own` across `org_roles × permissions`                                                                                         |
| R36 | A column-pair CHECK constrains the backfill too: every legacy value — NULL included — must map to a CHECK-valid pair before the constraint is added, or the ALTER fails on a fresh chain where the seed has not run yet and the pre-catalog rows still sit there with NULL.                                                                                                                                       | 4a: `for_account_type` was NULL on the legacy migration-inserted plans the seed deletes later, so the scope/audience pair CHECK rejected a NULL→personal mapping; NULL maps to the organization family, the only pair shape with a NULL audience                                                                                                                                                                        |
| R37 | A validation rule that is catalog data must be read from the table in the same query that guards the write (FK embed), never from a TS constant: the constant becomes a second copy of the catalog that silently allows what the table forbids.                                                                                                                                                                   | 4a: `PLAN_TIER_MAP` was a hardcoded second copy of `for_account_type` and let any plan key mint a seat pool; `addPool`/`assignSeat` now read `seat_eligible`/`audience` from `entitlement_catalog`/`subscription_plans` embeds in the one query they already make                                                                                                                                                       |
| R38 | A join added to a query is executed with the caller role's privileges: giving an anonymous endpoint one embed of a table only `authenticated` may select turns every anonymous call into 403, and no session-authenticated test notices.                                                                                                                                                                          | 4a: `PlanInfo.seatEligible` embeds `entitlement_catalog` on every plan read, so the public pricing catalogue answered 403 for `anon` until the migration granted it SELECT; the three anon census probes (`grant-parity`, `anon-grants`, `rls-tenant-isolation`) were the only tests that could see it, and the served QA run is what surfaced it                                                                       |

## 4. Decisions

All settled 2026-11-13; the full wording is ADR-0015 §15.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `org.admin` is a real permission for ownership only; no superuser override                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D2  | Managers get a free `solo` plan; `launch` is organization-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D3  | Personal plans are portable for `personalPortable` keys and user-scope quotas only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D4  | A seat can only raise a user-scope limit: `max(org, seat, personal)`, `-1` short-circuits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D5  | v1 ships `entitlement_profile` (`all \| learner \| none`); allocation is deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D6  | Teacher `all`, Member `learner`, Custom `none`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D7  | Class invites use `group.invite` for existing org members; no external invites in v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D8  | Flags are a kill switch only (`is_enabled = false`); no rollout percentage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D9  | `flashcards` and `quiz` are baseline, always on, never gated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D10 | `account_type` is not renamed in this programme; the semantics change only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D11 | This programme fixes control-plane RLS only; content RLS is a separate security ADR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D12 | Overrides bypass flags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D13 | A `student` persona may hold the Admin role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D14 | Persona is a UI filter for plan purchases; the one server check is seat assignment against `audience`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D15 | Org plans grant ZERO licences; licences are sold separately. A licence is the purchased unit (`org_seat_pools` = the licence pool, its `plan_key` must be `scope='personal'` + `seatEligible`); `org_seat_assignments` is one member occupying one licence. No `plan_seat_grants`, no `org_seat_licenses`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D16 | `org.admin` is `assignable = false`: ownership (delete org, transfer ownership) is not grantable through a custom role. The system Admin template keeps it; every other catalog key is assignable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D17 | Role templates are editor presets, not extra org rows: every org keeps admin/teacher/member; Assistant/Billing/Read-only/Blank are created from a template via POST /organization/roles. ADR §4.2 is amended to match §9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D18 | Teacher profile 'all' means the org ceiling minus the four legacy management markers; markers resolve only from org_role_features rows, so a Teacher never inherits member.manage/role.builder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D19 | entitlement_profile is authoritative for every entitlement key; legacy `org_role_features` rows are read only as explicit `is_enabled = false` revokes (the four marker grants left the catalog in 2b-7, plan-shaped grant rows leave in 3c). Phase 3 deletes the legacy writer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D20 | Role changes are logged (actor, role, before, after) through @studiq/server/lib/log until an audit table exists; no audit subsystem is invented in phase 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D21 | Changing or removing a grant requires authority over the current scope as well as the target; org.admin holders are exempt from 'no self-edit', or a single-admin org could never edit its own Admin role.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D22 | Entitlements are an open catalog: a key ships with its surface. `documents` is absent in v1 because the surface is not implemented (roadmap), not deleted permanently; re-entry is catalog + flag + plan rows, no resolver change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D23 | **Extendability is a release gate.** Phase 7 is not closed until a new entitlement can be added to a **live** app as data + one surface call, with no resolver change and no user-visible surface broken; any code change required for a data-only change is a defect fixed before close.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D24 | **The editor lands before the gate flip.** 2a-3 (closed-catalog editor + complete payload) precedes 2a-2 (`requirePermission('org.role.manage')`): `setPermissions` deletes every row for the role and re-inserts only the payload, while the old editor rendered 20 hardcoded keys, so flipping the gate first would let one save on the Admin role delete `org.role.manage` and every `group.*`/`org.*` row and lock the org out of role management permanently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D25 | **The roster read is four authorities, and its deny shape is an empty list.** `GET /organization/members` is readable with `org.member.manage` at org scope, or `group.manage`, or `group.invite`, or `org.seat.manage` at any scope the role holds them. The catalog has no `org.member.read`; a Teacher must not hold `org.member.manage` (D18/FP-04); and three teacher surfaces legitimately need the roster (`/edu/classroom/members`, the assignment student picker `?role=member`, the `/edu` onboarding counts). `org.seat.manage` is the fourth because the shipped **Billing** preset is exactly `org.billing.manage` + `org.seat.manage` and `/manage/seats` fills its assign dialog from this endpoint: the rule is "read the roster if you may act on it", and a code-owned preset is a consumer too (R24's lesson, one layer deeper than the QA seeds). Everyone else gets `200` + `data: []`, which leaks nothing and is the shape AUT-19 accepts; `PUT`/`DELETE` stay `org.member.manage`, so the Billing preset still fails every member/role/settings/invitation write. The `org_members` SELECT policy stays as it is (the API is now narrower than the data plane by design; the RLS read predates the slice and narrowing it must audit every `org_members` reader). **2b-4 audited it and left it: the readers it would empty need keys D25 does not name, so phase 5 (the 2b-9 slot) owns the narrowing.** |
| D26 | An **active** user override is the final word on its key in both directions; a flag never cuts an override-granted key (D12 made explicit). ADR §6.1's pseudocode order is corrected accordingly: the flag pass skips keys an active override owns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D27 | Per-role `org_role_features` revokes have no product surface in v1; the legacy writer is deleted in 3c (`change_org_plan`), and revoke rows stay readable until phase 7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D28 | `/me/plan` may show the effective union (org + personal/seat) from phase 3; the `PlanInfo` envelope stays stable until phase 6 renames the endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D29 | Teacher content `*.read` keys move to `group`, writes stay `own`, `assignment.read` included — landed in 3d (`feat/authority-3d`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D32 | `subscription_plans.scope`/`audience` replace `for_account_type` (dropped in the same migration); `solo` is the free manager personal plan; manager profiles holding an organization-scope plan are backfilled to `solo`; `org_seat_pools.plan_key` FKs the plan table — landed in 4a (`feat/authority-4a`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D33 | A seat is a licence of a personal plan validated from live catalog data: `addPool` requires an active `scope='personal'` plan whose keys are all `seatEligible` in `entitlement_catalog` (422 on `planKey`); `assignSeat` requires the target's `profiles.account_type` to equal the plan `audience` (BAD_REQUEST); `PLAN_TIER_MAP`/`ROLE_TIER_MAP` deleted — landed in 4a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D34 | Plan composition keys on plan scope, not the caller's persona: inside a verified org an organization-scope personal plan never applies; `getMyPlan` = seat plan, else org plan with `org.billing.manage`, else personal; `resolveApplicablePlan` audience-checks personal plans only and answers FORBIDDEN for an org plan with no org id; `/subscription-plans` filters are `scope`/`audience` — landed in 4a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
| **2a-5** | fail-closed scope defaults (`own` only with no active org, content keys only) + the full `Permission` set.                                                            | 80 (`bun run pr:size`)  |

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

- **Phase 4** seat-parity gap in `has_org_feature` — **closed in 3c**: the
  twin's seat arm is now outside every row-existence block and intersected with
  the org ceiling, matching the resolver. The one remaining divergence is the
  admin wildcard (`is_system AND name = 'admin'`), owned by phase 5 with the
  org-delete path.
- **Phase 5** must not assume Teacher `stats.read` is `own`: `SYSTEM_ROLE_TEMPLATES`
  and `seed_system_role_permissions` grant `group`. **Closed in 3d** for existing
  organizations — the backfill canonicalises every system Teacher content read to
  `group`, so this caution no longer applies.

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

**2a-5 shipped on `feat/authority-2a-5` (PR pending):**

- **`resolveScope` is fail-closed inside an org.** `packages/server/src/lib/authz.ts`:
  a stored `ctx.permissionScopes[key]` still wins; with an active org and no row
  the answer is `null` for every key, content CRUD included (ADR-0015 §6.3). This
  closed the FP-04-shaped hole where a student whose org role withheld
  `deck.update` was silently granted `own`. The persona default survives only
  outside an org, only for STUDENT/EDUCATOR, only for a `.read|.create|.update|.delete`
  verb, and only when `PERMISSIONS[key].category === 'content'` — so `group.read`
  and `org.*` can never take it, and a key outside the catalog gets none.
- **`Permission` is the whole catalog.** 44 keys, up from 27 at the branch point
  `origin/main` (`0b5932a0`), where only `org.role.manage` stood in for the
  `stats.*`, `quiz.*`, `group.*` and `org.*` families. Both counts are derived with
  `git show <ref>:packages/authz/src/lib/permissions.ts | sed -n '/^export const Permission = {/,/^} as const;/p' | grep -cE "^  [A-Z_]+: '"`,
  and equal the catalog's own 44 `PERMISSIONS` entries (R9). The R15 pin in `__tests__/unit/guards/permission-scopes-catalog.test.ts`
  ("catalog keys read outside `Permission`") is now `[]` instead of
  `['org.admin']`; the guard itself stays, and `Permission ⊆ PERMISSIONS` holds.
- **The controller has no second default.** `permissionsController.listMyPermissions`
  maps `Object.values(Permission)` through `resolveScope` and materialises every
  key that resolves. It stayed on `Permission` rather than the catalog because
  `usePermission()` only ever looks up a `Permission` key, and the endpoint is the
  UI's copy of the same function — a key it withheld from the server would be a
  second truth. Grep confirms no other definition of the default remains
  (`endsWith('.read')` survives only in `org-roles.ts` role presets).
- **Tests.** `__tests__/unit/lib/authz.test.ts`: stored row wins inside an org
  and is returned as-is (an `own` row is not widened by the persona default while
  its unrowed sibling stays `null`); a student/educator keeps `own` for content
  CRUD with no org; a student, educator and manager are all denied content keys
  inside an org with no row; `group.*`/`org.*` keys are null with and without an
  org; a verb-shaped unknown key is null.
  `__tests__/unit/controllers/permissions.controller.test.ts`: no content key is
  claimed inside an org without a row, a manager with no org gets `{}`, a no-org
  educator still gets `own`, a content key gets `own` while `group.read`/`org.*`
  stay absent (the category guard, at the payload boundary), and a non-CRUD verb
  (`assignment.publish`/`.grade`) is absent. Retargeted, not weakened: the three
  service fixtures that ran with `activeOrgId` and an empty scope map
  (question-bank, topic, flashcard-deck) now carry their role's rows, because
  their subjects are content CRUD inside an org.
- **Can now 403** (a scope that used to resolve no longer does): every content
  CRUD/write a STUDENT/EDUCATOR performs **while an org is active** whose role row
  is absent or narrower than `.read/.create/.update/.delete` — deck, flashcard,
  topic, question, question bank, quiz (routes and `can()` gates), plus
  `buildQueryFilter`/`accessibleFilter` reads that now answer `_impossible`.
  No stored-scope resolution outside an org changed: outside an org a
  `permissionScopes` entry still wins and the persona default is what it was.
  `GET /api/v1/permissions/me` claims no key it did not already claim: the new
  `Permission` keys route through `resolveScope`, which cannot resolve them for a
  student/educator outside an org. The 403s land on org-active requests, and
  `usePermission()`-gated buttons hide there too — the UI and the API agree,
  which is the point.
- **Gates:** `typecheck:all`, `typecheck:admin`, `lint:all`, `test:unit`
  (4646 passed, 1 skipped), `review:static`, `knip`, `dup:base`, `format:check`,
  `bun run pr:size` **80/400**. The stored-row pin is proven with `bun run mutate`
  (`KILLED`): widening a stored row to `own` turns "keeps a stored scope wider
  than the persona default outside an org" red, and a payload that emits `own`
  for any verb-shaped key turns the controller's category case red.

**Difficulty log**

#### 2026-11-19 — three "killed" proofs were dead tests, not live ones

What: the first mutation pass over 2a-5 read `ERROR (0 executed)` for the
in-org fail-closed case, and two more proofs came back `SURVIVED` for a guard
that does exist. `bun run mutate` passes `--name` to `vitest run -t`, which is
substring matching (`^…` and `$` are literal), and a table row's title is
`<template> (student)`, not the template. Those two were cheap to fix — a
separately named single-assertion case and titles quoted as they print.
Why: the third was not. `category === 'content'` was pinned from two keys that
each carry the _other_ guard: `group.read` is a read verb (the verb filter
refuses it even with the category test deleted) and `org.role.manage` is not a
verb at all (the same). Only the pair of them — one read, one non-read — can
tell the two guards apart, and only with a _single_ assertion per case, because
`toEqual`/loops report the first failing key. The `isPermissionCatalogKey`
guard had the same shape (`role.builder.manage` is not a verb, so deleting the
catalog test changed nothing; `legacy.read` is).
Fix: the cases now separate the probe per key (`decides a read key by its
category, not its verb`; a verb-shaped unknown key in `returns null for unknown
permissions`) and the mutations rewrite the whole default instead of one
sub-expression, so the proof is the branch rather than a phrase inside it.
Rule: a mutation must remove the whole decision, not a phrase inside it; when one
guard is only observable through a key another guard also refuses, give each
guard a probe key the other one lets through, one assertion per case.

### Phase 2b — authority and control-plane

**Settled 2026-11-19, re-numbered 2026-11-20 — nine slices.** The order below is
the settled one: the org-control sweep (2b-3) lands before the remaining
control-plane RLS (2b-4), because the routes and their predicates move together
(R4) and the sweep is what names which policies 2b-4 still owns; class invites
(2b-5) wait for the `invitations` shape they need.

| Slice | Contents                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2b-1  | `org_role_permissions.permission_key` → `permissions(key)`, the backfill, the closed scope CHECK. **Merged** `6ec591dd` (#1397).                                                                                                                                          |
| 2b-2  | Group permissions (`group.read/manage/member.manage`) + `rls_caller_has_group_permission` on the six `groups`/`group_members` write policies. **Merged** `6b6554f2` (#1398).                                                                                              |
| 2b-3  | Org-control route sweep: settings, members, seats and invitations lose `allowedAccountTypes` and gate on `org.*`; their RLS policies move to `rls_caller_has_permission` in the same PR. **Merged** `929b3cd9` (#1399).                                                   |
| 2b-4  | The remaining control-plane RLS: `billing_subscriptions`, the assignment writes and cohort read, the billing service gate, and the `org_members` SELECT review D25 leaves open. **Merged** `9da8c9b3` (#1400); `can_assign_org_role` and the invitation read were 2b-5's. |
| 2b-5  | Class invites: `invitations.group_id` + `target_group_role`, `group.invite` at group scope, `can_assign_org_role`'s manager half moved with the invitation read (PostgREST gates the write on it), and the teacher-name exception deleted. **Merged** `e2f90bb9` (#1401). |
| 2b-6  | Content-route sweep and the cross-package `authedRoute` adoption. **Merged** `67fab892` (#1402).                                                                                                                                                                          |
| 2b-7  | Marker deletion: `role.builder`, `org.manage`, `member.manage`, `group.manage` and their plan/flag/feature rows in that order, plus the pricing copy and QA expectations that advertise them. **Merged** `f62b896d` (#1403).                                              |
| 2b-8  | 2a-2's recorded security debt: the last-`org.role.manage`-holder and system-role guards at RLS. **Merged** `9747f372` (#1404).                                                                                                                                            |
| 2b-9  | Phase-2 closure: the deferral register (every remaining persona branch named with an owner and a phase) and its source-scan guard `__tests__/unit/guards/persona-gates.test.ts`. No product code. **Delivered on `feat/authority-2b-9`** (delivered block below).         |

**Re-numbered 2026-11-20 (R8).** The settled order changed the labels the
2026-11-19 table carried: 2b-3 was "the five embedded membership checks", 2b-4
`group.invite` + the teacher-name exception, 2b-5 "RLS on members, settings,
seats and invitations", 2b-6 "the last-holder and system-role guards", 2b-7
"remove `role.builder`'s entitlement twin", 2b-8 "remove the three legacy
markers" and 2b-9 "the pricing copy and QA expectations". Nothing was dropped:
the old 2b-5 is inside 2b-3 (routes + RLS together), the old 2b-6 is 2b-8, and
the old 2b-7/2b-8/2b-9 are 2b-7 and 2b-9.

**2b-1 merged as `6ec591dd` (#1397) — slice 1 of 9:**

- `supabase/migrations/20261119211000_org_role_permission_key_fk.sql`:
  re-creates and calls `migrate_org_role_permission_names()` **before** the
  rename (every historical migration that writes the table names the old
  column), renames `permission_name` → `permission_key` with its unique
  constraint, deletes the `any`/`granted` rows and narrows the scope CHECK to
  `own | group | organization`, adds
  `org_role_permissions_permission_key_fkey` with the default (RESTRICT)
  behaviour, re-creates the function against the new column plus
  `seed_system_role_permissions` and `rls_caller_has_permission`, renames the
  `plan_features_*` constraint leftovers on `plan_entitlements`, and ends with a
  single `do` block that raises when the key or the narrowed CHECK is missing.
- `with-auth.ts` (`ctx.permissionScopes`) and `org-role.service.ts` (reads,
  upserts, prune, gate count, audit log) use the new column; the `23503` an
  unknown key now raises maps to `BAD_REQUEST` through `toDbFailure`.
- `database.ts` regenerated with the pinned CLI 3.1 against this checkout's
  stack; a second regeneration is byte-identical.
- Tests: `__tests__/integration/org-role-permission-key-fk.test.ts` pins the
  `23503` for an unknown key, the `23514` for `any`/`granted` and a successful
  round-trip; the service suite moves to `permission_key` and pins the mapped
  error; `withAuth`'s suite reads the renamed column. New
  `latestShippedFunction()` in `__tests__/integration/test-utils.ts` is what the
  two suites that install a shipped function now use, so they install the
  definition the schema ends up with rather than the file they were written
  against.
- Gates: `env:reset-db --yes` twice (a re-apply proves the file is `db push`
  safe), the ten touched integration files serially (70 passed),
  `typecheck:all`, `typecheck:admin`, `lint:all`, `test:unit` (4648 passed),
  `review:static`, `knip`, `dup:base` (308 clones, one fewer than `origin/main`),
  `format:check`, `pr:size` (355/400).

**Follow-ups this slice creates:**

- The last-holder guard in `setPermissions` still counts a gate row whose scope
  the editor cannot render. This migration makes such a row unwritable, and
  `withAuth` already refuses to serve the value (`isPermissionScope` accepts only
  the three catalog scopes), so 2b-6 can decide whether the count keeps that
  branch for a restored backup or drops it for the closed schema.
- `deleteRole`'s pre-delete guard now destructures the row once; two statements
  on those lines is what `jscpd` flagged as a new clone, and a later reader
  touching the block should keep the shape.
- The replay test cannot insert an out-of-catalog role row: the foreign key
  refuses it, and the key it refuses is by definition one the catalog lacks.
  `catalog-rename-rewrite` therefore removes one catalog row for the duration of
  the test — the way a catalog move leaves a role row behind — and asserts the
  sweep deletes that row; the catalog-valid rows the org trigger wrote must
  survive both runs.

**Difficulty log**

#### 2026-11-19 — the rename is ordered by the migrations that write the column

What: putting the rewrite after the rename (the natural reading of "backfill,
then constrain") failed on the first `db reset`. A `create or replace function`
body is text until its first call, so every historical writer that names the old
column stays silent — the phase-1b trigger, 2a-1's `seed_system_role_permissions`,
2a-2's RLS helper — and only fails when it runs. This worktree hit it: a stale
`seed_system_role_permissions` survived a reset and failed every
`insert into organizations` with `column "permission_name" does not exist`.
Why: Supabase records a migration as applied from its file name, so a database
whose ledger already lists that file skips it while later migrations run. The
rename then never happened, and the failure landed on the first org write,
naming a column that appears in no current migration — an absent migration,
reported as a schema error.
Fix: the rewrite is defined and run in the old name **before** the rename (the
only column state every writer agrees on), re-created afterwards for a later
replay, and the file ends by asserting the constraint it owns. The two suites
that install a shipped function now install the newest definition from the
migrations instead of the file they name, since replaying a pre-rename file is
what re-installed the stale body.
Rule: a migration is applied by file name, not by content — so a schema change
that renames what earlier functions write must re-create those functions itself,
and a reset that passes proves little until it has run twice.

**2b-2 merged as `6b6554f2` (#1398) — slice 2 of 9:**

- **The rule.** `resolveGroupScope(ctx, key, groupId, group?)` in
  `packages/server/src/lib/authz.ts` is the one place a group key's authority is
  decided, from the context alone (ADR-0015 §4.3, §6.3):
  - `organization` — the role holds the key at org scope: every group of the
    active org. Admin holds `group.*` at organization; Teacher holds it at
    group scope, so a teacher reaches the classes they teach and no others
    (`packages/authz/src/lib/org-roles.ts`).
  - `group` — the caller is a **teacher of THIS group** (`groupRoles[groupId]`)
    **and** the role holds the key at group scope. Teaching is school, not
    authority (the seeded Teacher row carries the keys at `group`), and a
    `member` membership is read-only, which is exactly what `group` means.
  - `own` — the caller **created** the group (`groups.created_by`), and only for
    a key whose catalog row lists `own`. `group.invite` does not (§4.1), so an
    `own` invite row authorizes nothing.
  - `canGroup` applies the rule to one row (set lookups only — it no longer calls
    `can()`, whose `group` branch resolves a share _link_ and would have looked
    a class up in `deck_groups`). `requireGroupPermission` wraps it so a caller
    cannot forget the branch; it refuses a key outside the four `group.*` names
    outright rather than widening it to an org-wide answer.
  - Creating a class has no id to be a teacher of, so `canCreateAtOrgScope`
    requires the key at `organization` scope (controller **and** service).
    **Superseded in 2b-2-3**: the operator decided a Teacher may create a class,
    so the renamed `canCreateGroup` accepts any scope — see that entry.
- **The routes.** The four group route files (7 handlers) drop
  `allowedAccountTypes: [EDUCATOR, MANAGER]`; the controller now checks
  `canCreateAtOrgScope('group.manage')` on create and delegates the list and
  `PUT`/`DELETE`/roster/`addable-members` to the service so the group is resolved
  **before** the permission (a foreign id answers 404, not 403 — §7.1). Each
  handler hands its request over **unread** (`createGroup`, `updateGroup` and
  `setGroupMembers` take the `NextRequest`; `deleteGroup` the `params` promise),
  so the controller owns the id, the body and the permission together — see the
  `dup:base` entry for why that shape, and not the neighbours', is the one that
  keeps the mixed route layer at zero new clones.
  The service's `canManageAnyGroup` persona helper is deleted: `assertCanManage` was
  `accountType === MANAGER || created_by === userId`, and both halves are now the
  scope rule. The list's controller check is gone with it: `group.read` at `own`
  authorizes the caller's **own** classes, which only a row can answer, so
  `listGroups` resolves the scope itself (see the `own` difficulty entry below).
- **The UI reads the same keys (§7).** `group-management-screen` gates create on
  `usePermission()('group.manage')` (the one action with no row to ask about),
  and every per-row control on `manageVia` from the list payload —
  `'group.manage'` for the roster plus rename/delete, `'group.member.manage'` for
  the roster alone, `null` for the lock. The service computes it with the same
  `resolveGroupScope` calls the endpoints enforce, so a button cannot offer a
  call that answers 403 (the roster route checks `group.member.manage`, not
  `group.manage`). `use-group-options` fetches the org list on `group.read`, and
  the sidebar's „Grupy” item gained a `permission` field carrying `group.read`.
  The `group.manage` entitlement is no longer read by any of them; the resolved
  `/features/me` set still contains it (2a-1 keeps the markers until 2b-8), so
  nothing about plan display moved.
- **The RLS twin (R4).** `20261119212000_group_permission_rls.sql` adds
  `public.rls_caller_has_group_permission(p_group_id, p_permission)` —
  SECURITY DEFINER, `search_path = ''`, `stable`, execute to
  `authenticated`/`service_role`, `PUBLIC`/`anon` revoked (R18/R19). It is true
  when the caller is an `org_members` row of the group's org **and** (is a
  `teacher` in `group_members` for that group **or** their role holds the key at
  `organization`). The six policies move onto it: `groups` update/delete
  (per group), `groups` insert (org scope, written out), and the three
  `group_members` writes (`group.member.manage`, per group). The class list stays
  org-wide for a `group`/`organization`-scope reader; `manageVia` says who may
  edit.
  - The helper refuses an argument that is not a `group.*` catalogue key
    (`p_permission like 'group.%'` **and** a `permissions` row with
    `category = 'group'`). A teacher of the group satisfies the teacher branch for
    any key, so without the guard
    `rls_caller_has_group_permission(<taught group>, 'deck.update')` answered
    `true`, and the next policy that wired a content key here would inherit it.
    One integration case pins both answers for the same caller and group.
  - The two SELECT policies are untouched: a class list stays org-wide, and only
    `manageVia` narrows what may be done to a row.
  - The INSERT check is **not** `rls_caller_has_permission` (2a-2's helper, which
    asks only "holds the key at any scope"): measured on this stack, an
    `own`-only row created classes. The explicit `rp.scope = 'organization'`
    conjunct is what makes the policy true, and the integration file pins both
    directions.
  - The helper runs after slice 1 on purpose: it reads `permission_key`, the
    column 2b-1 renames. A migration is applied by file name, so landing it
    earlier would have had to name the old column.
- **What can now 403 that did not:** an org-scope `group.manage` holder is
  unchanged, but a role holding only `group` scope can no longer create a class
  (controller and INSERT policy), and a Teacher-role holder can no longer write
  a class they do not teach or add to its roster — through the API **or**
  PostgREST. A caller with no active org can no longer create either.
- **What a teacher gains/loses:** gains — a Teacher who owns a class manages it
  by teaching it, without any persona rule (`canManageAnyGroup`'s MANAGER branch
  is gone, and the persona gate that blocked a `student`-persona Admin is gone
  with it). Loses — the org-wide roster write the old
  `has_org_feature('group.manage')` policy granted every teacher, and class
  creation for a `group`-scope role.
- **Tests.** `__tests__/unit/lib/authz.test.ts` gains a group-scope truth table
  (org holder, teacher-of-group, member-of-group, outsider, teacher without the
  key, foreign org, no active org, `own` creator, `own` on `group.invite`, a key
  outside the family, create with/without an org); `group.service.test.ts` loses
  its persona cases and pins the scope rule per operation (including
  `group.member.manage` vs `group.manage`); the controller suite records the
  keys the routes ask for. `__tests__/integration/group-permission-rls.test.ts`
  drives real signed-in sessions through PostgREST in both directions (teacher of
  A writes A, refused 42501 on B; member refused; Admin-role holder writes any
  group; foreign org refused; a former member whose `group_members` row outlived
  its `org_members` row refused; roster gated on `group.member.manage`; create
  refused at `group` scope, allowed at `organization`).
  `group-permission-api.test.ts` drives the real `withAuth` + controller +
  service for the same matrix, including `manageVia` in the list payload.
  `rls-tenant-isolation.test.ts`'s B5 block now pins the narrowed roster write
  (a Teacher of the group writes it, the same role on another class is refused)
  instead of the retired org-wide one.
- **Gates:** `env:reset-db --yes`, the serial integration run,
  `typecheck:all`, `typecheck:admin`, `lint:all`, `test:unit`, `review:static`,
  `knip`, `dup:base` (0 new), `format:check`, `bun run pr:size`. The review pass's
  numbers are in its own entry below.

**Follow-ups this slice creates:**

- **2b-5** still owns `is_org_manager` on members/settings/seats/invitations.
  This slice deliberately does not touch them.
- **2b-4** should reuse `rls_caller_has_group_permission` for `group.invite` and
  can add the `group`/`organization`-only restriction the API already applies —
  the helper is scope-agnostic on purpose until an `own` invite row has a writer.
  _(Superseded: 2b-4's block hands class invites to 2b-5, which owns that row.)_
- **`group.read` on the list** is a new 403 for a role that holds neither
  `group.read` at `group`/`organization` nor a class it created: a custom role
  built from a blank preset used to get every class and now gets an empty list.
  The seeded Member role holds it at `group`, so no product surface changes.
- **`EDU-GRP-05`'s first expected result** ("the entry disappears from the
  menu") did not hold for the tenant it seeds: the `content` profile's educator
  is an org `teacher`, which keeps `group.read`. **Closed in the review pass**:
  the case text and its spec now assert what the model guarantees (readable
  list, every manage control absent, four 403s) — see the review-pass entry.

**2b-3 written on `feat/authority-2b-3` (PR pending) — slice 3 of 9:**

- **The count, re-derived (R9/R10).** `git grep -n allowedAccountTypes
6b6554f2 -- 'apps/web/src/app/(backend)/api/v1/organization'` reports **22
  occurrences in 13 files**; one is the R5 org-creation exception
  (`organization/route.ts` POST), so the sweep set is **21 persona gates in 12
  files**. Those 12 files export **22 handlers** — the invitation `POST` carries
  no persona today, and `invites/route.ts` keeps its public `?token=` branch. The
  handoff said "19 handlers / 12 files": the files are right, the gates are 21
  (two more) and the handlers 22 (three more). The command reads the base
  commit because the sweep is what removed the matches from this tree.
- **Route map** (the 12 files, method → key):
  - `organization/[id]` — GET membership-only; PUT `org.settings.manage`.
  - `organization/[id]/logo` — POST `org.settings.manage` **and**
    `requireFeature(ctx, 'branding')` (ADR §7: permission AND entitlement).
  - `organization/members` — GET `org.member.manage` **or** `group.manage`
    **or** `group.invite` **or** `org.seat.manage` (D25); PUT/DELETE
    `org.member.manage`.
  - `organization/roles` — GET membership-only; POST `org.role.manage` (2a-2's
    controller gate, unchanged).
  - `organization/roles/[id]` — GET membership-only; PUT/DELETE
    `org.role.manage`.
  - `organization/roles/[id]/permissions` — PUT `org.role.manage`.
  - `organization/seats/pools` — GET/POST `org.seat.manage`;
    `seats/pools/[id]` PUT `org.seat.manage`.
  - `organization/seats/assignments` — GET/POST `org.seat.manage`;
    `seats/assignments/[id]` DELETE `org.seat.manage`.
  - `organization/invites` — GET (no `?token=`) `org.invitation.manage`; POST
    unchanged (see below).
  - `organization/invites/[id]` — PUT/DELETE `org.invitation.manage`.
  - R5 exceptions untouched: `organization/route.ts` POST (org creation) and
    `teacher/classrooms/route.ts` POST (class creation). `ai/*` waits for
    phase 5.
- **The shape.** The 12 route files use `authedRoute`/`authedRouteWithParams`
  and drop `allowedAccountTypes`; the controllers own the keys
  (`requirePermission`, first statement, before any schema parse) and the
  services keep only tenant questions. `readsBody` is declared per route: the
  body-less member and assignment DELETEs answer 403, never the 400 an empty
  `req.json()` would raise. The logo route is the one `withAuth` holdout: it
  reads `FormData` itself and gates `org.settings.manage` before the storage
  write, then `organizationController.update` checks the same key again.
- **The two read families that stay membership-only, deliberately.** `GET organization/[id]`
  already proved `id === ctx.activeOrgId && ctx.orgRoleId`, and the role list /
  role detail are read by every member (the member screens and `withAuth`'s own
  role read). Dropping their persona adds **no** key — the active org
  membership is the authority. The `GET members` read does move off the persona:
  the service's old `accountType === EDUCATOR` narrowing (an educator saw only
  their classes' members) is deleted with it, because a capability must not be
  filtered by a persona. **Corrected 2026-11-20 (D25):** the read is not
  `org.member.manage` alone. A Teacher must not hold that key (D18/FP-04), yet
  the teacher-facing surfaces that call this endpoint (`/edu/classroom/members`,
  the assignment student picker, the `/edu` onboarding counts) legitimately need
  the roster — as do QA EDU-GRP-02 and EDU-ASG-04. The read therefore admits
  `org.member.manage` **or** `group.manage` **or** `group.invite` **or**
  `org.seat.manage` at any scope, and everyone else gets an empty list. The
  fourth key is the shipped **Billing** preset (`org.billing.manage` +
  `org.seat.manage`), whose `/manage/seats` assign dialog reads this roster: a
  preset is a consumer even though it is code, not a QA seed. See the
  difficulty-log correction below.
- **The RLS twin (R4).**
  `20261120110000_org_control_permission_rls.sql` replaces
  `rls_caller_is_org_manager` with 2a-2's `rls_caller_has_permission(org, key)`
  on: `organizations` update (settings), `org_members` update/delete (members,
  keeping `user_id <> auth.uid()` and the same-org role check),
  `org_seat_pools` insert/update/delete and `org_seat_assignments`
  insert/update/delete (seats), plus the manager branch of
  `org_seat_assignments`' SELECT — that policy is not in the handoff list, but
  the list route moved in this PR and a predicate that filters the rows after
  the gate turns a 403 into a silently empty list. `invitations` update/delete
  move (keeping `inviter_id = auth.uid()` and
  `rls_caller_can_assign_org_role`). The file ends with a `do` block that raises
  if any of the twelve policies lacks the expected key in a clause it has — a
  `qual` _or_ a `with check`, whichever exists — and if the `invitations` SELECT
  policy stops naming the legacy `rls_caller_is_org_manager` (the read half this
  slice leaves for 2b-4), so a reverted line fails a reset instead of passing a
  test.
- **What the file deliberately does not move.** The `invitations` INSERT keeps
  `rls_caller_can_assign_org_role`: it has no manager branch to move (the
  manager half lives inside that helper), its API gate is the untouched create
  route, and adding `org.invitation.manage` there would refuse the classroom
  teacher→member invite the POST route deliberately keeps. 2b-4 owns the helper
  rewrite; R4 says the two move together, so this half waits. _(Superseded:
  2b-4's block measured that the write cannot move without the invitation read,
  so 2b-5 owns both.)_ The `invitations`
  SELECT keeps its manager branch too: the list API moved, but an inviter may
  still read their own row through PostgREST — a recorded read asymmetry, not
  a leak.
- **What can now 403 that did not.** A `MANAGER`-persona holder of the seeded
  Member role loses the roster read/write, the seat reads/writes, the invitation
  list/retarget/revoke, the settings update and the logo; an `EDUCATOR`-persona
  Member loses the same. An org member can no longer read the admin seat views.
  Through PostgREST the same callers lose `organizations` update, `org_members`
  update/delete, the seat writes and the assignment manager read, and an
  invitation retarget/revoke.
- **What gains.** A Student-persona Admin-role holder (D13) reaches settings,
  seats and invitations on authority alone — pinned by the API file's
  invitation list. A custom role with `org.seat.manage` or
  `org.member.manage` reaches its API (previously MANAGER-only), and an
  `org.member.manage` holder who is an educator sees the whole roster.
  **Residual:** a custom role holding only `org.invitation.manage` can list and
  revoke but not retarget — the UPDATE's `can_assign_org_role` still reads the
  `member.manage` marker (2b-4).
- **Tests.** Unit: `organization.controller.test.ts` (new: settings gate,
  branding ordering, gate-before-validation), `organization-member`,
  `seat`, `invitation` and `org-role` controller suites (the holder/Member
  truth tables, no-org 403, body-less DELETE 403, writes gated and reads
  ungated), the two logo-route suites. Integration:
  `org-control-permission-api.test.ts` (26 cases: every family through the real
  route + `withAuth` with signed-in sessions, a Student-persona Admin, an
  educator-persona key holder, the roster's four read authorities plus its
  empty-list deny, a custom role with none of the four, a Billing-preset caller,
  a Member-role write refusal, the anonymous `?token=` branch with no session,
  no-active-org 403s, the body-less DELETE 403) and
  `org-control-permission-rls.test.ts` (24 cases,
  both directions through PostgREST against a legacy-marker control, the
  inviter/`can_assign` conjuncts, the assignment manager read, seat-pool and
  seat-assignment UPDATE, the self-DELETE refusal, a foreign org).
- **Gates (review pass, 2026-11-20).** `env:reset-db --yes` twice (a re-apply
  proves the file is `db push` safe), then again after the mutation proofs and
  before the final serial run; the two touched integration files serially
  (**50 passed**), `test:unit` (**4747 passed, 1 skipped**), `typecheck:all`,
  `typecheck:admin`, `lint:all`, `review:static`, `format:check`, `pr:size`
  (**977/400, XL** — tests and docs excluded; the sweep rewrites 12 route files,
  so it needs a `size:exception`). The slice's first pass ran the full suite
  (**104 files / 924 passed, 11 skipped**), `knip` and `dup:base` (**0 new**);
  the review pass re-ran only what it touched, and the coordinator runs the full
  suite again. Mutation proof (review pass, all by hand): the `org_seat_pools` UPDATE
  `with check` reverted to `rls_caller_is_org_manager` is killed twice — the new
  guard raises, and with the guard relaxed to its old `or` shape the new UPDATE
  case fails with `42501`; dropping the `ORG_SEAT_MANAGE` branch fails the unit
  and API Billing cases; wrapping the token branch in `authedRoute` turns the
  anonymous 404 into a 500; `alter policy … using (true)` on the invitations
  SELECT trips the new assertion. The original pass's table (six `bun run mutate`
  invariants, five hand proofs) stands in the PR body.

**Follow-ups this slice creates:**

- **2b-4** closes the invitation write asymmetry: move the manager half of
  `can_assign_org_role` onto the capability (or `group.invite`, per 2b-5), then
  the INSERT predicate can move too. It also owns the `org_members` SELECT
  policy: the API is now narrower than the data plane (a `group.read`-only
  member is answered `[]` by the API but may still read every same-org row
  through PostgREST), and narrowing the policy means auditing every
  `org_members` reader — D25 records the asymmetry (R23).
- 2b-6's route sweep reconciles the two deliberate shape variations
  (`roles/[id]/permissions` destructures the id, `seats/pools/[id]` hands the
  body first) that keep `dup:base` at zero until the layer changes once.

**2b-6 written on `feat/authority-2b-6` — slice 6 of 9 (content-route sweep + the
`authedRoute` adoption):**

- **The count, re-derived (R9/R10).** `git grep -l allowedAccountTypes origin/main --
'apps/web/src/app/(backend)/api/v1'` reports **33 files** at the base: `teacher/` 22
  (14 assignment files, 7 quiz files, `classrooms/route.ts`), `stats/` 5,
  `flashcards/stats/teacher` 2, `questions/[id]/ledger` 1, `organization/route.ts` 1,
  `ai/` 2. The sweep set is **29 files / 39 handlers**; the R5 exceptions
  (`organization/route.ts` POST, `teacher/classrooms/route.ts` POST) and `ai/*`
  (2b-9, phase 5) stay.
- **Route map** (family → key the controller enforces, first statement, before any
  schema parse):
  - `teacher/quizzes` — GET list `quiz.read`, POST create `quiz.create`;
    `quizzes/[id]` GET `quiz.read`, PUT `quiz.update`, DELETE `quiz.delete`;
    the children `bulk`, `questions`, `questions/[questionId]`, `questions/reorder`
    and `create-assignment` act on the parent's `quiz.update` (the service resolves
    it against the loaded row: foreign id 404, unreached same-org row 403);
    `create-assignment` also asks `assignment.create` (the minted run is that write,
    and the INSERT policy asks the same key).
  - `teacher/assignments` — GET list / `[id]` GET `assignment.read`, POST create
    `assignment.create`, PUT `assignment.update`, DELETE `assignment.delete`;
    results, targets, publish/unpublish, close, the `[action]` lifecycle
    (cancel/extend/override), the item questions/flags and export-answers follow
    the parent's read/update key **as the service already decides** (`ownedClient`
    resolves `assignment.update`/`assignment.delete` against the loaded row;
    `getById`/`list` use `assignment.read`); `results/[studentId]` PUT
    (gradeAnswer) is `assignment.update`, the key the service gates on.
  - `stats/teacher*` (5 routes) and `flashcards/stats/teacher*` (2) → `stats.read`,
    resolved from `ctx.permissionScopes` as 2a-5 ships it — not re-derived.
  - `questions/[id]/ledger` → `question_bank.update`, the staff key the service's
    `canReadQuestionKey` already enforces on the loaded row; the service now 404s a
    foreign-org item instead of 403 (§7.1).
- **The shape.** All 29 files use `authedRoute`/`authedRouteWithParams` with a
  declared `readsBody` and drop `allowedAccountTypes`. Three documented holdouts,
  like 2b-3's logo route: the export-answers CSV route (returns CSV, not the JSON
  envelope), the `[action]` lifecycle map (per-action dispatch + a body-less `cancel`
  whose empty stream must not become a 400), and the query-param DELETE in
  `assignments/[id]/questions` (keeps its exact `MISSING_QUESTION_ID` 422).
  `item-flag-route.ts` stays as the shared `authedRouteWithParams` factory for the
  two flag handlers. `dup:base`/`dup:changed`: **0 new clones** (the sweep started
  at 21 and each pair was closed by varying what the route hands the controller —
  destructured reads, body-first tuples, the params object, named vs inline `Params` —
  never comments or renamed locals).
- **Service changes.** `quiz-teacher.service` resolves the family key against the
  loaded quiz row (`own` → author, `organization` → the active org; `group` reaches
  no quiz because a quiz has no share link, so only the author) and the list
  follows the caller's `quiz.read` scope (organization → org-wide, otherwise own),
  exactly like the assignment list already did. `teacher-assignment.service` needed
  no change — `verifyOwnership`/`ownedClient` already resolve the key on the loaded
  row. `question.service#exposureLedger` 404s a foreign-org question.
- **The RLS twin (R4).** `20261120190000_content_route_permission_rls.sql` moves the
  `teacher_assignments` INSERT off the JWT persona conjunct (2b-4's recorded
  boundary, owned by this slice) onto
  `rls_caller_has_permission(organization_id, 'assignment.create')` —
  `created_by = auth.uid()` stays the own rule, so a holder at any scope mints its
  own run and a student-persona Admin works (D13). The org-wide
  `Visible teacher assignments` SELECT stays (phase 5 owns its readers).
  `control-plane-permission-rls.test.ts` now replays only the newest file that owns
  the object (R27): 2b-4's own closing guard pins the pre-2b-6 persona conjunct, so
  replaying it on a 2b-6 database raises by design.
- **What can now 403 that did not** (and what now passes): a caller holding the
  family key at any scope passes regardless of persona — a Student-persona Admin
  creates quizzes and assignments (D13, pinned through the real routes and the moved
  INSERT policy). A role without the key is 403 before any schema parse — a
  well-formed but schema-invalid body still answers 403, never 422; a syntactically
  malformed JSON body 400s at the route's own body parse (`authedRoute`'s
  `readsBody`), before the controller runs. A foreign-org id is 404 for a key
  holder; a same-org row the caller's scope does not reach is 403. A Member-role
  caller is refused every `assignment.*` route (the member template carries none)
  but may create own-scope content (`quiz.create` at `own`) and read `stats.read`
  at `own` — the rollout map's "own-scope content permissions" for SEC-05. The
  `override` lifecycle action is no longer manager-persona-only: any
  `assignment.update` holder over the run may move either bound.
- **Tests.** Unit truth tables per controller family (holder at each scope the key
  can carry is allowed, no-key 403 with the service never called, gate before schema
  parse, Student-persona holder allowed — D13) in the six controller suites plus the
  quiz service's resource-scope and list-scope cases. Integration:
  `content-route-permission-api.test.ts` (17 cases) drives the real routes through
  real `withAuth` with signed-in custom-role sessions: key-only holder
  creates/reads/edits, Member refused on `assignment.*`, Student-persona Admin
  creates a quiz and an assignment, foreign ids 404, same-org unreached rows 403.
  Existing persona-encoding tests updated without weakening what they prove:
  `stats.test.ts` (member gets own-scoped stats; a no-`stats.read` role is 403), the
  route-option suites (`stats-teacher-route`, `teacher-dashboard-routes`) now assert
  **no** `allowedAccountTypes` reaches `withAuth`, `assessment-lifecycle` (override
  refused for a member-role caller), `api-auth-inventory` (a gated factory may
  delegate to another gated factory, and the delegation chain must reach
  `withAuth`). Mutation proofs, all KILLED with
  `bun run mutate`: the create/read/delete gates in the quiz, assignment, stats,
  activity, flashcard-stats and question controllers, the quiz service's
  resource-scope check, and the quiz list scope filter. The route-layer persona
  gate itself cannot be mutated — it no longer exists; `api-auth-inventory` proves
  every handler is wrapped in `withAuth`, while the key gates are what the
  controller truth tables and `content-route-permission-api.test.ts` prove
  through the real routes.
- **Corpus (R16).** `SEC-05`, `AUT-19` and `AUT-16` depended on the removed persona
  gates and were reconciled with spec + case text together (R6): the Member student
  now gets 201 on own-scope quiz create, 403 on every `assignment.*` route, 200
  own-scoped on the stats/teacher family and an own-only quiz list. `SEC-09`
  accepts 403/404 and is unaffected (foreign reads answer 404). `AUT-17/18` (proxy
  redirects), `STU-01/03/07`, `EDU-02`, `MGR-01` do not touch the swept routes
  (phase 6/3 surfaces). EDU-*/STU-3x tenants are teacher/admin roles and keep
  working. The QA specs were reconciled by reading, not run (this slice's gates
  exclude Playwright).
- **Gates.** `env:ensure --profile api`, `env:reset-db --yes`, the touched
  integration files serially, then the full serial integration run (**109 files:
  1000 passed, 11 skipped** — re-measured on the review-pass HEAD, same as at
  `c5dd2103`), `test:unit` (**310 files, 4816 passed, 1 skipped** — re-measured
  2026-11-20 on the review-pass HEAD; 4812 at `c5dd2103` before the review pass
  added four `api-auth-inventory` reachability cases),
  `typecheck:all`, `typecheck:admin`, `lint:all`, `review:static`, `knip`,
  `dup:base` (**0 new**), `format:check`, `pr:size`. No build/serve/Playwright/QA.
- **`bun run pr:size` at the end: 1402 reviewable lines (XL)** — 1388 at `c5dd2103`,
  re-measured on the review-pass HEAD. The 29-file sweep
  plus controllers, tests and docs. The coordinator decided **one PR with
  `size:exception`** — R4 binds the `teacher_assignments` INSERT migration to the
  teacher routes, so the split below is not available. The branch is committed as
  focused commits (sweep, then migration+tests, then corpus/docs) so a later split
  would still be a rebase, not a rewrite.

**Follow-ups this slice creates:**

- **2026-11-20 review pass:** the 403-vs-404 split between the two content families is
  pre-existing and cosmetic, recorded here, not changed: a foreign-org id answers **404**
  on the quiz paths (`ownedQuiz` maps it to `NOT_FOUND`) but **403** on the assignment
  read (`getById`), and a same-org row the caller's scope does not reach answers **403**
  on the quiz writes (`ownedQuiz`'s scope evaluate) but **404** on the assignment
  writes (`ownedClient` collapses foreign and unreached into `NOT_FOUND`). §7.1's
  tenant-non-leak rule is the reason the quiz side is preferred; the assignment side
  predates 2b-6 and no caller distinguishes the two today.
- **2026-11-20 review pass (tried and reverted):** adding the quiz service's
  `!ctx.activeOrgId` guard to `teacher-assignment.service#create` was reverted.
  `teacher_assignments.organization_id` is nullable (unlike `quizzes`), so a null org
  cannot raise 23502, and a real no-org session is refused at the table with 42501 —
  which `PG_ERROR_MAP` already maps to 403 (`supabase-errors.test.ts` pins the mapping) —
  while the service-layer guard broke the integration suites that seed personal
  (null-org) assignments with RLS bypassed (`no-active-org-guards`, `item-states`).
  No-org assignment create therefore answers 403 through the RLS denial, not a guard.

**Difficulty log**

#### 2026-11-20 — the invitation write that the permission cannot finish

What: moving the `invitations` UPDATE predicate onto
`rls_caller_has_permission(org, 'org.invitation.manage')` exposed a second
authority in the same policy: `rls_caller_can_assign_org_role(target_org_role_id)`,
whose manager half is still `is_org_manager` (the `member.manage` feature
marker). A custom role holding only `org.invitation.manage` lists and revokes,
but a retarget is refused at the table with 42501 while the API allows it, so
the working retarget caller is the Admin role. The integration case says so
explicitly and uses a non-inviter holder, so the permission branch is the only
one that can pass.
Why: 2b-4 is where class invites become `group.invite` and the teacher-name
exception dies; moving `can_assign_org_role` here would change the untouched
create route and the accept flow, and adding the permission to the INSERT
predicate would refuse the classroom teacher→member invite the POST route
keeps. R4 says the API and the predicate move together, so the half with no API
move stays.
Fix: UPDATE/DELETE manager branches move, INSERT keeps the helper, and the
asymmetry is named in the migration header, the delivered block and the PR.
Rule: when a policy carries two authorities, moving one is a split, not a
sweep — name the conjunct that still owns the other half, or the next reader
will call the 42501 a bug.

#### 2026-11-20 — the read predicate is part of the read gate

What: wiring the seat-assignment list route to `org.seat.manage` while leaving
the table's SELECT policy on `is_org_manager` would have answered 200 with an
empty list for a role that holds the key but not the legacy marker: the
controller admits the caller and RLS filters every row. The handoff listed only
the seat-assignment writes, and the read policy is the one that makes the list
work.
Why: a write refused by RLS raises 42501; a read refused by USING returns no
rows and no error. The divergence is silent in the direction that matters here,
which is why R4 has to cover the SELECT's manager branch whenever a read route
changes hands.
Fix: the SELECT's manager branch moved in this migration (the
`user_id = auth.uid()` self branch stays) and one RLS case pins the holder
reading a row it does not own plus the legacy control reading nothing.
Rule: a route gate and its SELECT policy move together; a filter that runs
after the gate turns a refusal into an empty page, not an error.

#### 2026-11-19 — a group-scope row could create a class, and the RLS helper said so

What: wiring `groups` INSERT to 2a-2's `rls_caller_has_permission(org,
'group.manage')` let an `own`-only and a `group`-only role create classes
through PostgREST. The helper answers "the role holds this key", not "at the
scope a new class needs", and a new class has no id to be a teacher of.
Why: 2a-2 wrote the helper for role writes, where any scope of
`org.role.manage` is the same capability; `group.manage` is the first key whose
_scope_ is part of its meaning, so the same predicate means something narrower
in one direction and wider in the other.
Fix: the INSERT policy names `rp.scope = 'organization'` itself, the API checks
`canCreateAtOrgScope`, and the integration files pin both directions: the API
file asserts an Admin-role create is `.not.toBe(403)` — never a permission
refusal, and not pinning the success status, because the plan limit runs after
the gate and the fixture org may already be at `max_groups` — and the
`group`-scope holder gets 403 after asserting the org is under the limit; the
RLS file asserts the Admin-role insert returns exactly its one row and the
`group`-scope insert returns an error, no data, and leaves no stored row.
Rule: a shared capability helper answers "holds the key"; a check that needs the
_scope_ a resource requires must read the scope, not reuse the helper and hope.

#### 2026-11-19 — the group rule had to stop calling `can()`

What: the first version delegated to `can(ctx, 'group.manage', { id, … })`,
whose `group` branch looks the resource up in `deck_groups`/`bank_groups`/
`topic_groups` — a share **link**, not a class. A teacher of a class with no
deck shared to it got FORBIDDEN even though the context said `teacher`.
Why: `can()` was written for content resources, and `group.*` keys were never
one of them; the two share a scope name and nothing else.
Fix: `canGroup` applies `resolveGroupScope` (set lookups only) plus the creator
branch, and never calls `can()`. The integration suite is what caught it — the
unit stub could not.
Rule: a permission family whose resources are not the content graph gets its own
evaluator; reusing the content one because the scope word matches is how a
correct context answers wrong.

#### 2026-11-19 — landing order versus the rename

What: this slice's helper reads `org_role_permissions`, and 2b-1, which merged
after the slice was written, renames `permission_name` → `permission_key`. The
first reset after the merge left the function unexecutable: the test that
re-installs the shipped SQL replayed my pre-rename body, and the column was gone.
Why: two slices touched one column from opposite ends, and a migration's order
is its file name.
Fix: the migration moved to `20261119212000` (after 2b-1) and reads
`permission_key`; the merge kept their file. `dup:base` aside, nothing else in
this slice reads the column.
Rule: when a slice lands behind another that renames what it reads, renumber
after it — the file name is the order, and a passing reset before the merge
proves nothing about the tree after it.

#### 2026-11-19 — `group.read` at `own` is a row question, and `dup:base` counts lines

What: the controller asked `requirePermission(ctx, 'group.read')`, which refuses
the `own` scope outright. §4.3 gives `own` the classes the caller **created**, so
a role holding `group.read` only at `own` got a 403 on a list it is entitled to,
and the service (which documents `own` as "no listing") agreed. Separately, with
the persona gate gone the four group route files became line-for-line copies of
the flashcard/teacher routes, and `dup:base` counted 13 new clones against
`origin/main`.
Why: `requirePermission` answers a context-only question; `own` needs a row, and
a list has many. And jscpd compares normalised lines: two files that read the
same are a clone whatever the reason, so "the route layer is boilerplate" is not
an argument the gate accepts.
Fix: `listGroups` resolves the scope itself (`group`/`organization` read the org,
`own` filters `created_by = caller`, anything else answers 403) and the
controller defers to it; the integration file drives an `own`-only role through
the real `withAuth` and gets 200 with only its own class. The route files answer
the sessions and bodies the old `allowedAccountTypes` shape did, with the shapes
that make them distinct from the routes they used to copy (the roster `PUT` reads
request and params under a different name, the `[id]` routes branch on `[id]`
before the session) — 0 new clones against `origin/main`, nothing suppressed.
Rule: a list whose scope includes `own` cannot be gated in the controller; and a
duplication gate is a comparison, not a judgement — "it is boilerplate" never
clears a clone.

#### 2026-11-19 — EDU-GRP-05's educator holds `group.read`, so the menu stays (closed below)

What: the case's prose said the `content` profile's educator is an org `member`
and therefore lacks `group.read`. It is not: `scripts/seed/qa.ts` gives the
profile's `teacher` account no `orgRole`, so `seedTenantGraph` puts it on the org
**`teacher`** system role, and `SYSTEM_ROLE_TEMPLATES.teacher` carries every
group key — `group.manage`, `group.member.manage`, `group.invite` and
`group.read` — at `group` scope.
Why: the prose was written against the `group.manage` **feature marker**, where
the question was whether the account holds an entitlement, and the check is now
the `group.read` **permission**; the two questions have different answers for
this account, and only the seed says which.
Fix: the case text names the role it really seeds (`org teacher`, keys at `group`
scope) and what therefore still holds (the read-only list, the four 403s on the
write endpoints); the assertion was not adjusted to make it pass. The
consequence is recorded as a follow-up: the case's first expected result ("the
entry disappears from the menu") is false for this tenant, and only an org
`member` educator — which the `content` profile does not seed — would satisfy it.
Rule: check the **seed**, not the case prose, before asserting which permission a
QA tenant's account holds; a feature-shaped prerequisite does not survive a
permission-shaped gate.

#### 2026-11-19 — 2b-2 review pass: the org conjunct, the roster key, and a gate that counts lines

What: ten findings from the review of 2b-2, and what each one settled.

- **The group rule is §4.3, scope by scope.** `organization` reaches every class
  of the active org; `group` reaches the classes whose `group_members.role` is
  `teacher`; `own` reaches classes the caller created (§4.3, §4.2). The seeded
  rows make the intended split: Admin holds `group.*` at `organization`;
  Teacher holds it at `group` (`packages/authz/src/lib/org-roles.ts`), so a
  Teacher reaches only the classes they teach** and no other class of the org.
- **What can now 403.** A `group.*` write on a class the caller neither teaches
  nor created (the roster too, for `group.member.manage`); `POST` for a role
  holding `group.manage` below `organization` scope; and the list itself for a
  role with no `group.read` at any scope — a blank custom role that used to be
  shown every class now gets 403, while a role holding it at `own` gets 200 with
  only the classes it created (2b-2's list change; see the entry below).
- **404 vs 403 (§7.1).** `PUT`/`DELETE`/roster/`addable-members` resolve the
  group inside the active org **before** the permission: an id from another org,
  or not a uuid, answers 404/400; a class of this org that the caller cannot
  manage answers 403, because tenant _existence_ is already known. The list is
  the exception — it has no id to look up, so it answers 403 for a caller with
  no authority at all.
- **The `getGroupMembers` read path is accepted as is.** `GET /groups/:id/members`
  resolves the class inside the active org and then reads the roster; it does
  not require `group.member.manage`. 2b-2 keeps that on purpose: the dialog's
  _save_ (`PUT`) checks the key, the read is what a class roster already is for
  a member (`§4.3`: a `member` holds read access at `group` scope). Tightening it
  is a separate decision, not a silent change in this slice.
- **The UI gate is the key each endpoint checks.** The list payload carries
  `manageVia` (`'group.manage'` | `'group.member.manage'` | `null`), computed
  with the same `resolveGroupScope` calls the endpoints make, so the roster
  button appears for a roster-only manager and the rename/delete pair only for
  `group.manage`. A form of this gate keyed on `group.manage` alone was wrong:
  the roster endpoints check `group.member.manage`, and an integration case now
  proves a `group.member.manage`-only holder can open and save the roster.
- **The RLS helper refuses a non-`group.*` argument.** A teacher of the class
  satisfies the helper's teacher branch for _any_ key, so
  `rls_caller_has_group_permission(<taught>, 'deck.update')` answered `true`.
  The function now also requires `p_permission like 'group.%'` **and** a
  `permissions` row with `category = 'group'`; one integration case pins both
  answers for the same caller and class.
- **The org conjunct is pinned on the unit side and is proven by construction,
  not by an assertion, on the RLS side.** The unit case for "a teacher of a group
  outside the active org" now passes `{ 'g-foreign': 'teacher' }` with no
  `activeOrgId` and asserts `false` (`bun run mutate` on the org conjunct →
  KILLED). The RLS helper's own `org_members` join **cannot be isolated from a
  user session**: the helper is SECURITY DEFINER, so it reads `org_members` as
  the owner, while the caller's session reads the same table through
  `Own or same-org membership read` + `rls_caller_org_ids()`. No fixture can
  therefore put a `teacher` row in front of the helper's join with a role that
  grants nothing and have the helper — rather than the tenant floor — be what
  refuses it: re-read the earlier attempt below, which measured exactly that.
  The conjunct is proven by the helper's text (`om.user_id = auth.uid()` inside
  the `exists`) and the roster cases that ARE observable from a session are the
  ones the suite keeps: a foreign-org teacher, a teacher membership with no
  `org_members` row, a member (read-only), and the Admin-role holder who writes
  any class.
- **The controller keeps no `group.manage` check on `PUT`.** The unit case drives
  a teacher of the row (key at `group` scope) and a service that refuses it:
  adding a controller-level check — the `canCreateAtOrgScope` call a later author
  reaches for — throws `AppError` from the controller and the case goes red
  (added once, seen red, removed).
- **The review pass reversed the request-read refactor, and says so.** The first
  version of this pass moved the body parse into the controller (`jsonBodyOf`,
  "no body" → the schema's 422, "not JSON" → `BAD_REQUEST`) and had the route
  hand over the unread request. The final shape is the neighbours' instead: each
  route reads its own `params` and body next to the request, as `roles/[id]`,
  `invites/[id]` and `seats/pools/[id]` do, and the controller keeps only the
  `listGroups` change. A malformed body is then the route's `SyntaxError`, which
  `withAuth`'s error handling answers — the `group-permission-api` file drives
  the parsed input the route hands over, not a request object.
- **EDU-GRP-05's first expected result does not hold — verified against the
  seed, and the case is reconciled in the same PR (rule R6).** The `content` QA
  profile's educator is on the org **teacher** role (`scripts/seed/qa.ts` gives
  it no org role, so `seedTenantGraph` picks the teacher system role), and
  `SYSTEM_ROLE_TEMPLATES.teacher` carries `group.read` at `group` scope — so the
  „Grupy” menu item is **shown** for that tenant. The case text
  (`qa/cases/EDU-GRP-05.md`) and its spec
  (`__tests__/qa/EDU/EDU-GRP-05.spec.ts`) now assert what the permission model
  guarantees for a user with no `group.manage` at any scope: the list is
  readable (`group.read`), every manage control is absent (create is org scope;
  the row the educator does not teach shows the lock and answers `manageVia:
null`), and the four writes still answer 403 FORBIDDEN. Only a tenant whose
  educator holds `group.read` at no scope would hide the entry, and `content`
  does not seed one; that sentence moved from "the text needs reconciling" to
  the case's own text rather than being deleted.
  A failed attempt worth recording: making the _org_ conjunct observable on the
  RLS side did not work. `rls_caller_has_group_permission` reads `org_members` as
  its owner, while the caller's session reads the same table through
  `Own or same-org membership read` + `rls_caller_org_ids()`, so no fixture can put
  a `teacher` row in front of the helper's join with a role that grants nothing
  and have the helper — not the tenant floor — be what refuses it; the case
  measured that and was cut rather than left as a label that oversells it (the
  ledger says so in the bullet above, and so does the case's comment).
  Why: each finding was a place where the test or the gate described something
  other than what the code does — an assertion that could not fail, a label that
  named a conjunct it did not pin, a UI gate keyed on the wrong permission.
  Fix: the changes above, each with a case that was made to fail before it passed
  (`bun run mutate` where the tool drives the file; a hand-break and red run
  where it does not, because the integration suite needs the stack), plus the
  route shape in the next entry.
  Rule: a test proves the feature, not the fixture — if a caller can pass it with
  an empty context, the fixture changed the wrong thing; and a UI gate must be the
  key the endpoint behind it checks, or the dialog it opens answers 403.

#### 2026-11-19 — `dup:base` on the group routes: 20 new clones, then 9/14, then 0

_History, kept: the numbers in this paragraph are what the slice measured before
the review pass. The final number is in the last paragraph._

What: measured with `dup:base`'s own `jscpd` build against `origin/main`, the
first draft of this slice — the routes parsing their own bodies and
destructuring `params` themselves — reported **20 new clones**; the shape that
lands here first reported **9** against a token baseline and **14** from the
shipped `dup:base` (which fingerprints more structure than tokens). On both,
every remaining pair was the imports and signature at the top of a group route
against a pre-existing route of the same shape.
Why: jscpd's window (50 tokens / 5 lines) reaches through the `withAuth` call, so
a handler whose body is the shared shape pairs with the pre-existing,
equally short routes (`invites/[id]`, `seats/pools/[id]`,
`assignments/[id]/questions/reorder`, `quizzes/[id]/bulk`,
`roles/[id]/permissions`). A cosmetic tweak re-fingerprints the **pre-existing**
pairs too (`invites`↔`seats`, `invites`↔`reorder`, `roles`↔`assignments`), so a
variant can raise the total while lowering the count for our file. Nothing is
suppressed: `.jscpd.json` is untouched, and the gate reports what it finds.

Fix (review pass) — **the neighbours' shape returns; the gate is still red at 16.**
The review asked for the four files to keep the house style (each handler unwraps
its own `params`, reads its own body, then calls `withAuth(req, handler)`), and
for `dup:base` to reach 0. Both were done in that order, and they conflict:
reverting the controller-owns-params-and-body shape (the controller keeps only
the `listGroups` fix — no `requirePermission`, because `group.read` at `own`
needs a row) measures **`Found 304 clones (16 new)`** in this tree, up from the
14 the slice shipped. The four files are then the neighbours' shape and pair
with the neighbours: the imports-and-signature window of a one-handler route
(50 tokens / 5 lines) reaches through `withAuth(req, async (ctx) => …)`, so
`groups/[id]`, `groups/[id]/members` and `groups/route` each clone
`invites/[id]`, `seats/pools/[id]`, `roles/[id]`, `roles/[id]/permissions`,
`teacher/assignments/[id]/questions/reorder`, `quizzes/[id]/bulk` and
`me/groups/route`. Measured on this tree, the variants tried and rejected:
restoring the slice's controller-owned shape → 14 (every group handler shares its
whole body with a neighbour); `export const GET = handler` factory modules → 8;
a shared `jsonBodyOf` in `packages/server/src/lib/authz.ts` → 16, and it is the
cross-package helper the slice-6 sweep owns, not this one; distinct top blocks
for `addable-members`/`members` → 9–10, with new clones **inside** the four group
files. Nothing is suppressed — `.jscpd.json` is untouched and the gate reports
what it finds.
Rule: a duplication gate compares normalised lines, so in a codebase whose
convention is three identical import lines over a handler, the clone is the
convention — and a shape a fourth file shares is still a clone when it comes
back; what an undo removes is the copy inside this slice, not the pair with the
neighbour. Until slice 6 changes the route layer once, everywhere, 2b-2 reports
its number.

Rule: a duplication gate compares normalised lines, so the clone is the shape,
not the reason — and when every variant whose handlers share a body scores above
zero, close it with the one thing a route can vary for real (what it hands the
controller), never with comments, renamed locals or a dropped `async`.

#### 2026-11-19 — 2b-2-2: the nav link a `group.read` holder lost, and the case that hid it

What: the follow-up pass on 2b-2, and what it settled.

- **The „Grupy” link was missing for every `group.read` holder, Teachers first.**
  `AppSidebar` gated the entry on `usePermission()('group.read')` with no
  resource, and `evaluateScope` reaches a `group`-scope row only through the row
  it is evaluated against (`ctx.groupRoles`: _is the caller a `teacher` of **this**
  class). A nav entry has no row, so `orgId: null` and `createdBy: ''` answered
  `false` for the org `teacher` role — the role the whole `group.read` /
  `group.manage` split exists for — and for a Student's `group.read` too. The
  page stayed reachable by URL (EDU-GRP-05's walk proved that) and unreachable by
  clicking, which is why the case's old text ("the entry disappears") passed on a
  bug: it asserted the absence the bug produced.
  Fix: `apps/web/src/lib/sidebar-nav.ts` holds the gate as a pure function —
  `visibleNavItems()` asks whether `/permissions/me` **carries the key**,
  `permissionScope()` in `apps/web/src/hooks/use-permission.ts` is the lookup, and
  `usePermission()` is unchanged for resource checks (it now also answers the
  unscoped question instead of `false`, so no caller has to re-derive it). The
  link follows the key the API enforces, at any scope; a map without
  `group.read` — a role that lacks it, or one still resolving — renders no entry,
  which is the half that must not regress the other way.
- **EDU-GRP-05 now asserts the model's guarantee (R6: text and spec together).**
  With the nav fixed, `qa/cases/EDU-GRP-05.md` and
  `__tests__/qa/EDU/EDU-GRP-05.spec.ts` state the same four points: „Grupy” is
  visible for a `group.read` holder (before and after a reload, and the spec
  enters the page through the link), the list renders with its columns and the
  seeded group, **every** manage control is absent (create, edit, delete,
  members, plus the lock badge), and the four writes answer `403 FORBIDDEN`. The
  spec adds the negative half in the tenant it already owns: the manager saves the
  org `member` role down to its content keys through
  `PUT /organization/roles/:id/permissions` (the whole catalog, D24), the
  educator then has no entry, no link and `403` on the list, and the seeded set is
  restored in a `finally` before the manager contrast phase.
- **The group-scope rule 2b-2 landed, restated once.** §4.2 gives the seeded
  roles their scopes: Admin holds `group.*` at `organization`, Teacher at `group`,
  Member only `group.read` (also at `group`), all from
  `SYSTEM_ROLE_TEMPLATES`. §4.3 gives each scope its reach: `organization` → every
  class of the active org, `group` → the classes the caller's `group_members.role`
  is `teacher` on, `own` → the classes the caller created. **Teacher reaches only
  the classes they teach** — confirmed by the QA tenant, not just the unit
  fixtures.
- **What can now 403.** A `group.*` write on a class the caller neither teaches
  nor created (roster writes included, at `group.member.manage`); `POST /groups`
  for any role holding `group.manage` below `organization` (a new class has no id
  to be a teacher of); the class list for a role with no `group.read` at any scope
  (`403`), and a `403` on the four writes for the `member`-shaped educator that
  EDU-GRP-05 runs.
- **404 before 403 (§7.1).** `PUT`/`DELETE`/roster/`addable-members` resolve the
  class inside the active org first: an id from another org (or not a uuid) is
  `404`/`400`, because the caller must not learn whether another tenant has it; a
  class of **this** org that the caller cannot manage is `403`, because its
  existence in the caller's own tenant is not a secret. The list has no id, so it
  answers `403` alone.

**Duplication, narrowed by the route helper.** The four group route files no
longer carry the neighbours' shape inline: `authedRoute` /
`authedRouteWithParams` in `packages/server/src/lib/route-handler.ts` are that
shape once — `withAuth`, the path params, a declared JSON body, the controller
call, and `toNextResponse` as the only response shaper — and each handler is its
`read`/`call` pair. Against `origin/main` the four files stopped pairing with the
pre-existing routes: `dup:base` went from **16 new to 9 new**, measured on this
tree with the shipped gate, unsuppressed (`.jscpd.json` untouched). Of the 9, one
is **inside** this slice (the identical import header and single-handler
signature of `groups/[id]/members` and `groups/[id]/addable-members` — two routes
that genuinely read the same), and the other 8 pair **only** files this branch
does not touch (`flashcards/[id]`, `organization/[id]`, `invites/[id]`,
`roles/[id]`, `roles/[id]/permissions`, `seats/pools/[id]`,
`teacher/quizzes/[id]/bulk`, `teacher/assignments/[id]/questions/reorder` and the
`roles`/`teacher/assignments` collections), which are byte-identical to `main`
here — converting the group routes could not have reached them, and they appear
because `invites/[id]`'s own offset moved in the fingerprint. **Slice 6 adopts
`authedRoute` across the rest of the route layer**, which is where those pairs
go; this slice does not convert other files to chase the number. The shapes
tried before the helper, for the record: 20 (first draft) → 9/14
(controller-owned shape) → 16 (neighbours' shape).

> **Superseded in 2b-2-3.** The entries below describe the org-scope create gate;
> the operator decision recorded there (a Teacher may create a class) replaced
> it, and both cases pass. Kept for the history of why the gate moved.

- **EDU-GRP-01 and EDU-GRP-03 stay red on their fixture, not on the product.**
  Both are `org-limit` tenants whose educator is seeded on the org `teacher` role,
  so the keys resolve at `group` scope, and each spec's own create call is the
  first thing that needs org scope. Measured once each on this tree:
  EDU-GRP-01 fails at `__tests__/qa/EDU/EDU-GRP-01.spec.ts:115` — `expect(
permissions).toHaveProperty('group.manage')` (the map carries it, at `group`),
  the spec's prerequisite probe, before any step; EDU-GRP-03 fails at
  `spec.ts:174` — `POST /api/v1/organization/groups` → `403 FORBIDDEN`,
  `x-error-code: FORBIDDEN`, from `createGroup()` at `spec.ts:101`, which the
  spec uses to build T2's prerequisite class. Since 2b-2 the product answers
  exactly what the model says: `POST` needs `group.manage` at `organization`, and
  an org `teacher` does not hold it there. The seeder gap is real and belongs to
  **slice 3** (org-control tenant setup): an org whose `admin` creates the classes
  both educators work on, so the specs' prerequisites exist without asking a
  Teacher to create one. The cases' assertions are left as they are — rewriting
  them to accept `403` would make the specs agree with a fixture instead of the
  product.
  The verbs themselves are covered by `__tests__/integration/group-permission-api.test.ts`
  (org-scope create, group-scope teacher write, foreign-org `404`, roster key),
  so the red pair is a fixture gap, not an untested path.
- **Gates:** `env:reset-db --yes`, the serial integration run, `typecheck:all`,
  `typecheck:admin`, `lint:all`, `test:unit`, `review:static`, `knip`,
  `format:check`, `pr:size` are green; `dup:base` reports **9 new clones**, one
  inside this slice and eight between files this branch does not touch (recorded
  above).
  A nav-gate mutation (`visibleNavItems` ignoring `permission`) turns
  `sidebar-nav.test.ts` red (`bun run mutate` → KILLED); the QA pair is run 5/5
  for EDU-GRP-05 and once each for EDU-GRP-01/03.

Rule: a nav gate asks whether the caller **holds** the key, because a scoped
evaluation needs the row a menu entry does not have — and a case written from a
feature marker's behaviour (the entry disappears) has to be re-derived from the
permission model when the gate moves, or it will keep passing on the bug it was
meant to catch.

#### 2026-11-20 — 2b-2-3: a Teacher creates a class, and the roster that made it manageable

What: the second follow-up pass on 2b-2. The operator decided that **a Teacher
may create a class**, which turns the create gate and its RLS twin from
`organization`-only into any-scope.

- **The decision, and the lines it rests on.** `group.manage` at **any** scope
  (`own | group | organization`) authorizes `POST /organization/groups` inside
  the active org; no active org still refuses. A new class has no id to be a
  teacher of — the reason the earlier gate asked for `organization` alone — but
  §4.3's scope rows say where an existing class is reachable, not who may start
  one, and **§10** makes the class the teaching surface ("a teacher runs their
  class without any org-wide management capability"). Starting the class is the
  first thing a teacher does, and the creator becomes its teacher, so `group`/
  `own` is the honest scope for the row being created. Admin keeps working
  through `organization`; the seeded role matrix is **unchanged** (Teacher still
  holds `group.*` at `group`). The helper was renamed `canCreateAtOrgScope` →
  `canCreateGroup` because the old name now lies: it is no longer an org-scope
  test. Both call sites (controller and the service's direct-entry repeat) use it.
- **The RLS twin (R4, same PR).** `20261119212000_group_permission_rls.sql`'s
  `groups` INSERT policy now accepts `rp.scope in ('own', 'group', 'organization')`
  instead of `= 'organization'`, keeping the key (`rp.permission_key =
'group.manage'`), the active-org join (`om.organization_id = groups.organization_id`)
  and the `rls_caller_org_ids()` tenant floor. Grant state is final (R19): PUBLIC/
  anon revoked, `authenticated` + `service_role` execute, unchanged by this pass.
  Proven through real signed-in sessions: a `group`-scope Teacher and an
  `own`-scope role both create and the row carries `created_by`; a roster-only
  role (`group.read` + `group.member.manage`, no `group.manage`) still gets
  `42501`. Hand-proved by mutation (the integration suite cannot use
  `bun run mutate`): flipping the predicate back to `rp.scope = 'organization'`
  reddens both teacher-create cases (2 failed), and widening the key conjunct to
  `permission_key is not null` reddens the roster-only refusal (1 failed); both
  restored, 17/17 green.
- **A class nobody could manage — found by running the QA case, fixed here.**
  With the gate open, `createGroup` still wrote only the `groups` row: the
  creator never joined its roster, so `resolveGroupScope(..., 'group')` found no
  `teacher` row, `manageVia` came back `null`, and **the author could not edit
  or delete the class it had just made** — the UI showed the "not yours" lock and
  `DELETE` answered `403`. No endpoint could repair it either: the roster's
  INSERT policy asks `group.member.manage` _for that class_, which the creator
  does not have until the row exists. Measured, not assumed (probe: roster `[]`
  for the fresh class). `createGroup` now enrols the creator as its `teacher`
  through the same service-role client org provisioning uses for the default
  group, and removes the class it just made if that enrolment fails, so a failed
  create never leaves an unmanageable row. A unit case pins the insert and the
  rollback (mutation `role: 'teacher'` → `'member'` → KILLED); the integration
  case pins the roster row, `manageVia === 'group.manage'`, and a `200` delete.
- **What that changes for the case text (R6).** A fresh class is now
  **1 member / 1 teacher** — the author — because `memberCount` counts the whole
  roster, teachers included. `qa/cases/EDU-GRP-01.md` and its spec say so
  together; asserting "0 members" would have been the pre-fix shape.
- **The `toHaveProperty` dotted-path trap — and the stale field beside it.**
  Playwright's `toHaveProperty('group.manage')` splits on `.`, so it traverses
  `scopes.group.manage` on a **flat** map: the positive form always fails and the
  **negative** form always passes, whatever the map holds. `ae6a77bb` fixed the
  positive half in EDU-GRP-01. The two negatives in EDU-GRP-05 (`the educator
holds no group.manage`, `the saved role carries no group.read`) were still
  vacuous and now read `Object.keys(scopes)` — proved live by flipping one to the
  positive form (`toContain('group.manage')`), which goes red in the educator
  phase: the map really does lack the key, so both directions are now
  observable. A grep of the corpus for every `toHaveProperty` shows **no other
  `/permissions/me` assertion**: `MGR-ROL-01/02/04` read
  `permissions.permissions['org.role.manage']` by key already, and the two in
  `SEC-05` are `data.totalQuizzes`-style payload fields, not permission maps.
  The same audit found the sibling rot in the same files: a `canManage: boolean`
  field typed and asserted across **eight** specs (`EDU-GRP-01/02/03/04`,
  `MGR-GRP-01/02`, `LIM-04`, `STU-34`) that the API has not returned since it
  became `manageVia` — `expect(undefined).toBe(true)` in three of them, and a
  cleanup path in EDU-GRP-01/04 gated on it. All eight now type
  `manageVia` and assert it (`not.toBeNull()` / `toBeNull()`), which is what the
  page itself gates on.
- **QA, re-run against this build** (`--run 2b2c`, fresh tenant per case):
  **EDU-GRP-01 passes**, **EDU-GRP-03 passes**, **EDU-GRP-05 passes**. The pair
  that was red at `ae6a77bb` on a fixture, not the product, is green because the
  product now admits what the case describes; the fixture gap recorded in the
  2b-2-2 entry (seeder, slice 3) no longer hides a case.

**Duplication, after the route helper.** The helper landed in this slice rather
than slice 6 (operator decision): `authedRoute` / `authedRouteWithParams` in
`packages/server/src/lib/route-handler.ts` are the route layer's repeated shape
once — `withAuth`, the path params, a declared JSON body (`readsBody`, not a
guess from the method), the controller call, and `toNextResponse` as the only
response shaper — and the four group route files are now its `read`/`call`
pairs. `dup:base` reports **9 new clones**, down from 16: one inside this slice
(the shared import header of `groups/[id]/members` and
`groups/[id]/addable-members`) and 8 between files this branch does not touch
(`flashcards/[id]`, `organization/[id]`, `invites/[id]`, `roles/[id]`,
`roles/[id]/permissions`, `seats/pools/[id]`, `teacher/quizzes/[id]/bulk`,
`teacher/assignments/[id]/questions/reorder`, and the `roles` /
`teacher/assignments` collections), byte-identical to `main`. **Slice 6 adopts
`authedRoute` across the rest of the route layer**, which is where those
pairs go; this slice does not convert other files to chase the number.
`.jscpd.json` and `knip.ts` are untouched; the PR keeps its `size:exception`.

Rule: a `toHaveProperty` path is split on `.`, so **a dotted key makes both the
positive assertion fail and the negative assertion pass** — assert
`Object.keys(map)` or index the map, and grep the corpus for the pattern whenever
the payload's shape changes.

#### 2026-11-20 — 2b-2-4: the roster write a creator could not make, and the counts that moved with it

What: the CI failures on `1f01fa08` (PR #1398) and what they turned out to be.

- **`PUT /organization/groups/:id/members` answered `403` in six tenants**
  (`EDU-GRP-02`, `EDU-Q-01`, `STU-14`), on a roster the caller was entitled to
  replace. Measured, not assumed: a probe on this checkout's stack created a
  class as the Teacher, read the roster back (`[{ role: 'teacher' }]`), and got
  `403` on the immediately following `PUT`. The role was never the problem —
  the seeded Teacher row carries `group.manage` / `group.member.manage` at
  `group` scope and `/permissions/me` returns them. Two defects, both in the
  rule as written:
  1. **`setGroupMembers` replaces the roster wholesale** (delete every row, then
     insert the body). The caller's own `teacher` row is the _only_ thing that
     satisfies the `group` scope's teacher half, so deleting it first meant the
     write could never restore it — and PostgreSQL evaluates the INSERT
     `WITH CHECK` after the DELETE, so RLS refused the very insert that would
     have put the row back. Confirmed directly: as `authenticated` with that
     user's claims, `delete` then `insert` on an empty roster raises
     `new row violates row-level security policy for table "group_members"`,
     while `rls_caller_has_group_permission(<that group>, 'group.member.manage')`
     answers `true` before the delete and `false` after it.
  2. **The creator branch never reached the service.** §4.3 gives `group`
     manage to "a `teacher`/owner of the group" and §6.3 spells the same rule
     out — "the caller is a `teacher` of the group (**or `created_by` for
     groups**)" — but `resolveGroupScope`'s `group` branch tested
     `groupRoles[groupId] === 'teacher'` only, and `groupInActiveOrg` selected
     `id, organization_id` without `created_by`, so the `own` branch could not
     fire either. A creator who was not _currently_ on the roster therefore had
     no path to authority over their own class.
- **The fix, rule and RLS twin together (R4).** `resolveGroupScope`'s `group`
  branch now accepts the creator (`group?.created_by === ctx.userId`) next to
  the roster teacher; `groupInActiveOrg` selects `created_by`; and
  `rls_caller_has_group_permission` gains the same branch, guarded by
  `permissions.allowed_scopes @> '{own}'` so it stays scope-for-scope with
  `resolveGroupScope` (which is why `group.invite`, whose catalog row has no
  `own`, gains nothing). Proved both directions in Postgres as the real caller:
  the creator's delete-then-insert now succeeds on an empty roster, a _second_
  teacher who neither created nor teaches the class still gets `42501`, and
  `group.invite` stays `false` for the creator. Two unit cases that encoded the
  older reading ("a `group`-scope holder who created but does not teach gets
  nothing") now assert §6.3, and a new case pins the roster rewrite; mutation
  (`|| group?.created_by === ctx.userId` → removed) is **KILLED**.
- **The case texts that said "0 / 0" for a fresh class (R6).** `EDU-GRP-04` and
  `MGR-GRP-01` asserted a new row reads 0 members / 0 teachers. Since 2b-2-3 the
  creator is enrolled as its `teacher`, and `memberCount` counts the whole
  roster, so a fresh class is **1 / 1** — `MGR-GRP-01` already asserted
  `teacherCount === 1` two lines under a `'0'` cell, which is how the lag showed.
  Both specs and both case texts moved together. The seeded-empty `G2` stays
  0 / 0: nobody created it through the API, so it has no bootstrap row.
- **`EDU-02`'s sidebar.** The nav entry follows `group.read` (what the class
  routes enforce), so a `member`-role educator keeps „Grupy” and reaches a
  read-only list; `group.manage` governs the controls inside. The case text and
  the spec now say that, and the spec asserts both halves — entry present,
  „Nowa grupa” absent — instead of asserting the old "hidden without
  `group.manage`".
- **`use-group-options` asked for the org-wide list on `group.read`.** That is
  every student's key, so a student's „Grupy” filter offered every class in the
  org (`STU-14`: two buttons where one was expected). The org list is a _manager_
  affordance — it exists so a teacher can filter by a class they may edit — so
  it now loads for `group.manage` / `group.member.manage` only, while
  `/me/groups` keeps supplying the caller's own classes.
- **`STU-14`'s roster, and the seeder gap behind it.** The spec wrote the roster
  of `O1G2` — a class the admin created and the teacher neither created nor
  taught — which no rule admits, before or after this fix. The case text says the
  teacher teaches both groups, so the profile now declares it
  (`groupTeachers` in `__tests__/qa/profiles/STU-14.json`, honoured by
  `scripts/seed/qa.ts`) and the spec asserts the seeded premise instead of
  trying an impossible write. `EDU-Q-01` declares the same for its `G2`.
- **QA, re-run against this build** (one process at a time, fresh tenant per
  case): EDU-GRP-02, EDU-Q-01 (2/2), EDU-GRP-04, EDU-02 (2/2), MGR-GRP-01,
  STU-14 all pass; regressions EDU-GRP-01, EDU-GRP-03, EDU-GRP-05 pass. The
  slice's own integration suites (52 cases, API + RLS + tenant isolation) pass.

#### 2026-11-20 — the roster read is three keys, and its deny shape is an empty list

What: 2b-3 put `GET /organization/members` on `org.member.manage` alone and
named the three teacher surfaces (`/edu/classroom/members`, the assignment
student picker, the `/edu` onboarding counts) as a phase-6 UI question. That is
wrong: a Teacher cannot hold `org.member.manage` (D18/FP-04) — the seeded
Teacher row carries `group.*` at `group` scope — so the roster refused exactly
the callers who need it, and EDU-GRP-02 / EDU-ASG-04 encode that need. The
catalog has no `org.member.read`, and minting one would add a fourth read key to
the org family for a directory that org managers, class managers and class
inviters all share.
Why: the roster is not an org-administration surface only. A class manager adds
people to a class and a class inviter picks existing org members (ADR §4.3/D7);
both need the org directory to choose from and both are legitimately narrower
than `org.member.manage`. The deny shape is an empty list, not a 403: AUT-19
already accepts `{ success: true, data: [] }`, the body carries no row, and a
403 would make the three `/edu` surfaces fail rather than render empty.
Fix: the controller admits `org.member.manage` **or** `group.manage` **or**
`group.invite` at any scope — one `hasPermission` call per key, never "any key
the caller holds" — and answers `{ success: true, data: [] }` without touching
the service when none is held; the no-active-org 403 stays. `PUT`/`DELETE` stay
`org.member.manage`. The `org_members` SELECT policy is deliberately **not**
narrowed: it predates the slice and every `org_members` reader must be audited
first, so the API is narrower than the data plane until 2b-4 (R23); D25, §7.1
and the 2b-4 slice row carry that asymmetry. The unit truth table and the API
integration matrix pin each branch, and `bun run mutate` kills the
`group.manage` branch, the `group.invite` branch and the empty-list shape. R16
sent the corpus with the change: AUT-16 and SEC-02 asserted `403` for a student
reading the roster, so both now accept `[200, 403]` and pin the exact empty
body, and their case texts gained a dated observation.
Rule: a shared directory denies with an empty list, not an error; and R23 — an
API gate that stays deliberately narrower than its data-plane policy names the
asymmetry and its owner in the same PR.

#### 2026-11-20 — the fixture's "teacher" was a Member, and D25 is what said so

What: the `content` profile in `scripts/seed/qa.ts` built its default roster
with `buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' })`. The
third argument is the **account type**; the org role comes from
`SeedAccount.orgRole`, whose default is `member`
(`__tests__/helpers/tenant-seed.ts`). So the account every case calls "teacher"
was an educator persona holding the org **Member** row, and its `group.manage` /
`group.invite` resolved to nothing. `teacher2` had already been migrated to
`orgRole: 'teacher'`; the default never was.
Why D25 exposed it: the roster read is `org.member.manage` **or** `group.manage`
**or** `group.invite`, and all three arrive through the org-role layer, so a
Member holding none of them gets the correct `{ success: true, data: [] }`.
`AUT-19` (`spec.ts:174`, its "authorized teacher" must see the tenant student in
`GET /organization/members`) and `EDU-ASG-04` (`spec.ts:366`, the single-student
picker reads the roster with `?role=member`) then failed on the fixture while the
product answered correctly — the failure D25 was supposed to surface, one layer
below the gate.
What it closes: the 2b-2-2 note that "EDU-GRP-01 and EDU-GRP-03 stay red on
their fixture" no longer reproduces. The QA pass on this tree ran `EDU-GRP-01`,
`EDU-GRP-02`, `EDU-GRP-03` (the `org-limit` profile, which promotes its teacher)
and `EDU-GRP-05` green, with only `AUT-19` and `EDU-ASG-04` red. Those two
EDU-GRP cases are org-scope read/create cases that the 2b-3 route set settles;
the remaining gap in this slice was only the content profile's org role, so that
2b-2-2 debt note is closed by this entry rather than edited in place.
Fix: `teacher` now passes `orgRole: 'teacher'`, the same value `teacher2` carries.
That is the org role row only: `seedTenantGraph` enrols every member in the
default group with `group_members.role = 'member'` unconditionally, so the
account still does not teach a class; content-profile cases that need class
management keep declaring `groupTeachers`, and `org-limit` keeps its explicit
`{ ...accounts.teacher, orgRole: 'teacher' }` (now redundant with the default,
left in place because that profile's member-limit count depends on it).
Profile audit: `bare` seeds `org: null`, so the field is inert; `org-limit`
promotes through the same `teacher` param it always did; `two-org` builds its own
`teacher-a` account and promotes it per org; the `--role` flag only selects
which account the bare profile seeds. None of those paths changed.
No seeder-level test exists, and this entry deliberately does not invent one: the
module is Bun-only (`scripts/seed/cli.ts` value-imports `new SQL` from `bun`, and
`scripts/seed/qa.ts` reads `import.meta.dir` at module scope), so importing it
under Vitest fails first at `scripts/seed/cli.ts:14` (`Cannot find package
'bun'`) and, with that mocked, at `scripts/seed/qa.ts:125` (`import.meta.dir`
undefined); `seedCase` is in any case DB-bound and writes tenant files. The proof
is the end-to-end one, and it is the pass condition the QA run carries rather
than a result recorded here: `AUT-19` and `EDU-ASG-04` fail on the pre-fix
seeder at the two lines above and must pass after it, with `EDU-GRP-02` /
`EDU-GRP-05` as the regression sample — that run happens once, after this seeder
change, so the entry records what to look for, not a green it has not seen. A
unit test asserting the literal would have been a change detector over one
fixture line, not a behaviour assertion.
Rule: a QA persona's authority is its org-role row, not its account type — a
slice that gates on role keys audits the seeded **default** accounts, not only
the accounts a profile explicitly promotes (R24).

##### Correction (2026-11-20, after the QA pass on `41a275d0`) — the broad default broke EDU-GRP-05

What: `AUT-19` and `EDU-ASG-04` pass, and `EDU-GRP-05` fails at
`__tests__/qa/EDU/EDU-GRP-05.spec.ts:124` („the educator holds no
`group.manage`”). That case is built on the _absence_ of the key — its premise
was the old default, an educator on the org Member role — so making the default
model-correct removed the fixture the case was testing against.
Why not revert: the default has to carry the Teacher role, because a roster
reader that is not an org manager needs `group.manage`/`group.invite` from
somewhere and the persona is supposed to be an authority-bearing educator. A
case whose subject is a _missing_ permission is the exception, and exceptions
declare their own roster.
Fix: `__tests__/qa/profiles/EDU-GRP-05.json` keeps `"profile": "content"` (the
spec asserts it) and adds a `members` roster — manager `admin`, `teacher`
`member`, `student` `member`, the same three keys and account types — with no
`groups` (so the default group stays `G1`) and no `groupTeachers` (the educator
must teach no class, or `group.manage` would resolve at `group` scope from the
teacher row and `manageVia` would stop being `null`). The `members` shape
defaults a name to `QA <key>`, so the accounts keep their old names, emails,
ids and the group's 3-members/1-teacher counts. Case text gained a dated
observation; the spec's header comment now names the declared roster.
Rule: R24 read in both directions — audit the default accounts before a role
change and the cases built on the old default after it; when the old default was
the case's premise, the case declares its own roster and the default never goes
back.

#### 2026-11-20 — 2b-3 review pass: the fourth read key, and a guard that looked in either clause

What: the review pass over 2b-3, and what each finding settled. The one that
changed behaviour:
D25 admitted three read authorities to the roster and missed the **Billing**
preset. `ROLE_TEMPLATES.billing` is exactly `org.billing.manage` +
`org.seat.manage` (`packages/authz/src/lib/org-roles.ts`), and `/manage/seats`
fills its assign dialog from `GET /organization/members`
(`apps/web/src/app/(frontend)/manage/seats/page.tsx`), so a Billing holder got an
empty picker: the "read the roster if you may act on it" principle with a
consumer the first decision did not look for. `canReadRoster` now also admits
`Permission.ORG_SEAT_MANAGE`; no Member or Teacher role holds it, and the
`org.seat.manage`-only role still fails `PUT`/`DELETE` on members, roles,
settings and invitations, which the unit truth table pins in both directions.
Why it was missed, and the general lesson: R24 was written about **seeded QA
accounts**, but a role preset in code is a consumer too. The audit for a new read
authority has to walk every caller of the endpoint, and a shipped preset is one —
`/manage/seats` reads the roster while the Billing preset is the only role that
can reach that page without `org.member.manage`.

What else moved, and why:

- **The migration's closing guard only looked in one clause.** It passed when
  _either_ `qual` or `with_check` carried the permission, so a `with check`
  reverted to the legacy predicate survived the guard. The `org_seat_pools`
  UPDATE had no behavioural test either, so the mutation was invisible twice
  over. The guard now keys on `(tablename, policyname, key)` and requires the key
  in **every clause that exists** (`qual is null or …`, `with_check is null or
…`), and it asserts the `invitations` SELECT policy still names
  `rls_caller_is_org_manager` — the read half this slice deliberately leaves for
  2b-4, which the header comment claimed but the block never read.
- **The two UPDATE policies and the self-DELETE had no case.** `org_seat_pools`
  UPDATE, `org_seat_assignments` UPDATE and a manager's `org_members` self-delete
  are now pinned. A refused `USING` on UPDATE/DELETE answers zero rows rather
  than 42501 (only `INSERT`, and an UPDATE whose `using` passes but whose `with
check` fails, raise it), so those cases assert the row is untouched instead of
  a code they cannot produce.
- **The public token branch was tested signed in.** `GET /organization/invites?token=…`
  ran with a member session, so a 404 proved only that the lookup missed. It now
  runs with no session and no cookie jar, with `createClient` reset to reject: the
  anonymous answer is 404, not 401/403, and the session client is never built.
- **The invitation list case accepted an empty list**, and the "revoke has no
  grant-authority conjunct" comment sat on a call whose session was the inviter.
  The list now asserts the minted id; the comment moved to the RLS case that
  actually pins it (a non-inviter holding only `org.invitation.manage` deletes the
  row — the API's revoke pre-reads through the unmoved SELECT policy, so there the
  inviter branch is what shows the row).
- **Numbers and provenance.** `pr:size` is re-derived from the command below.
  The `allowedAccountTypes` count now quotes
  `git grep -n allowedAccountTypes 6b6554f2 -- 'apps/web/src/app/(backend)/api/v1/organization'`,
  because the sweep is what removed the matches from this tree. 2b-2 is recorded
  as merged (`6b6554f2`, #1398). The route-handler comment now says what the code
  does: authentication runs first, authority runs in the controller after
  `req.json()`, so a malformed body from an authorised-pending caller is a 400.

Proof (by hand, because a migration cannot be driven through `bun run mutate`):
the `org_seat_pools` UPDATE `with check` reverted to
`rls_caller_is_org_manager` makes the new guard raise
`org-control policies without the expected permission in every clause:
org_seat_pools.Org managers update seat pools`; with the guard relaxed to its old
`or` shape the same mutation passes the guard and the new UPDATE case fails with
`42501`, so the guard and the test each kill it. Dropping the
`ORG_SEAT_MANAGE` branch fails the new unit case (`[]` instead of the roster) and
the API's Billing case (`0` rows). Wrapping the token branch in `authedRoute`
turns the anonymous 404 into a 500. The `invitations` SELECT assertion was proven
by temporarily adding `alter policy … using (true)` to the file.

Rule: an audit for a new read authority walks every caller — including a role
preset shipped in code; and a guard that accepts the predicate in "either"
clause does not guard the clause the mutation targets.

#### 2026-11-20 — the QA shards named the three cases that depended on the old default

What: CI run `44734178262` failed exactly three cases, all on the fixture, not
the product. `qa-suite (edu)` — `EDU-DECK-01` (`spec.ts:245`: three readable
decks expected, two returned; the manager's `G1` deck needs `deck.read` at
`group`) and `EDU-TOP-01` (`spec.ts:418`: the `G1`-shared topic not visible, the
same key shape). `qa-suite (mgr-sec-bil)` — `MGR-SEAT-03` (`spec.ts:188`: the
control educator no longer holds `orgRoleName === 'member'`, so the role-aware
`pro` seat refuses it). Each spec's header already documented the premise ("the
educator holds the org `member` role"), i.e. each was built on the default that
the D25 fix had to change. `EDU-02` timed out once on `/features/me` and passed
on retry: a flake, not a dependent, and left alone.
Fix: the default stays model-correct; the three cases declare their own roster
through the same `members` shape `EDU-GRP-05` uses —
`__tests__/qa/profiles/{EDU-DECK-01,EDU-TOP-01,MGR-SEAT-03}.json` carry manager
`admin`, educator `member`, student `member` (MGR-SEAT-03 had no profile file, so
it gains one). Same keys, account types, names, ids and e-mails, so the group
counts and every seeded id stay where they were; `EDU-DECK-01` still promotes its
educator to group `teacher` itself, and no `groupTeachers` was added anywhere.
Case texts gained a dated observation; no spec assertion changed.

**Known gap, recorded and not changed — follow-up: phase 3, the single
resolver.** The seeded **Teacher** role holds every content key at `own`
(`stats.read` at `group`), while **Member** reads content at `group`
(`20261119180000_authority_entitlement_profile.sql`, `SYSTEM_ROLE_TEMPLATES` in
`packages/authz/src/lib/org-roles.ts`). ADR-0015 §4.2 says Teacher is "content CRUD
at `own`/`group`", which 2a-1 implemented as own-only — so a Teacher-role holder
cannot read content shared to a class they are in, while a Member can. The three
cases above are the visible edge: they need `deck.read` / `topic.read` at `group`
to see a classmate's shared row, which is why they declare the Member role. This
slice does not touch the seed, the template or a case for it; the scope
composition belongs to phase 3's single resolver, and the pointer is repeated
under that phase.

Rule: none new — R24 in the direction this run measured: when a broad default
becomes model-correct, the cases built on the old one fail as a group, and the
shard names them.

**Closed in 3d (2026-11-22).** D29 moves the Teacher content reads to `group`
(writes stay `own`), so the three profiles name `orgRole: "teacher"` again and this
workaround is retired; see the phase-3 3d block and R35.

**2b-4 written on `feat/authority-2b-4` — slice 4 of 9:**

- **The inventory, re-derived (R9/R10).** On a fresh reset, `pg_policies` named
  `rls_caller_is_org_manager` in **ten** policies: the nine this slice moved plus
  the `invitations` SELECT it deliberately leaves. `rls_caller_has_org_feature`
  was named in **none** (2b-2 moved the six group policies). The
  **eleventh** reference in the audit was not a policy at all:
  `can_assign_org_role` calls `is_org_manager` directly rather than through an
  RLS wrapper. The moved set is **nine policies over four tables plus one
  helper**:

| Table                   | Policy                                 | Key                                      |
| ----------------------- | -------------------------------------- | ---------------------------------------- |
| `billing_subscriptions` | Own or org-manager subscription read   | `org.billing.manage` (org branch)        |
| `teacher_assignments`   | Authored teacher assignments update    | `assignment.update` at `organization`    |
| `teacher_assignments`   | Authored teacher assignments delete    | `assignment.delete` at `organization`    |
| `assignment_questions`  | Authored assignment questions insert   | `assignment.update` (parent's org)       |
| `assignment_questions`  | Authored assignment questions update   | `assignment.update` (parent's org)       |
| `assignment_questions`  | Authored assignment questions delete   | `assignment.update` (parent's org)       |
| `assignment_targets`    | Authored assignment targets insert     | `assignment.update` (parent's org)       |
| `assignment_targets`    | Authored assignment targets update     | `assignment.update` (parent's org)       |
| `assignment_targets`    | Authored assignment targets delete     | `assignment.update` (parent's org)       |
| helper                  | `rls_caller_can_read_assignment_items` | `assignment.read` (staff/manager branch) |

Every existing conjunct stays: the billing `user_id = auth.uid()` self branch
and `organization_id is not null`, the assignment `created_by = auth.uid()`
author branch, and the tenant scope the helpers carry. The file ends with a
`do` block that raises when any expected policy lacks its key **in every
clause it has** (`qual`/`with_check`, 2b-3's shape), when a policy on a moved
table still names the legacy helper, when any policy anywhere still names
`rls_caller_has_org_feature`, when the cohort helper names `account_type`, or
when a recorded boundary moved. Each boundary is an `exists` — the policy (or
function) row **and** its positive predicate — because a `count(*) = 0` /
`not like` check also passed when the policy was dropped: the assignment
INSERT's persona conjunct, the two assignment SELECTs' cohort helpers, and the
org-wide assignment SELECT by its exact
`organization_id IN (SELECT … rls_caller_org_ids())` shape. It applies twice —
`env:reset-db` ran twice and the file was re-applied by hand.

- **The any-scope caveat had to be paid again.** A Teacher held every
  `assignment.*` key at `own` scope before 3d (reads are `group` since D29), so
  `rls_caller_has_permission(org, 'assignment.update')` alone would let a
  Teacher rewrite any run in the org through PostgREST while `verifyOwnership()`
  refuses it. The write policies therefore ask for the key at
  **`organization` scope** (an explicit `org_members` ⨝ `org_role_permissions`
  subquery, 2b-2's shape) and the author branch is what reaches a Teacher's own
  run. The **read** helper keeps the any-scope key on purpose: the branch it
  replaces — educator/manager persona in the org — was org-wide too.
- **The billing gate, per path.** `org.billing.manage` replaces the
  `isOrgAdminRole` (system-role-name) re-check in `BillingService`, before the
  driver is consulted so an unauthorized caller is refused rather than told the
  mock has no provider. The gated subscription actions are
  `POST /billing/change-plan`, `POST /billing/cancel`,
  `POST /billing/release-scheduled-plan`, `POST /billing/reconcile` and
  `GET /stripe/portal`. `GET /billing/subscription` has no capability gate — the
  RLS read decides visibility (own row or the key) and the same key drives
  `canChangePlan`/`canCancel`/`canManagePortal`, so the view can never advertise
  an action the write endpoints refuse. `POST /stripe/create-checkout-session`
  is **unchanged** and is not one of those actions: its body names an org that
  need not be the active one, `ctx.permissionScopes` resolve for the active org
  only (the same note `invitation.service.resolveTargetOrganization` carries),
  and `resolveCheckoutOwner` is shared with the mock-completion path, which has
  no `RequestContext` at all — so a `billing` role still cannot buy the org's
  first plan. The per-target-org resolution belongs to 2b-6's route sweep.
- **The owner resolution is still persona-keyed (recorded, phase 5 owns it).**
  `ownerFromContext` and `BillingReadRepository.findSubscription` resolve an org
  owner only for `accountType === MANAGER`, so a `student`/`educator` persona
  holding Admin or the Billing preset never reaches
  `requirePermission(org.billing.manage)` — it resolves a personal owner
  instead. D13 makes the persona irrelevant, but deriving the owner from
  `activeOrgId` + membership is not a local edit: every member of an org with an
  active org cookie would stop reading their own personal subscription, and the
  read model branches on the same condition. **Phase 5 (the 2b-9 slot) owns the
  derivation** for both the service and the read repository; 2b-6 keeps only the
  checkout path's target-org scope.
- **What can now 403 / what gains.** Gains: the shipped **Billing** preset reads
  the org subscription, changes the plan, cancels, releases a schedule,
  reconciles and opens the portal — every one of those refused the role before
  the system-role-name check (D17's preset is now real). A custom role holding
  `assignment.update`/`delete` at `organization` can write a run it did not
  author through the **API** (before, the service admitted it and RLS refused
  with 42501 — an FP-01-shaped 500), and an `assignment.read` holder reads the
  item set without an educator persona. Loses: a MANAGER on a role carrying the
  legacy `member.manage` marker and no key loses the org subscription read and
  every assignment write (the marker is no longer authority); a Member-role
  educator loses the PostgREST item read the old persona branch granted; a role
  with `assignment.update` but not `assignment.delete` loses a **run's** DELETE
  through the API as well as the table (the service's ownership check now asks
  the policy's key — R4), while the draft's children stay an update. A system
  Admin that had `org.billing.manage` stripped by a role save is refused where
  the role name used to answer.
- **`org_members` SELECT: left as it is, with the audit (R23/D25).** The policy
  is "own row or any org I belong to". Narrowing it to D25's four read
  authorities would silently empty every reader whose gate is **not** one of
  them, and the audit (`rg "from('org_members')" packages/server/src`, then each
  caller's client) names them: `organization.service.ts` (org detail, read on
  plain membership — a Member would see an empty team list),
  `question-report.service.ts` (`org.report.manage` admin lookup),
  `org-role.service.ts` (role list member counts, `org.role.manage`/membership),
  `group.service.ts` (roster/addable-members, `group.member.manage` — not in
  D25's four), `teacher-assignment.service.ts` (target validation,
  `assignment.create`/`update`), `activity.service.ts` + `stats.service.ts`
  (persona-gated teacher stats), `seat.service.ts` (`org.seat.manage`, in the
  four), `organization-member.service.ts` (the D25 endpoint itself),
  `notification.service.ts` (recipient membership), plus the readers the first
  pass missed: `with-auth.ts` (the membership row _is_ the active-org proof, so
  a narrowed policy would break every request), `assignment-access.ts` (the
  student's targeted-run read), `entitlement.resolver.ts` (seat/limit resolution),
  `org.service.ts` (the org list a member switches between),
  `invitation.service.ts` (invitee membership), `classroom.service.ts` (the
  creator's membership insert), `question-seal.ts` (a targeted student's org)
  and the two Stripe repositories (the webhook's owner fallback and
  `isOrgAdmin`). The needed set is therefore
  "almost every control-plane reader", which is the policy as it stands:
  narrowing is not a policy tweak but a change of every reader to explicit
  service-role filters. **Phase 5 (the 2b-9 slot) owns it.** The data-plane
  asymmetry is pinned by a case in
  `control-plane-permission-rls.test.ts` (a Member reads a colleague's row
  through PostgREST while the D25 API answers `[]`), so narrowing is a scheduled
  change, not an assumption.
- **Deliberately left (the recorded boundary).** `teacher_assignments` INSERT
  keeps its `account_type in ('educator','manager')` conjunct and the two
  assignment SELECT policies stay org-wide: the `teacher/assignments/*` route
  layer is still persona-gated (2b-6), and moving the insert here would make the
  API and the data plane disagree and regress EDU-ASG-04, whose fixture is a
  Member org role. `can_assign_org_role` and the `invitations` SELECT keep
  `rls_caller_is_org_manager`: **moving the helper's manager half alone does not
  close 2b-3's retarget asymmetry**, because PostgREST refuses an UPDATE whose
  row the SELECT policy hides (measured: a role holding `org.invitation.manage`
  - `org.member.manage` gets `200 []` and the row is unchanged), and 2b-3's
    migration — replayed by its own suite — pins that read. 2b-5 owns both halves
    with the class-invite rewrite (R25).
- **Tests.** `__tests__/integration/control-plane-permission-rls.test.ts` (new,
  **22 cases**): real signed-in sessions through PostgREST, both directions —
  the Billing preset and the Admin role read the org subscription, a Member-role
  manager and the legacy marker read nothing, the personal own-row branch stays;
  an `assignment.update`-at-`organization` holder edits another teacher's run,
  the Member role / legacy marker / `own`-scope holder / non-author Teacher are
  refused and the row is unchanged; the DELETE split (`assignment.delete`); the
  child tables' I/U/D through the parent's org **and through the updater role**
  (a custom non-Admin role, because the Admin is also legacy-manager positive),
  an `own`-scope holder refused on both tables with the rows unchanged, one
  `assignment_targets` UPDATE, and the cohort replace (delete + insert, the
  resulting set asserted); the cohort read (`assignment.read` holder with the
  **student** persona and the author read, a Member-role educator does not, a
  targeted student reads the target list but not the items, an outsider reads
  nothing); `billing_customers` stays closed; the recorded `org_members` width.
  `__tests__/integration/billing-permission-api.test.ts` (new, **7 cases**)
  drives the real routes + `withAuth` + controller with a fake provider and real
  catalog/customer/subscription rows: the Billing preset reads with actions
  advertised, a Member-role manager reads without them, the Billing preset and
  the Admin role change the plan, a Member-role manager gets 403 with the mirror
  and the org plan unchanged, and cancel / release / reconcile are gated on the
  same key. Unit: the six `billing.*` suites move from `isOrgAdmin` stubs to the
  permission (holder proceeds, non-holder throws `FORBIDDEN` without touching
  the provider), each of the four provider actions gains a
  mock-driver-plus-non-holder case (403 before the driver answers `NOT_FOUND`),
  and `teacher-assignment.service.test.ts` gains the delete split plus the
  filtered-delete refusal.
- **Gates (this tree, review pass).** `env:reset-db --yes` **twice**; the touched
  integration files serially — **4 files / 79 passed**; the full integration
  suite — **106 files / 962 passed, 11 skipped**; `test:unit` **4751 passed,
  1 skipped**; `typecheck:all`, `typecheck:admin`, `lint:all`, `review:static`,
  `knip`, `format:check` (**2211 files**), `pr:size` **716/400 (XL** — 1564 test
  and 441 doc lines excluded; the two migrations are most of what remains, so
  the PR needs a `size:exception`).
- **Mutation proof.** `bun run mutate` (KILLED, one line each): the
  `requirePermission(ORG_BILLING_MANAGE)` call vs the cancel unit case; the
  `hasPermission` read-model flag vs the "does not advertise" unit case;
  `createPortalSession`'s gate vs its unit case; the same gate line vs the API
  403 case (`expected 200 to be 403`); the mock-driver line moved ahead of
  `assertOrgBillingAuthority` vs the new cancel mock case (`resolved
NOT_FOUND instead of rejecting`); the cohort count check weakened from `!==`
  to `>` vs the new filtered-delete case. By hand (a migration cannot be driven
  through `bun run mutate`): the billing policy reverted to
  `rls_caller_is_org_manager` with its guard entry relaxed → the Billing read
  case red; `assignment.delete` reverted to `assignment.update` → the DELETE
  split red; the org-scope conjunct replaced by the any-scope helper (the guard
  is blind to this one — the key is still present) → the non-author Teacher case
  red; the cohort helper's staff branch reverted to the persona → the
  Member-educator case red; **the child `assignment_targets` DELETE reverted to
  `assignment.delete` (guard entry moved with it) → the cohort-replace case red
  (`expected [] to have a length of 2`), everything else green**; and the
  boundary half of the guard proved by dropping `Visible teacher assignments`
  and replaying its `do` block — it raised
  `recorded 2b-4 boundary no longer holds: teacher_assignments SELECT stays
org-wide` where the old `count(*) = 0 … not like` shape was vacuously true for
  a missing row; widening the same policy with an `assignment.read` disjunct
  raised the same message. Each was restored; the second `env:reset-db` covers
  the drops.

**Follow-ups this slice creates:**

- **2b-5** owns both invitation halves (`can_assign_org_role`'s manager half and
  the SELECT policy) — R25.
- **2b-6** owns the assignment INSERT persona conjunct, the org-wide assignment
  SELECTs, and the checkout path's per-target-org scope resolution.
- **Phase 5** owns the `org_members` SELECT narrowing, with the audit above.

**2b-5 written on `feat/authority-2b-5` — slice 5 of 9:**

- **The schema (one migration, `20261120170000_class_invites.sql`).**
  `invitations.group_id uuid null references groups(id) on delete cascade` and
  `invitations.target_group_role text null`, with
  `invitations_target_group_role_check` (`teacher | member`, the same two
  literals as `group_members.role`'s CHECK), the pair CHECK
  `invitations_group_pair_check` (`(group_id is null) = (target_group_role is
null)` — an org invite has neither, a class invite both) and
  `invitations_group_id_idx`. The write trigger
  `validate_invitation_target_org_role` is re-created to also reject a group
  whose organization differs from the invitation's (23514) and to normalize a
  class row's `target_org_role_id` to the org's system `member` role (a
  `group.invite` holder cannot persist a class invite carrying Admin). The
  accept RPC `accept_org_invitation` gains the class branch: the invitee must
  already be an `org_members` row (checked **before** the claim, so a refused
  accept never consumes the token), the org-membership write is a
  self-guarding no-op for that member (`insert … select … where exists (…)
on conflict DO NOTHING` — one statement snapshot, so a membership row
  deleted between the pre-check and the insert is not re-created; a class
  invite never grants or changes an org role), and
  `group_members` is upserted with `target_group_role` (`DO UPDATE SET role =
EXCLUDED.role` — idempotent). The org branch is byte-for-byte the old
  behaviour. `database.ts` regenerated with the pinned CLI 3.1, byte-identical
  on a second run (25 added lines: the two columns, the FK relationship, the
  three new RPCs).
- **The helpers.** New actor-parameterized `public.has_permission(actor, org,
key)` and `public.has_group_permission(actor, group, key)` (SECURITY DEFINER,
  `search_path = ''`, `service_role` only, PUBLIC/anon revoked) so the
  service-role preview/accept flow can re-check the **inviter's** authority;
  the `rls_caller_has_permission` / `rls_caller_has_group_permission` wrappers
  now delegate to them (one definition of each rule, grants restated). **`can_assign_org_role`**
  is rewritten to `has_permission(p_actor, target.organization_id,
'org.invitation.manage')` and its **teacher-role-name exception is deleted**.
- **The four `invitations` policies, split by row shape (R4, R25).** Tenant
  floor and `inviter_id = auth.uid()` stay on every read/write; the capability
  branch is, per row: org invite (`group_id is null`) →
  `rls_caller_has_permission(organization_id, 'org.invitation.manage')` (+ the
  `rls_caller_can_assign_org_role(target_org_role_id)` conjunct on INSERT and
  on the UPDATE's `with_check` only — it refers to the NEW row), class invite
  (`group_id` set) → `rls_caller_has_group_permission(group_id,
'group.invite')`. The SELECT moved **in this slice together with the
  writes** — **R25 is closed**: 2b-4 measured that PostgREST refuses an UPDATE
  whose row the SELECT hides, so the half-moved read left an
  `org.invitation.manage` holder unable to retarget; both halves now read the
  permission. No `invitations` policy names `rls_caller_is_org_manager` any
  more (verified: `pg_policies` query returns zero rows). The helper is 2b-2's,
  unchanged; §4.1 gives `group.invite` no `own`, so its creator branch grants
  nothing here, and the API applies the role-row conjunct where it already
  does (`resolveGroupScope`/`requireGroupPermission` in the controller) — the
  same scope-agnostic-teacher asymmetry `group.manage`/`group.member.manage`
  already carry, recorded in the migration header.
- **The API.** `CreateInviteSchema` gains the paired class target (`groupId` +
  `groupRole`, 422 when only one is set; `groupRole` is `z.enum(GROUP_ROLES)`).
  `InvitationController.create` parses, then decides **from the context
  alone**: a class target resolves the group in the active org first (404 for a
  foreign id, §7.1 — via the new shared `groupInOrg` lookup, also adopted by
  `group.service`) and asks `requireGroupPermission(ctx, 'group.invite',
group)`; an org target asks `requirePermission(ctx, 'org.invitation.manage')`.
  `createBulk` gates the whole batch on `org.invitation.manage` and the service
  refuses entries carrying a class target (422 naming the entry) — bulk stays
  the org surface. The service's class path re-scopes the group to the resolved
  target org (404), enforces **D7** (the invitee's email must name an existing
  `org_members` row, else 422 on the `email` path) and writes
  `group_id`/`target_group_role`; the persona half of
  `resolveTargetOrganization` is deleted (the controller owns the capability).
  The token preview re-checks the inviter with `has_group_permission` for class
  invites (`can_assign_org_role` for org invites) and exposes
  `groupId`/`groupName`/`groupRole` — the group-org check in `isInviteUsable`
  keeps the preview inside the invite's own org. No UI surface posts a group
  target today (`/manage/invites`, `/edu/classroom/invite`, `/setup/classroom`
  all post org-shaped bodies), so the UI is **phase 6** and deliberately left
  out.
- **What can now 403 / what changes.** A Teacher-role holder loses every
  org-invite write (the teacher-name exception is gone — an org teacher's
  `POST /organization/invites` without a group target is now 403, and through
  PostgREST 42501), and gains class invites for the classes they teach
  (`group.invite`): API 201 and PostgREST insert succeed for a taught class,
  403/42501 for another class of the same org. A Member-role caller is refused
  everywhere (API 403, PostgREST 42501, SELECT hides every row). A role holding
  only `org.invitation.manage` (the Assistant preset) can list/retarget/revoke
  **and now actually retarget** — the read half moved with the write (R25):
  before, the legacy SELECT hid the row from a non-inviter permission holder
  and the UPDATE answered a silent `200 []`. A class invite can never create an
  org membership or grant/change an org role: the RPC refuses a non-member
  invitee before the claim (pinned by a tampered-row test: 410, no
  `org_members`/`group_members` row, token left unconsumed). A foreign-org
  group is 404 at the API and refused at the table (the write trigger's 23514
  fires before the policy's 42501 — the trigger reads `org_roles` under the
  caller's RLS, so a cross-org row trips there first; either way nothing is
  written).
- **Tests.** New `__tests__/integration/class-invite-permission.test.ts` (17
  cases: the whole matrix above through real routes + `withAuth` and through
  PostgREST with signed-in sessions, including the preview and the idempotent
  accept). Updated: `invitations.test.ts` (the #189 teacher org-invite control
  now expects 403), `org-control-permission-rls.test.ts` (replays the 2b-5
  migration — see R27 — drops the now-unneeded legacy marker on the inviter
  fixture, rewrites the teacher cases around the class branch),
  `rls-tenant-isolation.test.ts` (`can_assign_org_role` is false for a Teacher
  on every role, true for Admin via the permission; B1 drives the class invite),
  `anon-grants.test.ts` (the two new internal helpers are anon-denied). Unit:
  the controller truth table (which key each path asks, 404/403/422 shapes) and
  the service truth table (class path, D7 422, foreign group 404, bulk
  refusal, preview/accept `has_group_permission` re-check) in the two invitation
  suites. **Mutation proof:** 8 `bun run mutate` invariants KILLED (the
  `requireGroupPermission` call, the `requirePermission` on create, the bulk
  gate, the schema pairing `superRefine`, the D7 member check, the group
  re-scope, the bulk class-target refusal, the `isInviteAuthorized` class
  branch). SQL/RLS by hand: the migration's closing `do` block raised on three
  mutations (SELECT reverted to the legacy helper, INSERT class branch removed,
  teacher-name exception re-added), a re-apply of the file is a no-op, and a
  live `alter policy` that dropped the INSERT class branch turned the
  teacher's PostgREST class insert `42501` (restored, then OK again) — the
  suite's own `beforeAll` re-applies the shipped file, so a mid-run revert is
  healed before the tests run. The review pass added two `bun run mutate`
  KILLED proofs (the accept RPC's class-branch `do nothing` →
  `do update set org_role_id = excluded.org_role_id`, killed by the
  tampered-Admin-target accept case; the write trigger's class-row
  normalization line, killed by the PostgREST pin) and reproduced the
  class-branch TOCTOU by hand in one transaction on this checkout's stack
  (see the difficulty log).
- **Gates (this tree).** `env:reset-db --yes` **twice**; the touched
  integration files serially, then the full serial suite — **107 files / 983
  passed, 11 skipped**; `test:unit` **310 files / 4768 passed, 1 skipped**;
  `typecheck:all`, `typecheck:admin`, `lint:all`, `review:static`, `knip`,
  `dup:base` (0 new), `format:check`, `bun run pr:size` (see the PR body).

**Follow-ups this slice creates:**

- **2b-6** owns the content-route sweep and the `authedRoute` adoption; the
  class-invite UI (a group picker on the invite dialogs) is **phase 6** — no
  surface posts a group target today.
- **Phase 5** still owns the `org_members` SELECT narrowing (2b-4's audit).
- The `group.invite` creator-branch asymmetry (API `resolveGroupScope` accepts
  the creator in the `group` scope for any `group.*` key; the RLS helper's
  creator branch is guarded by `allowed_scopes @> '{own}'`, which
  `group.invite` lacks) is recorded in the migration header; a creator is
  normally also the class's teacher (2b-2-3), so the divergence needs a roster
  rewrite to remove their teacher row first.
- **`can_assign_org_role` still does not enforce ADR §4.4's "grant only what
  you hold"**: any `org.invitation.manage` holder can mint an org invite
  targeting the Admin role. Pre-existing on `main` (the manager half was
  `is_org_manager` there, so this is not a 2b-5 regression), but a custom role
  holding only `org.invitation.manage` could not invite before and can now.
  **Phase 5 / the §4.4 enforcement pass** owns the conjunct (the helper must
  also require that the actor holds the target role's grants); 2b-5
  deliberately did not add it.

**Difficulty log**

#### 2026-11-20 — the guard needed a per-key clause, and 2b-3's file can no longer be replayed

What: the first version of 2b-5's closing `do` block required every expected
key in every clause the policy has, and the first `db reset` failed on the
UPDATE policy's `rls_caller_can_assign_org_role` — that conjunct refers to the
NEW row, so it belongs to the `with_check` alone, not the `using`. The guard
now carries a per-key clause (`any` = every clause that exists, `check` =
`with_check` only and present there). Separately, replaying 2b-3's migration
file on a 2b-5 database raises at 2b-3's own guard (it pins the pre-2b-5
invitations SELECT), so the org-control RLS suite now replays only 2b-5's
file, which re-states all four invitations policies in full.
Why: a guard that assumes one clause shape guards the clause the mutation
targets in the other shape; and a closing guard pins the state its file
creates, so it is a snapshot of that slice, not a permanent invariant.
Fix: per-key clause in the guard; replay list = newest owner of the object.
Rule: R27 (and the clause split is the 2b-3 review pass's lesson again — a guard
must look in the clause the predicate lives in).

#### 2026-11-20 — the invitation write the read policy still holds

What: the settled 2b-4 row named the manager half of `can_assign_org_role`
(`is_org_manager` → the capability). Moving it turned the slice's own RLS
retarget case red — `200 []`, row unchanged — while the helper answered `true`
when called directly. The caller could write but not **read** the row (it is
neither the inviter nor a legacy manager), and a direct `set role authenticated;
update …` in SQL changed it while the same statement through PostgREST did not.
Why: PostgREST gates an UPDATE on the row's SELECT visibility, so a policy pair
that is write-wide and read-narrow answers a silent no-op instead of `42501`.
2b-3's "an inviter may still read their own row" note had been read as a
read-only nicety; it is load-bearing for the write. Moving the half alone leaves
the intended caller (`org.invitation.manage` + `org.member.manage`, the
Assistant preset) unable to retarget, and moving the SELECT in 2b-4 would break
2b-3's merged guard (its suite replays the file) and collide with 2b-5's rewrite
onto `rls_caller_has_group_permission`.
Fix: the helper and the invitation SELECT stay legacy in 2b-4 and 2b-5 moves
both; the RLS suite keeps the legacy marker on its positive retarget fixture
(that is what keeps the row visible) and now also asserts the persisted row
through the service client, not only the returned one. The delivered block and
the 2b-5 row carry the handoff.
Rule: a write policy cannot move before the read policy it depends on —
PostgREST refuses an UPDATE whose row the SELECT policy hides, so the write and
the read move in the same slice.

#### 2026-11-20 — the child DELETE asked for a key the service never checks

What: the two child DELETE policies (`assignment_questions`,
`assignment_targets`) asked for `assignment.delete`, while every composing path
gates on `assignment.update`: `removeQuestion` 403'd an update-holder for an
edit the slice claims to enable, and `setTargets` — delete, then insert — had its
delete silently filtered to zero rows and its insert accepted, so a non-author
update-holder _replaced_ a cohort with the stale rows still in place beside the
new ones. No unique constraint splits them, so publishing and sealing later read
a cohort the caller never wrote.
Why: the DELETE key had been copied from `teacher_assignments`' DELETE, where it
is correct — deleting a run is the destructive act — but the child tables carry
the _composition_ verbs, and the service's ownership prelude (`draftClient` →
`ownedClient`) is `assignment.update` for all of them. The RLS suite did not
catch it because its only non-author positive on those tables was the Admin role,
which also satisfies the legacy `rls_caller_is_org_manager` marker: a reverted
child policy stays green.
Fix: both child DELETEs are `assignment.update` (only the `teacher_assignments`
DELETE asks for `assignment.delete`), the guard's expected keys move with them,
`setTargets` counts the rows before the delete and refuses when the delete
removed fewer, and the suite gains an `updater`-role positive on both child
tables, an `own`-scope negative, a target UPDATE, and the cohort replace with the
resulting set asserted. Same pass: the boundary half of the guard became an
`exists` (R26), the `org_members` audit list was completed, and the billing
owner-resolution gap (persona still decides the owner) was recorded for phase 5.
Rule: R4 in the direction the review found it — the data plane must ask the key
the service asks for **the same operation**, and a positive that a legacy
capability also satisfies proves nothing.

#### 2026-11-20 — the accept test minted and asserted with the same role

What: the class-invite accept test minted the invite with
`targetOrgRoleId = memberRoleId` — the role the invitee already holds — and
asserted `org_members.org_role_id === memberRoleId`, so mutating the accept
RPC's class branch from `do nothing` to `do update set org_role_id =
excluded.org_role_id` left the test green: the fixture and the assertion used
the same value. The tampered-row case used the Admin target only for a
non-member, which the D7 pre-check refuses before any write, so the single SQL
line that would turn a class invite into an org-role grant had no red-capable
test at all.
Why: a guard is proven from the path that applies the value, not the path that
mints it; a fixture equal to the expected outcome cannot fail on the
escalation it claims to guard.
Fix: a new case seeds a class invite with `target_org_role_id = adminRoleId`
for the EXISTING member — past the write trigger (`session_replication_role =
replica` on a direct connection), i.e. exactly the row a manual write or a
future regression can leave behind — accepts it through the route, and
asserts the org role is still the member role while the group membership is
added with the invited role. `bun run mutate` on the class branch (`do
nothing` → `do update set org_role_id = excluded.org_role_id`) is KILLED (the
org role became the Admin role id); the unmutated re-run is green.
Rule: R28.

#### 2026-11-20 — the class branch's org_members insert raced its own pre-check

What: the accept RPC ran `not exists (select 1 from org_members …)` (the D7
pre-check) and then `insert … values (…) on conflict … do nothing` as two
statements. Under READ COMMITTED every statement takes a fresh snapshot, so a
membership row deleted and committed between them did not conflict and the
insert created a NEW membership with `v_invite.target_org_role_id` — which a
`group.invite` holder can set to any same-org role, Admin included. Reproduced
by hand on this checkout's stack in a single transaction (pre-check sees the
row, delete the row, insert): the old `values (…)` shape inserted the
membership with the Admin role (`n=1, role=admin`), the new shape wrote nothing
(`n=0`), and with the row present the new shape is a no-op that keeps the
existing member role.
Why: the check and the write it guards were two statements, and the guarded
table can be mutated concurrently; the window cannot be narrowed, only
removed.
Fix: the class branch's insert is self-guarding — `insert into org_members …
select … where exists (select 1 from org_members m where …) on conflict … do
nothing` — so "the membership exists" and the write share one statement
snapshot. The D7 pre-check stays (it refuses before the claim, so a refused
accept never consumes the token) and the group insert does not depend on the
org_members write. The migration's closing guard pins the `select
v_invite.… where exists (` shape, and the write trigger now normalizes a
class row's `target_org_role_id` to the system `member` role (its removal is
KILLED by the PostgREST pin: a teacher's class insert with the Admin target
persists the member role), so a `group.invite` holder cannot persist Admin on
a class row in the first place.
Rule: R29.

**2b-7 written on `feat/authority-2b-7` — slice 7 of 9 (legacy-marker deletion):**

- **Migration** `20261121090000_legacy_management_markers_removed.sql`: deletes
  `role.builder`, `org.manage`, `member.manage`, `group.manage` from
  `org_role_features`, `plan_entitlements`, `user_feature_overrides`,
  `entitlement_flags` and `entitlement_catalog` — in that order, with an
  explicit `where … in (…)` list — then re-creates `handle_new_organization`,
  `apply_org_plan` and `has_org_feature` without their marker lists (`all` is
  the plain plan ceiling; the `is_system and name='admin'` branch is the only
  special case left) and ends with a `do` block that raises when any marker row
  survives in those tables, when the catalog lost one of its six remaining keys
  (so "zero rows" is not the vacuous answer of an emptied catalog), or when the
  `group.manage` **permission** row is missing (R26). Old migration files are
  not edited.
- **`@studiq/authz`**: the four keys leave `ENTITLEMENTS`;
  `ADMIN_ONLY_ENTITLEMENTS` and `LEGACY_MANAGEMENT_ENTITLEMENTS` are deleted
  with their exports — no remaining guard needed a typed subset, so none was
  kept. `ORG_SCOPED_ENTITLEMENTS` stays (derived from `scope = 'org'`, now just
  `branding`).
- **Resolver** (`feature.resolver.ts`): `all` is `ENTITLEMENT_KEYS ∩ ceiling`
  (the marker filter is gone), the seat layer has no admin-only strip, and
  `org_role_features` keeps only its `is_enabled = false` revoke semantics
  (D19) — the `applyRows` grant mode for role rows is now revoke-only.
- **Seeds**: `00_plans.sql` drops the three marker flag rows and every marker
  `plan_entitlements` row (`launch` is now `flashcards, quiz`); `09_perms.sql`
  keeps the `group.manage` permission.
- **Pricing/UI**: `FEATURE_PRIORITY` loses the three markers,
  `ROLE_MARKER_FEATURES` is deleted (no key left to exclude),
  `deck-detail-screen`'s groups query gates on the `group.manage`
  **permission** instead of the entitlement, and the four `feature_*` marker
  labels leave both i18n locales.
- **Tests**: `catalog-invariants` retires the R15 pin (`overlap` is now `[]`)
  and gains the absence assertion (four keys gone from all four tables,
  `group.manage` still in `permissions`/`PERMISSIONS`); the fixtures probing
  `has_org_feature`/`rls_caller_is_org_manager` with a removed key are
  retargeted to surviving keys on the same branch (`branding` org-scoped,
  `advanced.stats` seat-eligible); resolver/pricing unit suites rewritten.
  QA (in-map only): BIL-04 asserts a surviving Hub feature, EDU-02 reads
  `group.manage` from `/permissions/me`, MGR-SEAT-02 pins that no org-scoped
  entitlement arrives through a seat; spec + case text moved together (R6).
- **Gates:** `env:ensure --profile api`, `env:reset-db --yes`, the full serial
  integration run, `test:unit`, `typecheck:all` + `typecheck:admin`,
  `lint:all`, `review:static`, `knip`, `dup:base`, `format:check`,
  `pr:size`; `database.ts` regenerated with the pinned CLI (byte-identical on
  a second run — no generated type changed). No build/serve/Playwright/QA.

**Difficulty log**

#### 2026-11-21 — the no-live-caller check has to grep the client, and the catalog's typed subsets die with it

What: the dispatch check (`git grep "requireFeature(" -- apps packages`) proved
no API caller of the four markers remained — only `branding` — but the client
still had one: `deck-detail-screen.tsx` gated its groups query on
`feature('group.manage')`, which the marker deletion silently turned into
always-false (the share dialog would have lost its group picker with no failed
test, because no Playwright case covers that dialog's enabled state). And the
two typed subsets over `ENTITLEMENTS` (`ADMIN_ONLY_ENTITLEMENTS`,
`LEGACY_MANAGEMENT_ENTITLEMENTS`) became empty the moment the keys left the
catalog, so their resolver branches (`all` minus markers, the seat strip) were
vacuous but still read as if the keys existed.
Why: `requireFeature` is the server gate, but `useFeature()('…')` literals gate
UI queries the same way, and a constant that is a subset of a catalog is a
second copy of the catalog that must shrink in the same PR.
Fix: grep `feature(` (not just `requireFeature(`) before deleting a key — the
deck-detail query now gates on the `group.manage` permission; the two constants
and their branches are deleted with the catalog edit; the migration's closing
guard asserts both directions (markers gone, catalog and the `group.manage`
permission intact) so it cannot pass on an emptied catalog (R26).
Rule: a key deletion is checked against every reader of the key in both layers —
`requireFeature(` on the server, `feature('…')`/`useFeature` on the client —
and a typed subset of a catalog is deleted in the same PR as the keys it lists.

**2b-8 written on `feat/authority-2b-8` — slice 8 of 9 (the RLS half of the
role-editor guards):**

- **Migration** `20261121150000_role_editor_guards_rls.sql` re-states all six
  role write policies in full (R27 — the RLS suites' replay list moves from
  `20261119190000` to this file) and adds:
  - `org_roles` DELETE gets `and not coalesce(is_system, false)` — system
    roles cannot be deleted through PostgREST (the service answers FORBIDDEN
    on the same row). INSERT gets the same conjunct on the new row, so a
    system role can also not be **created** through PostgREST (the API
    hardcodes `is_system = false`; the system rows come from the
    org-creation trigger, which runs as the owner). UPDATE deliberately
    carries **no** `not is_system` conjunct — a WITH CHECK evaluates the new
    row, so the conjunct refused every legitimate edit of a system row
    (description/display_name/entitlement_profile, which `updateRole` allows);
    flipping `is_system` in either direction is instead refused by the new
    `guard_org_role_system_flip` BEFORE UPDATE trigger (42501 on the
    `authenticated` surface). The rename half was already covered at the
    data plane by `guard_system_org_role_identity` (20261024124756) — pinned
    by a test, not a second trigger.
  - Two SECURITY DEFINER helpers (`search_path = ''`, grants in the same file,
    R18/R19): `rls_caller_covers_permission(org, key, scope)` (scope ranks
    mirror `scopeCovers`; D21's `org.admin`@organization exemption included)
    and `rls_caller_may_set_role_permission(role, key, scope)`, which carries
    the whole §4.4 write predicate for `org_role_permissions`
    INSERT/UPDATE/DELETE: tenant floor + `org.role.manage` gate + D16
    (`permissions.assignable` — `org.admin` is never granted, moved into, or
    withdrawn, and the check precedes the ownership exemption) + no self-edit
    unless the caller holds `org.admin`@organization (D21) + the caller's own
    scope covering the stored scope (removal, the USING clause) and the new
    scope (addition, the WITH CHECK clause).
  - The last-`org.role.manage`-holder guard as two BEFORE DELETE/UPDATE
    triggers (`guard_org_roles_last_role_manage_holder`,
    `guard_org_role_permissions_last_role_manage_holder`) that lock the
    organization row `FOR UPDATE` and then count the remaining holders — R29:
    a `USING` subquery alone is not atomic under READ COMMITTED. Both skip
    non-`authenticated` roles (like `guard_system_org_role_identity`) and FK
    cascades (`pg_trigger_depth() > 1`), so org deletion and test cleanup do
    not raise on their own last holder; the concurrency property was proven
    by hand on the stack (two sessions deleting the last two holders: one
    commits, the other gets 42501, exactly one row remains) and is also an
    integration test.
  - A closing guard (R26) asserting per **clause**, not on the
    `qual || with_check` concatenation (the 2b-3/2b-5 lesson): all six
    policies exist; `org_roles` INSERT's `with_check` carries the tenant
    floor + gate + `is_system` refusal, UPDATE's `using` **and** `with_check`
    each carry the tenant floor + gate and neither carries the `is_system`
    conjunct (a re-added conjunct fails the guard — it would refuse
    legitimate system-role edits), DELETE's `using` carries all three;
    `org_role_permissions` INSERT's `with_check`, UPDATE's `using` **and**
    `with_check`, and DELETE's `using` each carry the §4.4 helper; both
    helpers exist as security-definer with `search_path` pinned and EXECUTE
    for `authenticated`; both last-holder triggers exist with the lock, the
    gate key, the `auth.role()` and the depth checks in their bodies; and the
    `guard_org_role_system_flip` trigger exists, security-definer, and its
    body mentions `is_system`, `IS DISTINCT FROM`, `auth.role()` and 42501.
- **Tests**: new `__tests__/integration/org-role-editor-guards-rls.test.ts`
  (24 tests, all through PostgREST as signed-in sessions): system-role
  delete/insert/rename refusals with surviving-row assertions; the
  `is_system` flip refused in **both** directions by the flip trigger; a
  positive control that an `org.role.manage` holder can update a system
  role's `description` and the row persists; scope coverage refusals
  (own-only holder cannot grant at organization, cannot delete/update a row
  stored at organization, can write at own — positive control); self-edit
  refusal and the D21 org.admin self-edit positive control; D16 `org.admin`
  insert/update/delete refusals including by an org.admin holder; last-holder
  refusals for the permission-row DELETE, the key-moving UPDATE and the role
  DELETE, each with a second-holder positive control; the two-session
  concurrency test; and guard tests that weaken the DELETE conjunct, drop
  the UPDATE `with_check` gate, re-add the UPDATE `is_system` conjunct,
  strip the helper from one UPDATE clause, or drop either trigger, and
  assert the closing guard raises. The replay suite
  `org-role-manage-rls.test.ts` moved to the new file and its holder
  role now carries the key it writes (the §4.4 coverage rule applies to it
  too). `database.ts` regenerated with the pinned CLI — the diff is exactly
  the two new RPC signatures, byte-identical on a second run. `d9cffd42`
  adds the API half: `__tests__/integration/org-role-editor-guards-api.test.ts`
  (template-create 403 with no role row on an over-authority preset, blank
  preset still allowed for a caller with no permissions, D21 `org.admin`
  positive; `deleteRole` 200 with a second holder and 409 keeping the row on
  the last gate holder; the service-level CONFLICT with the trigger live)
  plus new unit cases in `org-role.service.test.ts`.
- **API/data-plane divergences — closed in `d9cffd42` (the service half of
  the guards):** (1) `createRole` now authorizes every template row
  **before any write** — `grantDenied` restates the §4.4 predicate (D16
  assignability, D21 ownership exemption, caller-scope coverage) and is
  shared with `setPermissions`, so the two cannot drift — and answers 403/422
  with **no role row written**, where the RLS-only first version failed at
  the table (42501) only after the insert; (2) `deleteRole` now counts the
  org's other `org.role.manage` holders (`countOtherGateHolders` — raw
  stored rows, no scope filter, so a legacy `any` row still counts, exactly
  the predicate the RLS triggers count) and answers `CONFLICT` (409)
  **before the delete** when the role is the last holder; the
  `guard_org_roles_last_role_manage_holder` trigger's 42501→403 is only the
  concurrency backstop.
- **D25 / `org_members` SELECT asymmetry: stays with phase 5 (2b-9).** 2b-4's
  reader census is unchanged — the readers the narrowing would empty still
  need keys D25 does not name — so this slice records the asymmetry as
  deliberate and does not narrow the policy.
- **`can_assign_org_role`'s "grant only what you hold" gap: untouched**, owned
  by phase 5 as recorded in ADR-0015 §4.4 (2b-5 note).
- **Mutation gate:** `bun run mutate` drives unit tests only and this slice
  changes no unit-tested code, so there is nothing for it to kill; the RLS
  invariants are proven by the integration suite above plus the by-hand
  probes (each refusal re-run manually on the stack, including the
  concurrency race).
- **Gates:** `env:ensure --profile api`, `env:reset-db --yes` (twice — the
  file applies cleanly from scratch), the full serial integration run
  (109 files, 1019 passed, 11 skipped), `test:unit`, `typecheck:all` +
  `typecheck:admin`, `lint:all`, `review:static`, `knip`, `dup:base`,
  `format:check`, `pr:size`. No build/serve/Playwright/QA.

#### 2026-11-21 — a WITH CHECK sees only the NEW row: the system-role UPDATE conjunct refused every edit and missed the flip

What: the first version of 2b-8 put `and not coalesce(is_system, false)`
into the `org_roles` UPDATE `with check`. A `WITH CHECK` is evaluated
against the NEW row, so the conjunct refused **every** PostgREST update of
a system role — including the description / display_name /
`entitlement_profile` edits `updateRole` allows — while the flip it targeted
was not caught at all: `guard_system_org_role_identity` (20261024124756)
checks only `OLD.is_system`, so a `custom → is_system` UPDATE passed it.
Why: a row policy decides which **rows** may be written; "this column may not
change" is a property of the OLD→NEW transition, and a `WITH CHECK` cannot
see the OLD row to express it.
Fix: the conjunct is dropped from the UPDATE `with check` (INSERT and DELETE
keep it), a bidirectional `BEFORE UPDATE` `guard_org_role_system_flip`
trigger refuses `NEW.is_system IS DISTINCT FROM OLD.is_system` in either
direction (42501 on the `authenticated` surface), and the closing guard
became clause-aware — `qual` and `with_check` are asserted separately,
including the negative assertion that neither UPDATE clause carries the
`is_system` conjunct, so re-adding it fails the guard (`7be9988a`). Review
note (F7): an `UPDATE org_role_permissions SET org_role_id = <other same-org
role>` on the last holder's gate row is refused by
`guard_org_role_permissions_last_role_manage_holder` even though the org
would keep a holder after the move — the BEFORE UPDATE count excludes
`OLD.org_role_id` and cannot see the row's new home; fail-closed,
unreachable through the editor (which writes per role and answers its own
409 first), accepted.
Rule: R30.

**2b-9 delivered on `feat/authority-2b-9` — slice 9 of 9 (the phase-2 closure:
the deferral register and its guard; no product code, no migration, no seed,
no phase-5 enforcement):**

- **Guard** `__tests__/unit/guards/persona-gates.test.ts` (8 tests, source
  scan, no DB). It walks every `apps/web/src/app/(backend)/api/v1/**/route.ts`
  and asserts the set of `allowedAccountTypes` occurrences is **exactly** the
  four declared exceptions, each with a named reason — `organization/route.ts`
  and `teacher/classrooms/route.ts` POST (R5: org creation, classroom
  creation), `ai/chat/route.ts` and `ai/usage/route.ts` (phase 5: the `ai.chat`
  audience) — and that every declared file still exists and still carries its
  gate, so a stale allowlist entry fails. It also scans
  `packages/server/src/controllers` and `packages/server/src/services` for a
  real `allowedAccountTypes: [` usage (a route-authority mechanism below the
  route layer); comment/string mentions lack the call shape and are not
  flagged. Failure messages name `file:line` and the remedy: authorize with
  `withAuth()` + a catalog permission, or add a declared exception with a phase
  owner. Hand-proven red in all three directions — a fifth gate appended to
  `flashcards/route.ts`, the `ai/usage` gate removed, a gate appended to
  `flashcard.controller.ts` — each run red, each reverted, re-run green.
  `bun run mutate` does not apply: the guard's input is the whole route tree,
  not one tracked production line, so the proofs were done by hand.
- **Audit (R9 — every number below was produced by the command shown, not
  remembered):**
  - `git grep -n "allowedAccountTypes" -- "apps/web/src/app/(backend)/api/v1"`
    → exactly four hits: `ai/chat/route.ts:73` and `ai/usage/route.ts:11`
    (`[STUDENT, EDUCATOR]`), `organization/route.ts:24` and
    `teacher/classrooms/route.ts:24` (`[EDUCATOR, MANAGER]`). Nothing else
    remained, so there was no stop-and-report finding.
  - `git grep -n "requireFeature(" -- apps packages` → only `branding`:
    `apps/web/src/app/(backend)/api/v1/organization/[id]/logo/route.ts:34` and
    `packages/server/src/controllers/organization.controller.ts:108`, plus the
    two definitions (`packages/server/src/lib/features.ts:14`,
    `packages/server/src/services/feature.resolver.ts:194`). No legacy marker
    caller survives.
  - Live stack `stack-b97ab97290af` (this branch, `bun run env:ensure
--profile api`; SQL over the stack's `DB_URL` with the `postgres` driver):
    - policies whose `qual`/`with_check` name `has_org_feature` or
      `is_org_manager`: **0**;
    - rows of the four deleted markers in `org_role_features`,
      `plan_entitlements`, `user_feature_overrides`, `entitlement_flags`:
      **0 / 0 / 0 / 0**;
    - `permissions`: **44** rows; `entitlement_catalog`: **6** keys
      (`advanced.stats`, `ai.chat`, `branding`, `flashcards`, `quiz`,
      `quiz.builder`);
    - policies still reading the JWT `account_type`: **2** (`quiz_attempts`
      "Own or staff quiz attempts", `exposure_events` "Exposure events
      readable by owner or org staff"); functions still reading it:
      `get_teacher_activity_feed`, `get_teacher_group_performance`,
      `rls_caller_is_sealed_item`, `handle_new_user` (the last mints
      `app_metadata`, it decides nothing).
- **Deferral register** — every remaining branch that still decides authority
  outside the permission model, each with its owning phase:

  | Branch                                                                                                              | file:line (live-verified where marked)                                                                                                      | Phase | Why it is not authority-modelled yet                                                                                                                                                                               |
  | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `resolveScope` persona default: no active org + student/educator + content verb → `own`                             | `packages/server/src/lib/authz.ts:46`                                                                                                       | 5     | §6.3's personal-content rule — inside an org the role row is the whole answer; the no-org default still keys on persona until personal-scope permissions ship                                                      |
  | Seal: staff get an empty seal                                                                                       | `packages/server/src/lib/question-seal.ts:183` + SQL `rls_caller_is_sealed_item` (live def)                                                 | 5     | the student/staff split over sealed answer keys should key on `assignment_targets`, not the JWT persona                                                                                                            |
  | Exposure recorded only for a STUDENT caller                                                                         | `packages/server/src/services/assessment-review.service.ts:202`                                                                             | 3     | #1172: a staff preview must not mint a learner event; phase 3's eligibility consumes the ledger                                                                                                                    |
  | Org-wide report inbox needs MANAGER persona + system role name `admin`                                              | `packages/server/src/services/question-report.service.ts:444` (recipient fallback `:116`)                                                   | 5     | should be `org.report.manage` — D13 says a student-persona Admin must reach it                                                                                                                                     |
  | Bank export refuses a STUDENT persona                                                                               | `packages/server/src/services/question-transfer.service.ts:56`                                                                              | 5     | the staff branch right below already checks `question_bank.update`; the persona conjunct is the redundant legacy half                                                                                              |
  | Topic default visibility `group` for EDUCATOR                                                                       | `packages/server/src/services/topic.service.ts:39,222`                                                                                      | 5     | visibility should derive from the `topic.*` scope and the group share, not persona                                                                                                                                 |
  | Billing owner resolved only for MANAGER persona                                                                     | `packages/server/src/services/billing.service.ts:109` (`ownerFromContext`), `packages/server/src/lib/payment/billing-read.repository.ts:77` | 5     | ADR §7.1's 2b-4 note: derive the owner from `activeOrgId` + membership — a product decision (a member's personal subscription inside an org would stop reading)                                                    |
  | Org checkout requires a role-name admin (`isOrgAdmin`)                                                              | `packages/server/src/lib/payment/checkout-rules.ts:87` (`resolveCheckoutOwner`), `packages/server/src/lib/payment/stripe-repository.ts:188` | 5     | the resolver is shared with the mock-completion path (no ctx) and names a target org that need not be the active one; it should check `org.billing.manage` there                                                   |
  | Org delete authorizes via `rls_caller_is_org_manager` → `is_org_manager` → `has_org_feature('member.manage')`       | `packages/server/src/services/organization.service.ts:305` (live defs of all three)                                                         | 5     | should be `org.admin`; the marker rows are gone, so today only the system-Admin branch of `has_org_feature` can answer true — a role-name check in disguise                                                        |
  | `getMyPlan`: seat plan for non-MANAGER, org plan for MANAGER; paid org plan demoted to the free manager tier        | `packages/server/src/services/subscription-plan.service.ts:172,176,256`                                                                     | 4     | plan composition keyed on persona instead of seat/org scope (D2/D3)                                                                                                                                                |
  | Personal plan applies inside an org only for non-MANAGER                                                            | `packages/server/src/services/personal-plan.ts:21`                                                                                          | 4     | same persona-keyed plan composition                                                                                                                                                                                |
  | Plan applicability: `resolveApplicablePlan` answers FORBIDDEN when `plan.forAccountType` names another persona      | `packages/server/src/lib/payment/checkout-rules.ts:34,59`                                                                                   | 4     | plan composition/applicability keyed on `forAccountType` — same family as the `getMyPlan`/`personal-plan` rows                                                                                                     |
  | `can_assign_org_role` checks `org.invitation.manage` only — the §4.4 "grant only what you hold" conjunct is missing | `supabase/migrations/20261120170000_class_invites.sql:292` (live def)                                                                       | 5     | ADR §4.4's 2b-5 review note owns the conjunct                                                                                                                                                                      |
  | `org_members` SELECT stays membership-wide                                                                          | live policy "Own or same-org membership read"                                                                                               | 5     | D25: narrowing would empty readers whose gates are not among the four keys (the 2b-4 census: org detail, report inbox, role counts, group roster, assignment target validation, teacher stats, `with-auth` itself) |
  | `teacher_assignments` org-wide SELECT                                                                               | live policy "Visible teacher assignments"                                                                                                   | 5     | its readers (student attempt flows, cohort helpers) are audited in phase 5 (20261120190000's comment)                                                                                                              |
  | `quiz_attempts` staff branch reads `account_type IN ('educator','manager')`                                         | live policy "Own or staff quiz attempts"                                                                                                    | 5     | shared multi-reader path — five services read `quiz_attempts` under different keys (2b-6 note)                                                                                                                     |
  | `exposure_events` staff branch reads `account_type`                                                                 | live policy "Exposure events readable by owner or org staff"                                                                                | 5     | together with phase 3's eligibility (#1172)                                                                                                                                                                        |
  | Teacher-dashboard RPCs return empty for a non-educator/manager persona                                              | `get_teacher_group_performance`, `get_teacher_activity_feed` (20261028100100; live defs)                                                    | 5     | should key on `stats.read` / group teacher, not the JWT                                                                                                                                                            |
  | 403-vs-404 asymmetry applied per service by hand (foreign org → NOT_FOUND, same-org unreadable → FORBIDDEN)         | `packages/server/src/services/quiz-teacher.service.ts:31,87` (`foreignOrgError`)                                                            | 5     | §7.1's rule (404 not-a-member / 403 lacks-permission) is hand-applied per service; the enforcement matrix owns making it uniform                                                                                   |
  | `teacher-assignment.service.create` with no active org fails only at the RLS tenant floor — no API-level org check  | `packages/server/src/services/teacher-assignment.service.ts:324`                                                                            | 5     | the controller gates `assignment.create` but not the org binding of the inserted row                                                                                                                               |
  | `seatEligible` metadata not yet consumed by pool validation                                                         | `packages/authz/src/entitlements.ts:18,36-71`, `entitlement_catalog.seat_eligible` (20261119140000:57)                                      | 4     | MGR-SEAT-01 / D15: the pool's `plan_key` must be `scope='personal'` + `seatEligible` — phase 4 owns `addPool`                                                                                                      |

  **2026-11-22 (phase 4a): the four rows owned by phase 4 are closed** —
  `getMyPlan` (seated → seat plan, else org plan with `org.billing.manage`,
  else personal; `subscription-plan.service.ts`), `personal-plan.ts` (deleted;
  the scope rule lives in `entitlement.resolver.ts`), `resolveApplicablePlan`
  (`checkout-rules.ts`: audience check on personal plans only, FORBIDDEN for an
  org plan with no org id), and the `seatEligible` row (`seat.service.ts#addPool`
  reads `seat_eligible` from the live `entitlement_catalog` in one query).

- **QA map:** no case changes — this slice changes no product behaviour, and
  SEC-07 still pins the two `ai/*` persona gates as the phase-5 deferral.
- **Gates:** `test:unit`, `typecheck:all` + `typecheck:admin`, `lint:all`,
  `review:static`, `knip`, `format:check`, `pr:size`. No build/serve/Playwright;
  the api stack used for the live audit (`stack-b97ab97290af`) is stopped
  before this slice finishes.

#### 2026-11-21 — phase 2 closes with a deferral register

What: the plan's 2b-9 line said "deferred to phase 5 — documentation plus
whatever is genuinely left", and closing phase 2 needed two proofs prose
cannot give: that the four remaining `allowedAccountTypes` really are the only
ones on the API surface (a fifth gate added anywhere must fail something), and
that the remaining persona branches are enumerated with owners instead of
remembered. The first closure draft was a docs paragraph claiming "only the
four exceptions remain"; nothing enforced it.
Why: R5's audit was a one-time grep, and the persona branches that survive in
services and SQL (the register above) had no single list — each 2b slice
recorded its own deferral in its own note (ADR §7.1's 2b-4/2b-6 notes, §4.4's
2b-5 review note), so "what is left" was scattered across dated notes and a
reader could not tell a closed item from an open one.
Fix: 2b-9 ships the register in this block (each row: branch, `file:line`,
owning phase, why) plus `__tests__/unit/guards/persona-gates.test.ts`, which
pins the route-layer half — exactly the four declared exceptions, stale
declarations fail, no persona gate in controllers/services — with the live
DB numbers measured on this branch's stack (0 marker-helper policies, 0/0/0/0
marker rows, 44 permissions, 6 entitlement keys). The three red proofs were
done by hand (fifth gate / removed gate / controller gate) because `bun run
mutate` needs one tracked production line and this guard's input is the route
tree.
Rule: R31.

### Phase 3 — entitlements and limits

**3a active on `feat/authority-3a` (2026-11-21).** The single entitlement
resolver ships: `packages/server/src/services/entitlement.resolver.ts`
(`resolveEntitlements(ctx)` — the only reader of `plan_entitlements`,
`org_role_features` (revoke-only, D19), `org_roles.entitlement_profile`,
`entitlement_flags`, `user_feature_overrides`, `org_seat_*`,
`organizations.plan`, `profiles.personal_plan_key`), memoized once per
request on the ctx (instance-level `WeakMap` keyed on the ctx object — no
change to the shared `RequestContext` type, nothing extra serializable on
ctx, and the entry dies with the request). `FeatureResolver` is deleted;
`lib/features.ts` is the thin wrapper (`resolveFeatures`/`getEnabledFeatures`/
`requireFeature`, same 403 + `x-error-code` semantics) until phase 6. The
rollout layer is dropped: migration `20261121160000` drops
`entitlement_flags.rollout_percentage` (CHECK goes with it), and
`EntitlementResolution.rollout` / `rolloutBucket` / the admin flag field go
with it; `/features/me` keeps its body minus `rollout`. Flags are a kill
switch only and a **missing row fails closed**; an active override beats a
flag (D26); the personal layer inside an org is the `personalPortable`
whitelist; the seat plan intersects the ceiling; an entitlement whose quota
resolves to 0 is not effective (`requireFeature` fails on it too). The
resolver's `limits` field is still composed through `LimitsResolver`
(TEMPORARY, replaced by the in-resolver composition in 3b).

**3b delivered on `feat/authority-3b` (2026-11-21).** The limits composition
moved into `EntitlementResolver` (§6.2 truth table): `scope:'user'` keys take
`max(org, seat, personal)` with `-1` short-circuiting, `scope:'org'` keys come
from the verified org's plan only (0 outside one), a missing `plan_limits` row
is `0` + warn in every path. The composition is batched — one
`plan_entitlements` and one `plan_limits` read (`.in('plan_key', …)`) for all
layer plans, and the org layer plus the seat pool ride FK embeds on the
`org_members` / `org_seat_assignments` rows — so one resolution is at most
seven queries, one per table, never a per-limit fan-out (pinned by
`entitlement.resolver.limits.test.ts`; 7 in the full org+seat case, 5 outside
an org). Membership is verified **before** the seat plan is consulted, so a
forged `active_org_id` plus a stale seat row resolves the personal plan for
user keys and 0 for org keys — the 3a review's deferred note is closed for
limits (entitlements already verified). `limits.resolver.ts` is deleted;
`services/limits.ts` keeps the public helpers (`checkLimit`, `checkOrgLimit`,
`getUsage`, `getEffectiveLimit`, `trackTokenUsage`) — all but `checkOrgLimit`
are wrappers over `resolveEntitlements`, while `checkOrgLimit` still reads
`organizations` + `plan_limits` directly because it runs before membership
exists — with `limitsResolver` preserving the call-site shape, so the 8
`checkLimit` services, `ai/chat/route.ts` and `ai-usage.controller.ts` only
changed their import path. `/me/plan` keeps `PlanInfo.key`'s historical
value (seat → seat plan, manager member → org plan, else personal — now
membership-verified through the resolver) and its `features`/`limits` became
the effective resolved set/limits, with the union `sources` added (D28).
`/api/v1/ai/usage`'s `plan` now reports the effective primary (org first);
no web or QA reader asserts the old personal-key value (recorded as D30).

**3c delivered on `feat/authority-3c` (2026-11-22).** The legacy snapshot
writer leaves: migration `20261122120000_org_plan_writer_removed.sql` replaces
`apply_org_plan` with `change_org_plan(p_org_id, p_plan)`, which validates the
org and plan (`P0002`) and moves `organizations.plan` — nothing else. The org
layer is derived live (`plan_entitlements`/`plan_limits` plus
`org_roles.entitlement_profile`), so a snapshot write could only drift (D31).
`apply_entitlement_fenced` keeps its owner/fence logic and calls the new
function; `handle_new_organization` creates the three roles with their profiles,
calls `seed_system_role_permissions`, and writes no per-role feature rows;
`has_org_feature` loses every row-existence gate — an enabled row is inert in
both readers, so `NOT EXISTS (enabled row)` would let one stray row deny a
whole role — and composes the resolver's order: profile − revokes + seat ∩
ceiling, with the revoke subtraction inside the profile arm, so a seat key
(which runs after the revokes) re-adds a revoked one (R34). One divergence
stays deliberate and is recorded in the function comment: the
`(is_system AND name = 'admin')` wildcard has no resolver counterpart (admin is
profile `all` ∩ ceiling) and keeps the deferred org-delete path working until
phase 5 owns the alignment. The migration deletes every inert grant row
(`DELETE … WHERE is_enabled`) and keeps revoke rows readable until phase 7
(D27); its closing guard pins the dropped/added functions, the two callsites,
that `change_org_plan` names `organizations` and none of `org_role_features`,
`plan_limits`, `org_role_permissions` or `plan_entitlements`, the twin's single
`org_role_features` reference (the revoke subtraction) with no positive
`is_enabled` predicate, the zero enabled rows and the revokes-only table
comment, and is replay-safe. The `is_enabled` column keeps its `true` default:
with the existence gate gone an enabled row is inert, so an accidental insert
changes nothing, whereas a `false` default would silently revoke that key.
`database.ts` is regenerated
with the pinned CLI (two RPC signatures changed, then a byte-identical second
run). The service and the QA seeder call `change_org_plan`; the admin feature-flag
DELETE path is removed (a missing flag row fails closed, so deleting a flag is
an invisible global kill switch — a flag is toggled, not deleted) and
`/user-overrides` records D26's active-override precedence.

**3d delivered on `feat/authority-3d` (2026-11-22).** D29 lands: the Teacher system
role reads content at `group` and writes at `own` (`group` ⊇ `own` in the API layer),
`assignment.read` included; `stats.read` stays `group` and the Member role is untouched
(`stats.read` at `own`, its other content reads at `group`). Three writers had to agree,
and two of them were the trap:

- `SYSTEM_ROLE_TEMPLATES.teacher` (`packages/authz/src/lib/org-roles.ts`) is the
  TypeScript matrix: `key.endsWith('.read') ? 'group' : 'own'` over the content keys,
  group keys at `group`.
- `seed_system_role_permissions`' teacher `CASE` is re-created in
  `20261122140000_teacher_group_reads.sql` from its **newest** definition
  (`20261119211000` re-created the body for the `permission_key` rename; the body in
  `20261119180000` is history, and editing it would have changed nothing a fresh
  reset then overwrites).
- Existing `org_role_permissions` rows: the seed never rewrites them because
  `on conflict do nothing` is load-bearing (a re-seed must not overwrite a role-editor
  edit), so the template and the callable seed agree only for **new** rows. The
  migration backfills every system-Teacher content `.read` row to `group` (writes stay
  `own`; custom roles and the Admin/Member roles are not touched), calls the seed for
  every org, and closes with an idempotent guard that cross-joins
  `org_roles × permissions` and requires one content row per key — reads `group`,
  writes `own`. A replay passes; a later template/function change that forgets the
  rows raises.

The live-context pin is `__tests__/integration/content-route-permission-api.test.ts`:
a seeded Teacher's `/permissions/me` carries `deck.read`/`assignment.read`/`stats.read`
at `group` and `deck.create`/`deck.update`/`assignment.update` at `own`, it reads a
deck the Admin shared to its class (list + detail) and gets **403** on the same deck's
PUT/DELETE, while a Member still reads it. `entitlement-profile.test.ts` pins the seeded
matrix, the template↔SQL equality and the backfill itself (a Teacher read forced to
`own` is restored to `group`; a custom role's identical row is left alone);
`__tests__/unit/lib/org-roles.test.ts` pins the
three `SYSTEM_ROLE_TEMPLATES` arms against `PERMISSIONS`. The QA workaround from 2b-3 is
retired: the `EDU-DECK-01`/`EDU-TOP-01` profiles name `orgRole: "teacher"` again and
their rationale cites the Teacher role, and `MGR-SEAT-03` keeps two **Member** seat
holders but moves the control to `users.student2` — a `pro` seat is role-aware and
refuses an org Teacher, so the educator could not be the untouched control once it held
its real role.

**Difficulty log**

#### 2026-11-21 — the design's "equivalent for today's catalog" was not

What: the phase-3 design pass claimed switching the personal layer inside an
org from the `ORG_SCOPED_ENTITLEMENTS` blacklist to the `personalPortable`
whitelist was "equivalent for today's catalog". It is not: `flashcards` and
`quiz` are personal-scope but `personalPortable: false`, so inside an org a
personal plan no longer re-adds them — they come from the org layer (profile
∩ ceiling, seat ∩ ceiling) now. The ported unit cases pin the differing keys
(`__tests__/unit/services/entitlement.resolver.test.ts`).
Why: a blacklist and a whitelist are only equivalent when the catalog metadata
already partitions the key space; `scope` and `personalPortable` are two
different axes, and the catalog crosses them.
Fix: the whitelist ships (D3); the differing keys are pinned in tests.
Rule: R32.

#### 2026-11-21 — the ≤7-query target was unreachable with flat per-table reads

What: the design's "one query per table, target ≤7" for one `resolveEntitlements`
call assumed ~7 tables are read; the resolver actually reads 11 (`org_members`,
`organizations`, `org_roles`, `org_role_features`, `org_seat_assignments`,
`org_seat_pools`, `profiles`, `plan_entitlements`, `plan_limits`,
`user_feature_overrides`, `entitlement_flags`). Flat per-table reads cost 11 in
the full org+seat case — and the pre-3b code was worse still, because every
`getEffectiveLimit` call re-ran the membership/seat/org lookups per limit key.
Why: the target is only reachable by riding FK embeds — the org plan, role
profile and revoke rows embed on the `org_members` row, the seat pool on the
`org_seat_assignments` row, and `plan_entitlements`/`plan_limits` batch over
`.in('plan_key', …)` — which lands at exactly 7 (5 outside an org), pinned by a
unit test that counts `from()` calls.
Fix: embeds + batched catalog reads ship in 3b; the count is pinned, not
remembered.
Rule: R33.

#### 2026-11-22 — "any row" became "any revoke" when the table flipped

What: `has_org_feature`'s profile fallback was guarded by
`NOT EXISTS (SELECT 1 FROM org_role_features WHERE org_role_id = r.id)`. That
worked while the table held plan grants: a role with rows was row-sourced, a
zero-row role fell back to its profile. Phase 3c deletes the grant rows and
redefines the table as revokes-only, so the same predicate now means "this role
has no revokes" — a role with one revoke would have skipped its profile
entirely, and the role layer would resolve to nothing.
Why: row existence stopped being evidence of grant provenance. A predicate that
reads "any row" encodes the table's old polarity, not the authority it means.
Fix: the existence gate is gone — an enabled row is inert in both readers — and
the twin composes profile − revokes + seat ∩ ceiling, with the revoke
subtraction inside the profile arm, so the seat (which runs after the revokes)
re-adds a revoked key. Pinned by the revoke and seat cases in
`entitlement-profile.test.ts`.
Rule: R34.

#### 2026-11-22 — the template and the callable seed agree only for new rows

What: D29 changes the Teacher matrix, but three writers carry it and only two are
code: the TypeScript template, `seed_system_role_permissions` (which creates rows) and
the rows already in `org_role_permissions`. The callable seed is deliberately
`on conflict do nothing` — it must not overwrite a role-editor edit on re-seed — so it
never updates an existing Teacher row. A template + function change alone leaves every
live organization on the old `own` reads, and the mutation test agrees with the
template while the database disagrees with both. The live function is also not the
file the phase note named: `20261119211000` re-created the body for the
`permission_key` rename, so editing `20261119180000` would have been inert.
Why: a scope change is a data migration too. "Seed" means insert-if-absent; it is not a
reconciler, and a matrix change is exactly the case where existing rows are the
population that matters.
Fix: the new migration re-creates the function from its newest definition, backfills
existing system-Teacher content `.read` rows to `group` (writes, custom roles and the
Admin/Member roles untouched), calls the seed for every org, and closes with an
idempotent `org_roles × permissions` guard that requires one content row per key with
reads `group` / writes `own`. `entitlement-profile.test.ts` keeps pinning the seeded
matrix and the template↔SQL equality on a fresh org.
Rule: R35.

Carried from 2b-3, **closed in 3d**: the Teacher template granted every content key at
`own` while Member reads at `group`, so a Teacher could not read content shared to a
class it is in though ADR-0015 §4.2 says `own`/`group`. 3d moves the Teacher reads to
`group` (writes stay `own`) in the template, the callable seed and a backfill, with the
matrix guard above.

### Phase 4 — seats and personal

**4a delivered on `feat/authority-4a` (2026-11-22; D32–D34).** Phase 4a is the
plan scope/audience cutover, the `solo` manager plan and the licence
(`org_seat_pools`) validation. Phase 4b — the seats page behaviour/UX and the
QA case-text rewrite — is owned by the next agent; only mechanical edits landed
here.

- **Migration** `20261122150000_plan_scope_audience_solo.sql` — replay-safe
  (drop-if-exists / idempotent inserts), proven on a fresh `db reset` (whole
  chain + seeds) and by hand-replaying the file on the live DB (exit 0, NOTICE
  only), and it works on a DB with the seeded catalog and on an empty one:
  `subscription_plans.scope`/`audience` + the pair CHECK, fail-closed backfill
  from `for_account_type` (an unknown value raises 22023 — proven by a hand
  mutation), `DROP COLUMN for_account_type` in the same migration; `solo`
  inserted (personal/manager, price 0, `flashcards`+`quiz`, and the free
  tier's eight limit rows spelled out — not copied from `base`, which does not
  exist yet on a catalog-less `db push`, and a missing limit row resolves to 0); manager profiles holding an organization-scope plan backfilled to
  `solo`; `profiles.account_type public.account_type NOT NULL DEFAULT
'student'` backfilled from `auth.users.raw_app_meta_data` (fallback
  `'student'`); `org_seat_pools.plan_key` FK added after an abort-with-message
  check for pools pointing at non-personal plans; `handle_new_user()`
  re-created (managers → `solo`, and it writes `profiles.account_type`); a
  closing `do` block pins every one of those states (CHECK conformance, `solo`
  shape, `solo`'s eight limit rows, all personal-plan keys `seatEligible`, no
  manager on an org-scope plan, the FK exists, `handle_new_user` mentions
  `solo`).
- **Seeds** `00_plans.sql` moved to `scope`/`audience` (organization plans carry
  NULL), `solo` added with its entitlements and limits (comment: mirrors
  `base`).
- **`database.ts`** regenerated with the pinned CLI 3.1, twice, byte-identical
  (R2).
- **`SeatService`**: `addPool` validates the licence before writing — the plan
  must exist, be active, be `scope='personal'`, and every entitlement key of the
  plan must be `seatEligible` per the live `entitlement_catalog`, all in one
  embed query; refusal is 422 with a field error on `planKey` (the same shape as
  the old tier refusal). `assignSeat` reads the target's `profiles.account_type`
  and requires it to equal the pool plan's `audience` (unresolved →
  `BAD_REQUEST`). `PLAN_TIER_MAP`, `ROLE_TIER_MAP` and `embeddedRoleName`
  deleted; the pool-capacity and unique-seat guards are unchanged.
- **`PlanInfo`**: `scope`, `audience`, derived `seatEligible` (≥1 entitlement,
  all `seatEligible`); `forAccountType` removed. `listActive({ scope,
audience })` and the route's `?scope=`/`?audience=` params (no params ⇒ every
  active plan).
- **`getMyPlan`**: seated → seat plan; else verified org + `org.billing.manage`
  → org plan; else personal (D34 — no `AccountType.MANAGER` branch).
  `getPersonalPlan` returns the stored plan (the demotion fallback is deleted).
- **`EntitlementService`**: `isOrganizationPlan` = `scope==='organization'` (no
  price condition); `resolveFreePlan` = the free plan of the same
  scope+audience (org → `launch`, manager user → `solo`, …).
- **`checkout-rules`**: `isOrganizationPlanFamily` = `scope==='organization'`;
  `resolveApplicablePlan` refuses FORBIDDEN only for a personal plan whose
  `audience` ≠ the caller; `resolveCheckoutOwner` answers FORBIDDEN (not
  BAD_REQUEST) for an org plan without an org id — BIL-05 stays a 403.
- **Resolver**: `personal-plan.ts` deleted; inside a verified org an
  organization-scope personal plan never applies — its scope is read from the
  `subscription_plans(scope)` embed on the existing batched `plan_entitlements`
  read, so the resolution stays at ≤7 queries (pinned by
  `entitlement.resolver.limits.test.ts`).
- **Callers**: `?for=` → `?scope=&audience=` in `pricing.tsx`,
  `upgrade-plans.tsx` (manager pages `?scope=organization`, personal pages
  `?scope=personal&audience=<type>`), the load-test journey and the QA specs
  (`BIL-02`, `MGR-ACC-01`, `MGR-SET-01`, `PUB-03`, `PUB-04`); org-plan checks are
  `plan.scope === 'organization'` in `plan-card.tsx`, `plan-row.tsx`,
  `checkout-mock-form.tsx`; `pricing-ladders.ts` keeps three ladders
  (student/educator personal + organization — no manager-personal ladder, and
  `solo` appears in none); `billing-subscription.ts` alternatives key on
  scope/audience; the admin plans page has scope/audience fields + i18n keys;
  the seats page got only the two map edits (`solo` into `PLAN_TIER_MAP` and
  `PURCHASABLE_PLANS`, `campus` out of `PURCHASABLE_PLANS`);
  `user-admin.service#updateAccountType` also writes `profiles.account_type`.
- **QA specs (mechanical only — case texts and the behaviour/UX rewrite are the
  next agent's)**: `MGR-SEAT-02` buys the manager-audience pool as `solo`
  instead of `campus`; `PUB-03`/`PUB-04`/`BIL-02` filter on `scope`/`audience`.
- **Tests**: unit — seat licence refusals (organization plan, non-seat-eligible
  key, empty plan, inactive/unknown) and acceptances, persona mismatch/accept,
  checkout-rules scope rules, entitlement.service free-plan resolution, the
  resolver scope rule + query count ≤7; integration — `addPool` refuses
  `campus` and a temporary non-seat-eligible plan fixture (cleaned up in a
  `finally`) and accepts `ace`, `assignSeat` refuses a `pro` pool for an
  educator account and accepts a `solo` pool for a manager, a manager signup
  resolves `solo` (and `profiles.account_type`), `/me/plan` returns the org plan
  for an `org.billing.manage` holder and the personal plan for a plain member,
  an organization-scope personal plan stored on a profile adds nothing inside an
  org; migration guards in the closing `do` block.
- **Gates (2026-11-22):** `test:unit` 4847 passed / 1 skipped (313 files);
  serial integration over `__tests__/integration` (`--no-file-parallelism`,
  mandatory on this host) 1050 passed / 11 skipped (111 files);
  `typecheck:all` + `typecheck:admin` clean; `lint`, `review:static`, `knip`,
  `format:check` clean; the migration applied from scratch (`db reset`) and
  replayed by hand.

#### 2026-11-22 — phase 4a: what was proven red, and the two earned rules

What: D32–D34 landed on `feat/authority-4a`. The new invariants were each
proven capable of failing before they were trusted: the seat licence refusals
and the persona mismatch were mutated with `bun run mutate` (table below, all
KILLED); the SQL-only migration invariants were proven by hand mutations
recorded as such (unknown `for_account_type` → 22023 raise; replay of the
migration file on the live DB exits 0).

| Test                                                                                            | Mutation                                                                    | Verdict       |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------- |
| `seat.service.test.ts` » addPool refuses an organization-scope plan (campus)                    | accept any scope (`plan.scope === 'personal'` dropped)                      | KILLED        |
| `seat.service.test.ts` » addPool refuses a non-seat-eligible entitlement key                    | `seat_eligible === true` requirement dropped                                | KILLED        |
| `seat.service.test.ts` » assignSeat refuses a persona mismatch                                  | `profile.account_type !== poolAudience` check dropped                       | KILLED        |
| `checkout-rules.test.ts` » resolveApplicablePlan rejects another audience                       | audience check removed                                                      | KILLED        |
| `checkout-rules.test.ts` » org plan without org id answers FORBIDDEN                            | FORBIDDEN → BAD_REQUEST                                                     | KILLED        |
| `entitlement.service.test.ts` » rejects the free organization plan written to a profile         | `isOrganizationPlan` price condition restored                               | KILLED        |
| `entitlement.resolver.limits.test.ts` » organization-scope personal plan excluded inside an org | scope rule removed (personal always applies)                                | KILLED        |
| `entitlement.resolver.limits.test.ts` » exactly seven queries in the full case                  | an extra table read inserted                                                | KILLED        |
| migration guard (SQL-only)                                                                      | hand mutation: unknown `for_account_type` raises 22023; file replay exits 0 | KILLED (hand) |

Why it matters / what was tried and failed: the migration's pair CHECK
initially failed on a fresh chain because the legacy pre-catalog plans carry a
NULL `for_account_type` (the seed deletes those rows only later) — NULL must
map to the organization family, the only CHECK-valid NULL-audience shape (R36).
The seat validation reads catalog truth in the same query instead of a TS map,
because `PLAN_TIER_MAP` was a second copy of the catalog that let any plan key
mint a pool (R37).
Rule: R36, R37.

**4b delivered on `feat/authority-4a` (2026-11-22).** 4b is the seats page's
behaviour and the phase-4 QA corpus; the plan/data rules are 4a's.

- **Roster:** `organization-member.service.listMembers` selects
  `profiles.account_type` and maps it as `accountType` (D33's persona input);
  the D25 gate and the endpoint are unchanged.
- **Seats page:** `PLAN_TIER_MAP`, `ROLE_TIER_MAP` and `PURCHASABLE_PLANS` are
  deleted (R37). The purchase picker lists the catalogue's **active,
  `scope='personal'`, `seatEligible`** plans (`purchasableSeatPlans`), so it now
  offers every personal plan that is a valid licence — including the free tiers
  and `solo` — and no organization plan. The assign picker offers the pools whose
  plan `audience` equals the member's `accountType` (`poolsForPersona`), fail
  closed when the plan is missing from the catalogue. Both helpers live in
  `@/lib/seats`, are unit-tested and mutation-proven.
- **QA corpus:** `MGR-SEAT-02` is rewritten from the launch-org negative to the
  hub-org **positive** story (the operator point from 3a, closed without a
  plan-data change): the `pro` seat adds exactly `advanced.stats` to a learner's
  feature set, `/me/plan` is the seat plan with `max_ai_tokens_per_day = -1`, the
  AI limit rises from hub's 200000, `/ai/usage` reports `limit -1 / plan hub`,
  and the unseated control member stays at 200000. The seat ∩ ceiling rule is
  now pinned by `entitlement.resolver.test.ts` ("intersects the seat plan with
  the org ceiling") and the `manager-plan-model` / `limits-resolution`
  integration cases rather than by that QA case. `MGR-SEAT-01` asserts the new
  licence list (Solo in, Campus out), `MGR-SEAT-03` ties its guidance to
  persona/audience, and `BIL-04`/`BIL-05`/`PUB-03`/`MGR-ACC-01` plus the 662 plan
  record move to scope/audience wording.
- **What the served app found (all fixed in-PR):** an anonymous
  `GET /api/v1/subscription-plans` answered **403** once `PlanInfo.seatEligible`
  embedded `entitlement_catalog` — the public query gained a table `anon` may
  not select, and every session-authenticated test stayed green (R38). The
  `MGR-SEAT-02` roster's default `QA <key>` names made `QA student` a prefix of
  `QA student2` and the picker's regex matched both (the 3d collision, again);
  the „Dostępne” cell renders `1Mało` for a low pool; `BIL-02`'s catalogue read
  still interpolated the renamed `accountType` and threw at runtime (Playwright
  specs sit outside `typecheck:all`'s scope).
- **Gates (2026-11-22, served app at `:3000`):** unit **4854 passed / 1
  skipped** (315 files); serial integration **1061 tests, 1050 passed / 11
  skipped** (111 files); `typecheck:all` + `typecheck:admin`, `lint`,
  `review:static`, `knip`, `format:check`, `dup:base` (0 new) clean. QA on the
  final build: MGR-SEAT-02 **5/5**, MGR-SEAT-01 **5/5**, MGR-SEAT-03 **2/2**,
  MGR-ACC-01 3 tests, PUB-02 2, PUB-03, PUB-04, BIL-01, BIL-02 3, BIL-04 2,
  BIL-05 2, LIM-02, LIM-03, LIM-05, STU-03, EDU-02 2, SEC-06, MGR-ROL-01,
  MGR-SET-01 — all green, zero retries.

#### 2026-11-22 — phase 4b: the public-embed trap

What: 4b's QA run over the served app, not just the unit suite.
Why: `PlanInfo.seatEligible` is catalog truth, so every plan read embeds
`entitlement_catalog`. The embed is executed with the caller's role, and
`anon` had no grant on that table: the anonymous pricing catalogue started
answering 403 while every signed-in read, unit test and integration test stayed
green — the tests that would have caught it are the anon census probes, and
they were asserting the old three-table list.
Fix: `GRANT SELECT ON public.entitlement_catalog TO anon` in the 4a migration
(pricing metadata, no answer keys) and the census updated in all three places
(`grant-parity`, `anon-grants`, `rls-tenant-isolation`). The served QA run is
what surfaced it, which is why the programme keeps Playwright in the gate.
Rule: R38.

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
