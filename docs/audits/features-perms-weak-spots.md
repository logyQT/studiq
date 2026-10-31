# Audit — weak spots in the features / permissions / limits architecture

**Type:** read-only architecture audit (no code changes, no migrations, no PR).
**Audited tree:** detached `HEAD` `bd696b59` (the base of `fix/personal-plan-in-org`).
The key files audited here are byte-identical on the local `main` ref (`07a4036d`); only the
local history lineage differs.
**Issue under test:** #971 (plus #970, #695, #799, #228, #233, #182, #191).
**Fix branch inspected:** `fix/personal-plan-in-org` @ `e3f53f9c` (3 commits).
**Date:** 2026-10-31.

### Verification legend

| Marker            | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `verified (code)` | Followed the control flow / SQL by hand; the behaviour is deterministic from the source on this commit.  |
| `verified (test)` | An existing unit/integration/QA test asserts the behaviour (including tests that encode it as intended). |
| `verified (doc)`  | An accepted ADR/doc states the behaviour, and the code agrees.                                           |
| `unverified`      | Hypothesis is plausible but was not proven; listed separately at the end of the register.                |

No test suite was executed: this worktree has no `node_modules` (`bunx vitest` fails with
`Cannot find module 'vite'`). No database was queried or mutated. All SQL conclusions come
from replaying the migration/seed files in order.

---

## 1. Executive summary

The thesis is **confirmed**, but the problem is larger than #971.

1. **Entitlements and permissions share one key space.** `FEATURES` contains both product
   entitlements (`ai.chat`, `branding`, `advanced.stats`) and structural authority
   (`org.manage`, `member.manage`, `role.builder`, `group.manage`). Structural authority is
   therefore sold in `plan_features` and inherited by roles/seats/personal plans.
2. **"No role configuration" means "inherit the whole plan", including management keys.**
   A custom role created by the role builder has zero `org_role_features` rows and therefore
   inherits `member.manage` + `role.builder` + `org.manage` on any paid org plan. An
   educator holding that role can then edit its own permissions, promote members, and take
   over the org. This is the single most severe finding (`FP-01`, `FP-04`).
3. **The same `org.manage` key is an unenforced, unrevokable "is admin" marker**, while the
   RLS/API admin gate is `member.manage`, billing uses `org_roles.name = 'admin'`, and route
   access uses `account_type = manager`. There are four different definitions of
   "org admin" (`FP-05`, `FP-09`).
4. **`FeatureResolver` and `LimitsResolver` still disagree after #971**, most visibly for
   seated users: features are additive (role + seat + personal) while user-scope limits are
   _seat-exclusive_. A hub member seated on a free `base` seat has `ai.chat` in
   `/features/me` and a 0-token budget (`FP-07`).
5. **Several paid keys are not enforced at all** (`ai.chat` at the API layer, `quiz`,
   `quiz.builder`, `advanced.stats`, `documents`, `org.manage`), while structural keys are
   enforced as features (`FP-10`).
6. **RLS re-implements the resolver in SQL** with different semantics (no flags, no
   rollouts, no overrides, unconditional admin bypass), and content RLS is only a
   tenant-wide floor — `own`/`group` scopes are service-layer only (`FP-03`, `FP-11`).
7. **Cache freshness is still #799**: checkout, seat assignment, role change and flag
   changes never invalidate `/features/me` (`FP-17`).

### Top weak spots

| ID    | Severity | Title                                                                                   | Status              |
| ----- | -------- | --------------------------------------------------------------------------------------- | ------------------- |
| FP-01 | Critical | Zero-row custom role inherits the entire org plan, incl. management keys                | verified (code)     |
| FP-02 | Critical | Seat plans can grant management authority; any plan/pool can be minted without payment  | verified (code)     |
| FP-04 | Critical | `role.builder` holder can rewrite its own role's scopes (self-escalation)               | verified (code)     |
| FP-03 | High     | `own`/`group` permission scopes are not an RLS boundary on content tables               | verified (code)     |
| FP-05 | High     | `org.manage` is an unenforced, never-revoked admin marker; seated admin can lose powers | verified (code)     |
| FP-06 | High     | Management keys are purchasable `plan_features`                                         | verified (code)     |
| FP-07 | High     | Feature/limit disagreement: seat is exclusive for limits, additive for features         | verified (code)     |
| FP-08 | High     | #971's "empty means fallback" shape survives in other layers and awaits a contract      | verified (test)     |
| FP-09 | High     | Four competing definitions of "org admin"                                               | verified (code)     |
| FP-10 | High     | API enforcement gaps: paid keys enforced only in UI or nowhere                          | verified (code)     |
| FP-11 | High     | `has_org_feature` SQL twin diverges from `FeatureResolver`                              | verified (code)     |
| FP-12 | High     | Overrides can grant structural keys; applied after the admin-only strip                 | verified (code)     |
| FP-13 | Medium   | Feature keys are stored as RBAC permissions (`ai.chat`, `org.manage`, …)                | verified (code)     |
| FP-14 | Medium   | Manager plan mirror / legacy paid personal plan still enforced outside the org          | verified (doc)      |
| FP-15 | Medium   | Plan mutation paths diverge (limits live, features snapshotted)                         | verified (doc)      |
| FP-16 | Medium   | Inconsistent fail direction: missing flag = fail-open, missing plan row = fail-closed   | verified (code)     |
| FP-17 | Medium   | `/features/me` staleness and missing invalidation after checkout/seat/role changes      | verified (test+doc) |
| FP-18 | Medium   | Quota accounting is non-atomic and post-hoc                                             | verified (code)     |
| FP-19 | Medium   | Two `FEATURES` catalogs + three/four copies of the admin denylist                       | verified (code)     |
| FP-20 | Medium   | Dead/legacy keys, tables and docs encode contradictory semantics                        | verified (code+doc) |
| FP-21 | Medium   | Management surfaces use three different enforcement mechanisms                          | verified (code)     |
| FP-22 | Low      | Manager cannot use `ai.chat` although hub/campus sell it; rollout header is dead        | verified (code)     |

---

## 2. Taxonomy

### 2.1 Proposed definitions

| Term            | Definition                                                                                                                                                       | Allowed grant source                      | May grant authority over other people? |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| **Entitlement** | Access to a product surface, bought with a plan or granted as a comp. No authority over other users or the org. Portable or org-scoped by key metadata.          | plan, seat, personal plan, override       | **No**                                 |
| **Permission**  | Authority to act on a resource or on other members. Comes from a role. Never sold, never inherited from a plan/seat/purchase.                                    | role only                                 | **Yes**                                |
| **Limit**       | Numeric quota for a surface that also has an entitlement. `-1` unlimited, `0` blocked. Missing row must block.                                                   | plan/seat (same layer as the entitlement) | No                                     |
| **Flag**        | Operational gate: rollout percentage or kill switch. May only _reduce_ exposure; cannot be the source of an entitlement and should not silently void a paid one. | ops only                                  | No                                     |
| **Role**        | Named bundle of permissions inside an org. System roles (`admin`/`teacher`/`member`) or custom.                                                                  | org admin                                 | Yes (by design)                        |
| **Plan**        | Template of entitlements + quotas. Sold to a person **or** an org, never both.                                                                                   | billing                                   | No                                     |
| **Seat**        | Per-member plan assignment inside an org. May raise per-member entitlements/quotas; must never add management permissions.                                       | org admin (billing)                       | No                                     |

The current code violates the "grant source" and "authority" columns for four
keys (`org.manage`, `member.manage`, `role.builder`, `group.manage`) and for
`branding`'s write path.

### 2.2 Feature catalog — current classification

`FEATURES` is declared twice, identically:
`packages/authz/src/features.ts:5-17` and
`packages/server/src/services/feature.resolver.ts:12-24`.

| Key              | Proposed kind                              | Current grant sources                                                                                              | Scope               | Notes / ambiguity                                                                                                                                                                   |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai.chat`        | entitlement + quota                        | plan (personal/org/seat), override, flag                                                                           | personal (portable) | API checks only `max_ai_tokens_per_day`, never `requireFeature('ai.chat')`. Kill switch/override revoke does not stop the route.                                                    |
| `flashcards`     | entitlement + quota                        | plan, override, flag                                                                                               | personal (portable) | No feature gate anywhere; enforced only through `max_flashcards`. Every plan has it.                                                                                                |
| `quiz`           | entitlement + quota                        | plan, override, flag                                                                                               | personal (portable) | UI-only gate (`quiz-content.tsx:72-73`); no API/DB gate.                                                                                                                            |
| `quiz.builder`   | entitlement                                | plan, override, flag                                                                                               | personal (portable) | **No enforcement anywhere.** Free `lite`/`launch` get the same builder as `hub`/`campus`.                                                                                           |
| `documents`      | entitlement                                | plan, override, flag                                                                                               | personal (portable) | **No product surface / no enforcement.** Seed comment says "coming soon" (`20260703000003_seed_features.sql:16`).                                                                   |
| `org.manage`     | **mixed / ambiguous**                      | plan (`launch` only), custom-role inheritance, override, flag                                                      | org                 | Not a `Permission`, not checked anywhere. Sole runtime effect: marks an org admin for the seat admin-only strip (`feature.resolver.ts:138-140`). `apply_org_plan` never revokes it. |
| `group.manage`   | **permission modelled as feature**         | plan (`launch`+ all paid org plans), custom-role inheritance, seat, personal plan (outside org), override, flag    | org                 | Not in `Permission`. API gate `group.controller.ts:31,49,73,127`; DB gate `groups`/`group_members` RLS. Missing from `ADMIN_ONLY_FEATURES`.                                         |
| `member.manage`  | **permission modelled as feature**         | plan (admin only; `launch`+paid org plans), custom-role inheritance, seat (stripped unless `org.manage`), override | org                 | Not in `Permission`. The de-facto "org admin" capability (`is_org_manager`). API gate on member changes; RLS gate on membership/invites/roles/seats/org settings.                   |
| `role.builder`   | **permission modelled as feature**         | plan (admin; hub/campus/master), custom-role inheritance, seat (stripped unless `org.manage`), override            | org                 | Not in `Permission`. API gate only; DB write actually requires `member.manage` (RLS), so the two gates disagree.                                                                    |
| `advanced.stats` | entitlement                                | plan, override, flag                                                                                               | personal (portable) | **No enforcement anywhere**; free plans see all `/app/stats` pages.                                                                                                                 |
| `branding`       | entitlement with embedded write permission | plan (hub/campus), member/teacher rows when plan has it, override, flag                                            | org                 | Display is org-wide; write path is `account_type=MANAGER` + feature + RLS `member.manage`. A branding-only role can pass the feature check and still be denied by RLS.              |

### 2.3 Limit catalog

`packages/server/src/services/limit.catalog.ts:18-27`.

| Key                         | Scope | Enforced at                                                                                 |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `max_flashcards`            | user  | `flashcard.service.ts:29,81`                                                                |
| `max_decks`                 | user  | `flashcard-deck.service.ts:43`                                                              |
| `max_questions`             | user  | `question.service.ts:73`                                                                    |
| `max_question_banks`        | user  | `question-bank.service.ts:42,299`, `question-transfer.service.ts:137`                       |
| `max_quiz_attempts_per_day` | user  | `quiz.service.ts:39`                                                                        |
| `max_ai_tokens_per_day`     | user  | `/api/v1/ai/chat` via `getUsage` (`ai/chat/route.ts:49-52`), `ai-usage.controller.ts:15-20` |
| `max_students`              | org   | invite accept, `checkOrgLimit` (`invitation.service.ts:628`)                                |
| `max_groups`                | org   | `group.service.ts:97` (`checkOrgLimit`)                                                     |

Legacy `max_storage_mb` was removed (`20261025222258_remove_max_storage_mb.sql`); no code
references it.

### 2.4 Plan matrix (from `supabase/seeds/00_plans.sql`)

Legend: ✅ plan feature; — absent.

| Plan      | Type     | flashcards | quiz | ai.chat | quiz.builder | group.manage | member.manage | role.builder | advanced.stats | documents | branding | org.manage |
| --------- | -------- | ---------- | ---- | ------- | ------------ | ------------ | ------------- | ------------ | -------------- | --------- | -------- | ---------- |
| `base`    | student  | ✅         | ✅   | —       | —            | —            | —             | —            | —              | —         | —        | —          |
| `spark`   | student  | ✅         | ✅   | —       | —            | —            | —             | —            | —              | —         | —        | —          |
| `ace`     | student  | ✅         | ✅   | ✅      | —            | —            | —             | —            | ✅             | —         | —        | —          |
| `pro`     | student  | ✅         | ✅   | ✅      | —            | —            | —             | —            | ✅             | ✅        | —        | —          |
| `lite`    | educator | ✅         | ✅   | —       | —            | ✅           | ✅            | —            | —              | —         | —        | —          |
| `guide`   | educator | ✅         | ✅   | —       | ✅           | ✅           | ✅            | —            | —              | —         | —        | —          |
| `creator` | educator | ✅         | ✅   | ✅      | ✅           | ✅           | ✅            | —            | ✅             | ✅        | —        | —          |
| `master`  | educator | ✅         | ✅   | ✅      | ✅           | ✅           | ✅            | ✅           | ✅             | ✅        | —        | —          |
| `launch`  | manager  | ✅         | ✅   | —       | —            | ✅           | ✅            | —            | —              | ✅        | —        | ✅         |
| `team`    | manager  | ✅         | ✅   | —       | ✅           | ✅           | ✅            | —            | —              | ✅        | —        | —          |
| `hub`     | manager  | ✅         | ✅   | ✅      | ✅           | ✅           | ✅            | ✅           | ✅             | ✅        | ✅       | —          |
| `campus`  | manager  | ✅         | ✅   | ✅      | ✅           | ✅           | ✅            | ✅           | ✅             | ✅        | ✅       | —          |

Two facts fall out of this table:

- **`launch` is the only plan with `org.manage`**, so a fresh `hub`/`campus` org has no
  admin marker at all; only orgs created on `launch` and later upgraded keep it (because
  `apply_org_plan` never revokes `org.manage`).
- **`lite` (free educator) grants `member.manage`** as a personal entitlement. It is inert
  outside an org and is supposed to be stripped inside one — the #971 fix added that strip
  for the personal layer, but the org layer still has the same key.

---

## 3. Current precedence

### 3.1 `FeatureResolver` — audited commit (`feature.resolver.ts:111-232`)

Base layer inside an org (`:118-172`):

1. Load `org_role_features` for `ctx.orgRoleId` (`:121-128`).
2. `getSeatPlanKey(ctx)` (`:130`).
3. If seated (`:132-147`): apply role rows (if any), add seat plan features, then **strip
   `org.manage`/`member.manage`/`role.builder` unless a role row has `org.manage`**.
4. Else if role rows exist (`:148-153`): role rows are authoritative; missing key = off.
5. Else (`:154-171`): load `organizations.plan` and apply **every** plan feature. **No
   admin-only strip.**

Then:

6. Personal plan **only if `enabled.size === 0`** (`:175-185`).
7. Overrides, strongest layer (`:188-201`), expired rows ignored.
8. `feature_flags`: `is_enabled=false` removes; `rollout_percentage<100` buckets per
   `(key,userId)` (`:204-229`). A **missing flag row is no gate** (`:215-216`).

### 3.2 `LimitsResolver` — audited commit (`limits.resolver.ts:36-74`)

| Context                                   | `scope: 'user'`                | `scope: 'org'`                |
| ----------------------------------------- | ------------------------------ | ----------------------------- |
| No `activeOrgId`                          | personal plan                  | `0`                           |
| Org + seat                                | **seat plan only** (exclusive) | org plan (membership checked) |
| Org, verified member, unseated            | org plan only                  | org plan                      |
| Org id without membership (forged cookie) | personal plan                  | `0`                           |
| Missing `plan_limits` row                 | `0` + warn                     | `0` + warn                    |

`getUsage()` reports the **personal** plan key even when the limit came from the org/seat
(`limits.resolver.ts:140-147`).

### 3.3 Truth table — audited commit

Rows are contexts; cells are the effective result. `RR` = `org_role_features` rows.

| #   | Context                                                   | Features                                                                          | Limit (user)        | Limit (org) | Disagreement?                                                                                         |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| 1   | No org, free personal                                     | personal plan                                                                     | personal            | 0           | org-key quota displayed by `/me/plan` but not applicable                                              |
| 2   | No org, paid personal (`pro`)                             | personal plan                                                                     | personal            | 0           | —                                                                                                     |
| 3   | Org, member role, unseated, free org                      | member RR                                                                         | org plan            | org plan    | #971: personal plan shadowed (pre-fix)                                                                |
| 4   | Org, member role, unseated, paid personal `pro`           | member RR (pre-fix) / RR + personal (fix)                                         | org plan (pre-fix)  | org plan    | **#971** (pre-fix): `ai.chat` hidden + 0 tokens                                                       |
| 5   | Org, admin role, unseated                                 | all plan features                                                                 | org plan            | org plan    | —                                                                                                     |
| 6   | Org, teacher role, unseated                               | plan minus `member.manage`/`role.builder` (includes `org.manage`, `group.manage`) | org plan            | org plan    | `org.manage` is present in the teacher rows; it becomes an admin marker only if the teacher is seated |
| 7   | Org, seated member, seat `ace`                            | RR + ace, minus admin-only                                                        | **ace only**        | org plan    | seat may _lower_ limits vs org plan (if seat < org plan)                                              |
| 8   | Org, seated member, seat `base` (hub org)                 | RR (incl. `ai.chat`) + base                                                       | **base (0 tokens)** | hub         | **feature on, limit 0**                                                                               |
| 9   | Org, seated admin, launch-created org (has `org.manage`)  | RR + seat, no strip                                                               | seat                | org         | —                                                                                                     |
| 10  | Org, seated admin, fresh hub/campus org (no `org.manage`) | RR + seat, **stripped** `member.manage`/`role.builder`/`org.manage`               | seat                | org         | **seated admin loses admin capabilities**                                                             |
| 11  | Org, custom role (0 RR), unseated                         | **entire org plan** (incl. `org.manage`, `member.manage`, `role.builder`)         | org plan            | org plan    | **FP-01 escalation**                                                                                  |
| 12  | Org, custom role (0 RR), seated                           | seat plan, minus admin-only (if no RR)                                            | seat                | org         | `group.manage` survives                                                                               |
| 13  | Manager in org                                            | role-dependent (#3–12); pre-fix a mirrored personal plan could fill an empty org  | role/seat-dependent | org plan    | pre-fix: mirrored `campus` could fill an empty org                                                    |
| 14  | Forged `active_org_id` (no membership)                    | treated as #1 (withAuth nulls the cookie)                                         | personal            | 0           | safe                                                                                                  |
| 15  | Any + active override                                     | override adds/removes after all strips                                            | unchanged           | unchanged   | **override can grant `member.manage`**                                                                |
| 16  | Any + flag `is_enabled=false`                             | key removed for everyone                                                          | unchanged           | unchanged   | **kill switch removes a paid entitlement; route may still work**                                      |
| 17  | Any + rollout < 100                                       | key removed for buckets outside %                                                 | unchanged           | unchanged   | org members disagree about an org feature                                                             |

### 3.4 Truth table — `fix/personal-plan-in-org` (what #971 changes)

New file `packages/server/src/services/personal-plan.ts`: `personalPlanApplies(ctx,
inVerifiedOrg)` returns `false` only for `MANAGER` inside an org.

Features (`feature.resolver.ts` on the branch):

| Context          | Change                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No org           | unchanged                                                                                                                                                                                                 |
| Org, non-manager | personal plan is **always added** (not only when `enabled.size === 0`), then `ORG_SCOPED_FEATURES` (= admin-only + `group.manage` + `branding`) are removed if the org layer did not already entitle them |
| Org, manager     | personal plan skipped (mirror inert)                                                                                                                                                                      |
| Seat             | same additive logic; admin-only strip still keyed on `org.manage`                                                                                                                                         |
| Overrides        | still applied **after** all strips                                                                                                                                                                        |

Limits (`limits.resolver.ts` on the branch):

| Context              | Change                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| No org               | unchanged                                                                          |
| Org, seat            | **unchanged: seat is still exclusive** for `scope:'user'`                          |
| Org, unseated member | user keys = `max(personal, org)` with `-1` short-circuit; org keys = org plan only |
| Org, manager         | personal excluded                                                                  |
| Forged cookie        | now `0` for user keys (instead of personal)                                        |

**Conclusion:** the fix repairs the exact #971 shape for unseated users, but does **not**
establish a single resolution contract:

- a free seat still shadows a paid personal plan (`FP-07`);
- the org layer (custom role / seat) can still grant management keys (`FP-01`, `FP-02`);
- `ORG_SCOPED_FEATURES` is a second denylist, not key metadata (`FP-19`);
- `FeatureResolver` uses `Boolean(ctx.activeOrgId)` while `LimitsResolver` uses a verified
  membership check — they can still disagree on forged/direct contexts.

---

## 4. Enforcement matrix

Legend: ✅ enforced; ⚠️ partial/indirect; ❌ absent.

| Key              | Plan/seat/override grants it | API check                                                        | UI check                                                       | DB / RLS check                                                                                                            |
| ---------------- | ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ai.chat`        | ✅                           | ❌ only `max_ai_tokens_per_day` (`ai/chat/route.ts:49-52`)       | ✅ sidebar (`app-sidebar.tsx:42,97,133-155`), screens, toolbar | ❌ none                                                                                                                   |
| `flashcards`     | ✅                           | ❌                                                               | ❌                                                             | ❌ (only `max_flashcards`)                                                                                                |
| `quiz`           | ✅                           | ❌                                                               | ✅ `quiz-content.tsx:72-73`                                    | ❌                                                                                                                        |
| `quiz.builder`   | ✅                           | ❌                                                               | ❌                                                             | ❌                                                                                                                        |
| `documents`      | ✅                           | ❌                                                               | ❌                                                             | ❌                                                                                                                        |
| `org.manage`     | ✅ (launch / inherited)      | ❌ never checked                                                 | ❌                                                             | ❌                                                                                                                        |
| `group.manage`   | ✅                           | ✅ `group.controller.ts:31,49,73,127`                            | ✅ sidebar/group screens/deck detail/`use-group-options`       | ✅ `groups`/`group_members` RLS via `has_org_feature`                                                                     |
| `member.manage`  | ✅                           | ✅ `organization-member.controller.ts:29,56`                     | ❌ page is account-type gated only                             | ✅ `is_org_manager` on `org_members`, `invitations`, `organizations`, `org_roles`, `org_seat_*`; **invites use RLS only** |
| `role.builder`   | ✅                           | ✅ `org-role.controller.ts:46,68,95,116`                         | ✅ roles page (`manage/roles/page.tsx:82-88`)                  | ❌ RLS writes require `member.manage`, not `role.builder`                                                                 |
| `advanced.stats` | ✅                           | ❌                                                               | ❌                                                             | ❌                                                                                                                        |
| `branding`       | ✅                           | ✅ logo route + org update (`organization.controller.ts:93-102`) | ✅ settings/`useBranding`                                      | ⚠️ org update RLS requires `member.manage`; no branding-specific DB gate                                                  |
| `max_*` limits   | plan/seat                    | ✅ service-layer checks                                          | ⚠️ usage badge / stale cache                                   | ❌ no DB constraint; count+insert is racy                                                                                 |

### 4.1 Feature enforced only in the UI

- `quiz` — `quiz-content.tsx:72-73` hides the surface; `/api/v1/quiz/*` has no feature
  gate.
- `ai.chat` — UI gates the sidebar/screen; the API gates the _quota_ only. A user whose
  override/kill-switch removes `ai.chat` but whose token budget is positive can still call
  the route.
- `advanced.stats`, `documents`, `quiz.builder` — no UI gate either; plan differences are
  cosmetic today.

### 4.2 Permission enforced as a feature key

- `group.manage` → API + RLS, but not in `Permission`.
- `member.manage` → API + RLS (`is_org_manager`), but not in `Permission`.
- `role.builder` → API only; DB uses `member.manage`.
- `org.manage` → not enforced at all; used as a marker.

### 4.3 Permission scope (`own`/`group`/`organization`) is service-layer only

Content RLS (`20260920000001_reenable_rls_sensitive_tables.sql:69-107`) is:

```sql
created_by = auth.uid()
OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
```

So **any org member can read/write every org flashcard, deck and question through
PostgREST**, regardless of `own`/`group` scopes, `visibility='personal'`, or the role
builder. The same tenant floor applies to the tables created in
`20261024124756_rls_all_public_tables.sql` (`question_banks:717`, `topics:728`,
`quizzes:841`, `teacher_assignments:859`, …). The migration header calls this deliberate
("tenant/owner floor"), but the product presents `own`/`group` as authorization.

---

## 5. Weak-spot register

Each entry: severity, status, invariant, evidence, scenario, observed/expected, one-line fix
direction.

### FP-01 — A zero-row custom role inherits the entire org plan, including management keys

- **Severity:** Critical
- **Status:** verified (code); the unseated half is also **verified (test)**
- **Invariant violated:** Permissions come from roles; an empty role configuration must mean
  "no entitlements", not "inherit everything".
- **Evidence:**
  - `feature.resolver.ts:154-171` — `orgRoleFeatures.length === 0` → apply
    `organizations.plan → plan_features` wholesale, **no admin-only strip**.
  - `org-role.service.ts:113-146` — `createRole` inserts only `org_roles`; no
    `org_role_features` rows.
  - `20261024124756_rls_all_public_tables.sql:138-188` — the SQL twin does the same for an
    unseated custom role (the strip only applies when seated), so RLS agrees.
  - `__tests__/integration/rls-tenant-isolation.test.ts:1024-1113` — asserts an unseated
    custom role has `is_org_manager = true` and `group.manage = true` ("keeps today's plan
    entitlements").
  - `__tests__/unit/services/feature.resolver.test.ts:218-241` — asserts the org plan is
    inherited for a custom role (the mock deliberately omits management keys, so the
    escalation is not asserted).
- **Scenario:** Org on `hub`/`campus` (any paid org after `apply_org_plan`). Manager creates
  a custom role "Assistant" (zero rows) and assigns an educator. The educator's
  `/features/me` contains `org.manage`, `member.manage`, `role.builder`, `group.manage`,
  `branding`, plus every other hub feature.
- **Observed (expected from code):** full org-plan feature set, including management
  capabilities, on a role whose permissions may be empty.
- **Expected:** a custom role gets no management keys unless explicitly granted by a role
  mechanism (which does not exist today), and an empty role gets no entitlements at all.
- **Fix direction:** treat "zero rows" as an explicit `inherit=none` default; seed custom
  roles with the non-management plan entitlements (or none), and strip `ADMIN_ONLY` +
  `group.manage` on the custom-role branch too.

### FP-02 — Seat plans can grant management authority; pools can be minted without payment

- **Severity:** Critical
- **Status:** verified (code)
- **Invariant violated:** A seat may raise per-member entitlements/quotas only; it must never
  add a management permission or an unbought plan.
- **Evidence:**
  - `feature.resolver.ts:132-147` — seat plan is added, then only the three-key
    `ADMIN_ONLY_FEATURES` set is stripped; `group.manage` is **not** in it.
  - `seat.service.ts:71-135` — `addPool` accepts any `planKey` string; `org_seat_pools.plan_key`
    has no FK and no check against `subscription_plans` or the org's plan.
  - `seat.service.ts:20-42` — `PLAN_TIER_MAP` is a hardcoded second copy of
    `for_account_type`; unknown keys are silently allowed.
  - `seat.service.ts:250-266` — the tier check only runs when both `poolTier` and
    `userTier` are known; a **custom role** is not in `ROLE_TIER_MAP`, so its members can be
    assigned any pool (e.g. `campus` = manager tier).
  - `20261024124756_rls_all_public_tables.sql:478-504` — seat-pool writes are gated on
    `is_org_manager`, not on billing.
- **Scenario (a):** Org on `launch`. Manager `POST /api/v1/organization/seats/pools
{planKey:"campus", quantity:1}` → 201, then assigns it to themselves/an
  admin/teacher → campus features and limits without an org upgrade.
  **Scenario (b):** Org on `launch`, custom role "Assistant" assigned to an educator; manager
  assigns a `master`/`creator` seat (educator tier, includes `group.manage`; `master` also
  includes `member.manage`/`role.builder`). For a seat that includes `group.manage`, the
  seated non-admin keeps it because it is outside the denylist. For `master`, the
  admin-only keys are stripped unless the role row has `org.manage` — on a `launch`-created
  org the **teacher** row does have `org.manage`, so a seated teacher keeps
  `member.manage`/`role.builder` too.
- **Expected:** seats restricted to a paid, org-compatible plan; seat-eligible keys limited
  to personal-use entitlements + user-scope quotas.
- **Fix direction:** validate `planKey` against a purchased/entitled plan and account tier;
  make the admin/structural denylist key metadata; never let a seat add a permission key.

### FP-03 — `own`/`group` permission scopes are not an RLS boundary

- **Severity:** High
- **Status:** verified (code); the tenant-floor design is documented as accepted
- **Invariant violated:** `own`/`group` should be an authorization boundary, not just a
  service-layer filter; a member must not be able to read another member's personal content.
- **Evidence:**
  - `20260920000001_reenable_rls_sensitive_tables.sql:69-107` — `FOR ALL` policy:
    `created_by = auth.uid() OR organization_id IN (my orgs)`.
  - `20261024124756_rls_all_public_tables.sql:717-744` — same for banks/topics;
    `:841-857` for quizzes.
  - `packages/server/src/lib/authz.ts:95-119,281-314` — `own`/`group` filters exist only in
    the service layer.
  - `apps/web/src/proxy.ts` / `routes.config.ts` — the proxy skips `/api/*`, but Supabase
    PostgREST is a separate origin reachable with the user's JWT + public anon key (#191
    established that the anon key is shipped to browsers).
- **Scenario:** A student member of an org (role `member`) extracts their Supabase access
  token and calls `DELETE /rest/v1/flashcards?id=eq.<another member's card>` or
  `GET /rest/v1/flashcard_decks?select=*`. RLS allows it because the row is in their org.
- **Expected:** `own`/`group` scopes enforced at the DB or the DB must be the only client
  path; personal decks/cards must not be visible org-wide.
- **Fix direction:** decide whether PostgREST is a supported client; if yes, move scope into
  RLS (active-org session state + group membership); if no, remove `authenticated` table
  grants for content and route everything through the API.
- **Caveat:** this is pre-existing and explicitly documented as a "floor", not introduced by
  features. It is listed because it makes every "permission" claim above only as strong as
  the service layer.

### FP-04 — `role.builder` can rewrite its own role's permissions (self-escalation)

- **Severity:** Critical
- **Status:** verified (code)
- **Invariant violated:** A permission editor must not be able to raise its own scope, and
  must not edit system roles without a higher capability.
- **Evidence:**
  - `org-role.controller.ts:111-140` — `setPermissions` gated only by
    `requireFeature('role.builder')`.
  - `org-role.service.ts:250-296` — checks only `activeOrgId`, `orgRoleId`, and that the
    target role belongs to the org. **No check that the target is not the caller's role, no
    scope ceiling, no catalog validation of `permissionName`.**
  - `org-role.model.ts:38-48` — `permissionName` is a free `z.string()`; scope enum is
    `own|group|organization`.
  - RLS `org_role_permissions` update (`20261024124756:433-455`) requires `is_org_manager`
    (`member.manage`), which a custom role inherits on paid plans (FP-01).
- **Scenario:** Educator with the "Assistant" custom role (hub org) calls
  `PUT /api/v1/organization/roles/{ownRoleId}/permissions` with every content permission at
  `organization` scope → 200. `withAuth` reloads `org_role_permissions` on the next request,
  and `accessibleFilter`/`can` now return org-wide access.
- **Expected:** editors cannot edit their own role, cannot exceed their own scope, cannot
  edit system roles, and `permissionName` is validated against the catalog.
- **Fix direction:** forbid self-edit; require `member.manage`/admin for system roles; clamp
  granted scope to the caller's scope; validate permission names.

### FP-05 — `org.manage` is an unenforced, never-revoked admin marker

- **Severity:** High
- **Status:** verified (code + doc)
- **Invariant violated:** "Org admin" must be a stable property of the role, not a
  plan-derived feature that depends on creation history.
- **Evidence:**
  - `feature.resolver.ts:138-140` — the only functional use of `org.manage` is
    `isSeatedAdmin`.
  - `20261024151122_drop_org_limits.sql:127-135` — `apply_org_plan` deletes every feature
    not in the new plan **except `org.manage`**.
  - `supabase/seeds/00_plans.sql:66` — only `launch` has `org.manage`; `:100-138` — no paid
    org plan does.
  - `20261024151122_drop_org_limits.sql:79-83` — teacher gets everything except
    `member.manage`/`role.builder`, so teacher rows include `org.manage` on `launch`.
  - `docs/decisions/0007-manager-plan-model.md:62-64` claims `org.manage` is needed to create
    the first org; `organization.service.ts:24-62` does not check it (only account type).
  - `grep 'org.manage'` outside migrations/seeds/resolver returns **no enforcement site**.
- **Scenario A:** Fresh org created directly on `hub`/`campus` (seeds/manual/admin) or any
  org whose admin role rows lack `org.manage`. Seat the admin on a `campus` seat: the
  resolver computes `isOrgAdmin=false` and strips `member.manage`/`role.builder` — the
  **org admin loses member and role management**. Scenario B (opposite): a `launch`→`hub`
  upgrade keeps `org.manage` forever, so the same admin keeps them. Authorization depends on
  billing history.
- **Expected:** admin identity derived from `org_roles.name='admin'` (or a dedicated
  capability), independent of plan and seat.
- **Fix direction:** delete `org.manage` as a feature; derive admin from the system role (or
  a dedicated permission) and never sell it.

### FP-06 — Management keys are purchasable plan features

- **Severity:** High
- **Status:** verified (code)
- **Invariant violated:** Structural authority must not be a line item in a price list.
- **Evidence:**
  - `supabase/seeds/00_plans.sql:59-66,76-77,81-82,96-97,104-106,123-134` — `group.manage`,
    `member.manage`, `role.builder` appear in `plan_features` for `lite`, `launch`, `guide`,
    `team`, `creator`, `hub`, `master`, `campus`.
  - `20261024151122_drop_org_limits.sql:137-150` — role seeding treats these plan rows as
    role capability grants (hardcoded allowlists).
  - `apps/web/src/lib/pricing-benefits.ts:8-19` — the management keys are rendered as plan
    benefit bullets at checkout.
- **Scenario:** A manager buys `launch` (free) and the plan itself contains
  `member.manage`; any code path that copies plan → role (custom role, seat, apply_org_plan)
  can hand it out.
- **Expected:** plan features are entitlements only; roles distribute permissions.
- **Fix direction:** remove the four management keys from `plan_features`/`FEATURES`;
  distribute them through `org_role_permissions` or a dedicated capability table.

### FP-07 — Feature/limit disagreement: seat is additive for features, exclusive for limits

- **Severity:** High
- **Status:** verified (code)
- **Invariant violated:** A feature that is enabled must have a non-zero quota (or the UI
  must explain the block); both resolvers must resolve the same layer.
- **Evidence:**
  - `feature.resolver.ts:132-147` — seat plan is **additive** on role rows.
  - `limits.resolver.ts:55-58` — seat plan is **exclusive** for user keys.
  - `__tests__/unit/services/limits.resolver.test.ts:191-223` — asserts "seat path is
    exclusive: no personal/org fallback".
  - `supabase/seeds/00_plans.sql:145-178` — `base`/`launch` have
    `max_ai_tokens_per_day = 0`; `hub`/`campus` member role includes `ai.chat`.
- **Scenario:** Hub org, student member (role `member`, `ai.chat` via role rows), manager
  assigns a `base` seat (student tier, free, tokens 0). `/features/me` says `ai.chat`;
  `/api/v1/ai/usage` says limit 0; chat returns 429. Conversely, a `pro` personal student
  seated on a `base` seat still has 0 tokens.
- **Expected:** effective feature = entitlement ∧ quota > 0 (with an explicit "limit
  reached" state), or the feature must be hidden when its quota is 0.
- **Fix direction:** resolve features and limits in one pass and apply one layer contract
  (max for user-scope quotas, org plan for org-scope, no exclusive seat shortcut); treat
  `limit=0` as "feature unavailable" consistently in API and UI.

### FP-08 — #971's "empty means fallback" shape survives elsewhere

- **Severity:** High
- **Status:** verified (test)
- **Invariant violated:** One documented precedence chain, not several ad-hoc fallbacks.
- **Evidence:**
  - `feature.resolver.ts:175-185` — `enabled.size === 0` → personal plan. Same shape as
    #971: "org produced nothing, so try personal"; it silently hides purchases whenever the
    org layer produces _some_ features.
  - `feature.resolver.ts:132-147` — after the seat strip, `enabled` can become empty, and the
    personal fallback then runs **after** the strip (pre-fix), so personal plans can re-add
    admin keys.
  - `feature.resolver.ts:154-171` — custom-role branch has no strip at all.
  - `__tests__/unit/services/feature.resolver.test.ts:175-196` ("falls back to personal plan
    when org role features are empty") encodes the fallback shape; on the fix branch this
    test is rewritten but the `enabled.size === 0` pattern remains in the other branches.
  - `docs/plans/archive/org-features-and-limits.md:170-174` documents the old
    "if empty → personal plan" rule.
- **Scenario:** Any org whose plan has no `plan_features` rows (miss-configured plan,
  template edit, new plan) silently falls back to the personal plan for every member — the
  same class of bug as #971, one layer down.
- **Expected:** explicit per-layer precedence with "org layer present but empty" meaning
  "no org entitlement", not "consult another layer".
- **Fix direction:** replace `enabled.size === 0` with an explicit `orgLayerApplied` flag;
  build one resolver contract shared by features and limits.

### FP-09 — Four competing definitions of "org admin"

- **Severity:** High
- **Status:** verified (code)
- **Invariant violated:** One definition of admin authority, used by API, RLS, billing and
  UI.
- **Evidence:**
  1. `packages/authz/src/lib/org-roles.ts:9-13` — `role.name === 'admin'`
     (`MockStripeService.assertOrgAdmin:69-88`).
  2. `feature.resolver.ts:138-140` — `org.manage` feature row.
  3. `20261024124756:199-207` — `member.manage` (`is_org_manager`) for RLS.
  4. `routes.config.ts:76-79` + `withAuth allowedAccountTypes` — `account_type = manager`
     for `/manage` and seat/member/role routes.
- **Scenario:** A manager with a custom non-admin role sees `/manage` (account type), can
  open members (page has no feature gate), but gets 403 from the API (`member.manage`), and
  cannot buy an org plan (`role.name !== 'admin'`). A `teacher` with `org.manage` is treated
  as an admin by the feature resolver but not by RLS/billing.
- **Expected:** a single capability (e.g. `member.manage` or `role.name='admin'`) consulted
  everywhere.
- **Fix direction:** pick one; derive `isOrgAdmin` from it in TS and SQL; delete the other
  markers.

### FP-10 — API enforcement gaps for paid keys

- **Severity:** High
- **Status:** verified (code)
- **Invariant violated:** A paid entitlement must be enforced at the API boundary, not only
  in the UI.
- **Evidence:**
  - `ai/chat/route.ts:49-52` — only the token limit; no `requireFeature('ai.chat')`.
  - `quiz.service.ts` / `quiz` routes — no feature check; `quiz-content.tsx:72-73` is the
    only gate.
  - `quiz.builder`, `advanced.stats`, `documents` — `grep` finds only
    `feature.resolver.ts`, seeds and `pricing-benefits.ts`; no gate.
  - `org.manage` — no enforcement anywhere.
  - `branding` — enforced (logo + org update), but the org update RLS requires
    `member.manage` rather than `branding`.
- **Scenario:** A user override revokes `ai.chat` (abuse/trial end) or the ops team flips the
  kill switch: the sidebar hides AI, but the route still streams as long as the token budget
  is positive. A free `lite` educator uses the quiz builder; a free `base` student sees
  advanced statistics; `documents` is sold but absent.
- **Expected:** each paid key is checked in the controller/service that implements it (or
  documented as purely cosmetic and removed from `FEATURES`).
- **Fix direction:** add `requireFeature` to the AI/quiz/quiz-builder/stats surfaces; delete
  `documents` until shipped; decide whether `advanced.stats` is a real product gate.

### FP-11 — `has_org_feature` is a second resolver with different semantics

- **Severity:** High
- **Status:** verified (code)
- **Invariant violated:** DB and app authorization must not disagree, especially in the
  permissive direction.
- **Evidence:** `20261024124756_rls_all_public_tables.sql:109-191`
  - ignores `feature_flags` (`is_enabled`, rollout) — an ops kill switch does not close RLS;
  - ignores `user_feature_overrides` — an override revoke does not lower RLS;
  - grants a system `admin` **every** feature unconditionally (`:130`), whereas the TS
    resolver only grants plan-seeded rows;
  - the explicit `org_role_features` branch is **not** seat-filtered (`:40-45` documents this
    as a known follow-up);
  - the custom-role fallback strips admin-only only when seated (`:158-168`); the TS
    resolver strips nowhere on that branch (both over-grant, so they agree, but both are
    wrong — FP-01).
- **Scenario:** Ops sets `group.manage.is_enabled=false` → the API denies group writes, but
  a user can still POST to `/rest/v1/groups` because RLS says `true`. Or an override revokes
  `member.manage` → the API denies member changes, but RLS still allows them.
- **Expected:** one source of truth; RLS should call the same resolution (or be narrowed to
  the tenant floor only and not pretend to model features).
- **Fix direction:** remove feature logic from RLS policies or generate both from the same
  catalog/resolver contract; at minimum make RLS no wider than the API.

### FP-12 — Overrides bypass the admin-only strip and can grant structural keys

- **Severity:** High
- **Status:** verified (code)
- **Invariant violated:** An entitlement override must not grant a permission; overrides
  are applied after the last permission strip.
- **Evidence:**
  - `feature.resolver.ts:187-201` — overrides applied after the seat admin-only strip and
    after the personal `ORG_SCOPED` strip (fix branch).
  - `apps/admin/src/server/models/user-feature-override.model.ts:4-20` — only
    `isFeatureKey`; no denial of `ADMIN_ONLY_FEATURES`/`group.manage`.
  - `apps/admin/src/app/(frontend)/user-overrides/page.tsx` — the admin UI offers every
    `FEATURE` key.
- **Scenario:** Admin grants `member.manage` to a student as a "comp". The student can change
  member roles/remove members via the API (routes allow EDUCATOR/MANAGER only, so a student
  is blocked there — but an educator with the override is not). A `role.builder` override on
  an educator enables FP-04.
- **Expected:** overrides limited to entitlements; a separate, audited mechanism for
  permission comps.
- **Fix direction:** reject structural keys in `CreateUserFeatureOverride`; apply overrides
  before the final permission strip, not after.

### FP-13 — Feature keys are stored as RBAC permissions

- **Severity:** Medium
- **Status:** verified (code)
- **Invariant violated:** Feature and permission catalogs should be disjoint.
- **Evidence:**
  - `20260630000004_merge_features_into_rbac.sql:23-30` inserts `ai.chat`, `org.manage`,
    `study.*`, `test.*` into `public.permissions`; no later migration deletes them.
  - `20261024151122_drop_org_limits.sql:52-68` copies **all** `permissions` rows into every
    role's `org_role_permissions`.
  - `packages/server/src/lib/with-auth.ts:66-74` loads them into `ctx.permissionScopes`.
  - `packages/server/src/controllers/permissions.controller.ts:11-14` returns the whole map
    to the client, so `/api/v1/permissions/me` contains `ai.chat`/`org.manage`.
  - `seeds/09_perms.sql:5-26` adds the 20 content permissions but does not remove the legacy
    six; each role therefore has 26 scopes.
  - `org-role.service.ts:276-290` deletes all rows and re-inserts only what the client sends;
    the role editor sends only the 20 content permissions, silently dropping the legacy six.
- **Scenario:** A future `checkPermission(ctx, 'org.manage')` would pass for every org
  member; `/permissions/me` advertises feature keys as permissions; role edits churn
  feature data.
- **Expected:** `permissions` contains only atomic resource permissions; features live in
  `feature_flags`/`plan_features`.
- **Fix direction:** delete the legacy rows and add a guard/test that `permissions` ∩
  `FEATURES` is empty.

### FP-14 — Manager personal plan mirror / legacy paid personal plan

- **Severity:** Medium
- **Status:** verified (doc + code)
- **Invariant violated:** An org purchase must not create a portable personal entitlement.
- **Evidence:**
  - `docs/decisions/0007-manager-plan-model.md:38-49,84-96` — accepted: legacy paid org plan
    rows in `profiles.personal_plan_key` are inert _inside_ an org, but **still read outside
    one**; display masks them.
  - `mock-stripe.service.ts:143-150` — current code only writes personal plan for personal
    purchases (fix landed).
  - `subscription-plan.service.ts:202-244` — `getPersonalPlan` masks a paid manager plan to
    the free tier, while `LimitsResolver`/`FeatureResolver` read the raw value.
  - `supabase/seeds/00_plans.sql:37` — `launch` is both the free manager tier and the default
    org plan.
- **Scenario:** Manager bought `campus` before #228, then leaves all orgs → `personal_plan_key`
  stays `campus`; limits/features resolve campus while `/me/personal-plan` shows `launch`.
  A manager who leaves an org keeps a paid capacity bypass.
- **Expected:** one representation of "who paid for what"; org plans never become personal.
- **Fix direction:** backfill legacy rows (or make the resolver ignore paid org plans for
  managers even outside an org) and add a scope column instead of inferring from
  `for_account_type`.

### FP-15 — Plan mutation paths diverge: limits live, features snapshotted

- **Severity:** Medium
- **Status:** verified (doc + code)
- **Invariant violated:** A plan change should move entitlements and quotas together.
- **Evidence:**
  - `docs/limits.md:80-83,224-226` — editing `plan_limits` is live; editing
    `plan_features` is not; changing `organizations.plan` alone changes limits immediately
    but skips the feature re-sync.
  - `__tests__/integration/limits-resolution.test.ts:101-119` — deliberately updates
    `organizations.plan` directly and asserts live limit resolution.
  - `20261024151122_drop_org_limits.sql:137-150` — `apply_org_plan` is the only feature
    re-sync.
  - `apps/admin/src/server/services/plan-feature.service.ts:34-50` — admin edits
    `plan_features` only; no `apply_org_plan` call.
- **Scenario:** A service-role fix (or a future billing path) sets `organizations.plan='hub'`
  without `apply_org_plan`: limits become hub (2000 / 200000 tokens) but features stay launch
  role rows (no `branding`, no `role.builder`). Feature hidden, limit permissive.
- **Expected:** a single transactional `changePlan(org, plan)` path; no direct writes.
- **Fix direction:** revoke/guard direct `organizations.plan` updates (already guarded for
  `authenticated`), move feature+limit changes into one function, and add an invariant test
  that `organizations.plan` features = role snapshot for system roles.

### FP-16 — Inconsistent fail direction

- **Severity:** Medium
- **Status:** verified (code)
- **Invariant violated:** Missing configuration should fail closed for paid surfaces and
  fail safe for ops gates.
- **Evidence:**
  - `feature.resolver.ts:215-216` — a **missing `feature_flags` row means no gate**
    (fail-open).
  - `apps/admin/src/server/services/feature-flag.service.ts:90-96` — flag delete exists;
    `plan_features`/`user_feature_overrides` cascade, `org_role_features` does not
    (`org_role_features.feature_key` has no FK), so deleting a flag removes it from plans and
    overrides but leaves it in org snapshots.
  - `feature.resolver.ts:263-273` — unknown feature keys in DB rows are silently ignored.
  - `limits.resolver.ts:247-250` — missing `plan_limits` = 0 (fail-closed).
- **Scenario:** Ops deletes the `ai.chat` flag row to "turn it off": existing orgs keep
  `ai.chat` via `org_role_features`, personal plans lose it (cascade), and the missing flag
  is treated as no gate. Deleting a flag is not a kill switch; `is_enabled=false` is.
- **Expected:** missing catalog row = feature unusable + warning; deletion blocked or
  equivalent to `is_enabled=false`.
- **Fix direction:** fail closed on a missing flag row, add the FK on
  `org_role_features.feature_key`, and make flag deletion an explicit hard-delete with a
  migration plan.

### FP-17 — `/features/me` staleness and missing invalidation

- **Severity:** Medium
- **Status:** verified (test + doc)
- **Invariant violated:** After a plan/role/seat change, UI and API must agree within a
  defined bound.
- **Evidence:**
  - `apps/web/src/hooks/use-features.ts:16-24` — `staleTime: 5 * 60 * 1000`.
  - `apps/web/src/hooks/use-permissions.ts:15-20` — same 5 minutes.
  - `apps/web/src/app/(frontend)/checkout/page.tsx:122-140` — posts the webhook then
    navigates; **no** `invalidateQueries`.
  - `apps/web/src/app/(frontend)/billing/success/page.tsx` — no invalidation.
  - `apps/web/src/hooks/use-orgs.ts:47-80` — org switch **does** invalidate features,
    permissions, AI and plan (good).
  - `__tests__/qa/MGR/MGR-SEAT-02.spec.ts` — seat assignment tests fetch `/features/me`
    explicitly; no cache-invalidation assertion.
  - Issue #799 — observed live: after a Hub purchase, `/features/me` returns `branding` +
    `role.builder` but `/manage/settings` and `/manage/roles` still show locked cards until a
    full reload.
- **Scenario:** checkout (#799); manager assigns a seat to a student (their UI stays stale up
  to 5 min); manager changes a user's role (stale UI); ops flips a flag (stale UI). Server
  enforcement is immediate, so the failure mode is "feature hidden but route open" (or a
  button that 403s), never a server bypass.
- **Expected:** invalidate `featureKeys.all`/`permissionKeys.all` after checkout, seat
  assign/unassign, role change, flag edit (for the affected session) and on focus/interval
  ≤ 60 s; key feature queries by `activeOrg.id`.
- **Fix direction:** add invalidation at every entitlement mutation and a cross-tab event;
  consider returning an `ETag`/version from `/features/me`.

### FP-18 — Quota accounting is non-atomic and post-hoc

- **Severity:** Medium
- **Status:** verified (code)
- **Invariant violated:** A quota must be enforced atomically (reserve or DB constraint).
- **Evidence:**
  - `limits.resolver.ts:150-182` — read-modify-write on `user_daily_activity`; no
    transaction/atomic increment.
  - `ai/chat/route.ts:49-52` — checks `current >= limit` before the call; a single request
    can exceed the budget by an arbitrary number of tokens.
  - `ai/chat/route.ts:168-176` — usage recorded only in `onFinish`.
  - All `checkLimit` calls are `count → compare → insert` (e.g.
    `flashcard.service.ts:29`, `invitation.service.ts:628`), so parallel requests can exceed
    the cap.
- **Scenario:** Two parallel AI requests at 99% of the daily budget both pass the check; two
  parallel invite accepts both pass `max_students`. A long stream can overshoot by the full
  completion.
- **Expected:** a reservation/atomic counter, or a DB constraint/trigger.
- **Fix direction:** atomic `UPDATE ... SET tokens = tokens + $1 WHERE ...` with a check, or
  a `SECURITY DEFINER` reserve function; for counts, enforce in a trigger.

### FP-19 — Duplicate catalogs and denylists

- **Severity:** Medium
- **Status:** verified (code)
- **Invariant violated:** One catalog, generated or imported everywhere.
- **Evidence:**
  - `packages/authz/src/features.ts:5-17` and
    `packages/server/src/services/feature.resolver.ts:12-24` are identical copies of
    `FEATURES`; the server does not import the authz one.
  - `ADMIN_ONLY_FEATURES` exists in `authz/features.ts:31-35` (exported, unused by the
    server), `feature.resolver.ts:38-42` (private), SQL
    `20261024124756_rls_all_public_tables.sql:159`, and the QA spec
    `__tests__/qa/MGR/MGR-SEAT-02.spec.ts:86`.
  - The #971 fix adds a **third** list, `ORG_SCOPED_FEATURES`, in the resolver.
  - `apps/admin/src/app/(frontend)/feature-flags/page.tsx:3` imports `FEATURES` from authz;
    admin validation imports `isFeatureKey` from the server resolver — two different copies
    gate the same form.
- **Scenario:** Add `billing.manage` to the server catalog but not authz: the admin flags
  page never prompts for its flag row; the resolver accepts it from SQL. Add it to authz only:
  the page prompts, the API rejects. Drift is silent.
- **Expected:** a single module (ideally `@studiq/authz`) with key metadata
  (`kind`, `scope`, `minRole`, `seatEligible`), imported by server, admin and tests.
- **Fix direction:** delete the server copy; move `ADMIN_ONLY`/`ORG_SCOPED` into per-key
  metadata; generate the SQL denylist from it or stop duplicating it in SQL.

### FP-20 — Dead/legacy keys, tables and docs encode contradictory semantics

- **Severity:** Medium
- **Status:** verified (code + doc)
- **Invariant violated:** Catalogs/docs/tests describe the system that actually runs.
- **Evidence:**
  - Unenforced keys: `quiz.builder`, `advanced.stats`, `documents` (see FP-10).
  - Dead tables: `resource_permissions` (`20260609065731_rbac_updated.sql:9`; header calls it
    dead), `feature_permissions` dropped (`20260915000005`), `features` dropped
    (`20260630000004:104`), `role_permissions` dropped (`20260703000010:35`).
  - `allowed_roles` exists only on the dropped old `plan_features`
    (`20260630000001:197`); the current table has no role restrictions — role filtering is
    hardcoded in the trigger/`apply_org_plan`.
  - `Permission` still defines `assignment.*`, but assignment tables were dropped
    (`20260710000001_drop_assignment_tables.sql`) and `permissions` never seeds those names;
    `resolveScope` has no default for `assignment.publish`/`grade`, so they are unreachable.
  - `docs/plans/seat-based-licensing.md:154-155` says "personal plan applies only outside an
    org; no max(personal, org) mixing" — #971 reverses this for user-scope keys.
  - `docs/limits.md:100-108,115-126` describe the pre-#971 rule; the fix branch updates it.
  - `__tests__/integration/limits-resolution.test.ts:181-209` asserts the pre-#971
    semantics ("org plan governs even when personal is unlimited"); the fix branch rewrites
    it.
  - `docs/plans/archive/org-features-and-limits.md:170-174` encodes "empty role rows →
    personal plan", now replaced by "empty → org plan".
- **Scenario:** A reader trusts `docs/limits.md` or the archived plan and builds the wrong
  mental model; a QA suite asserts the old rule.
- **Expected:** docs and tests updated in the same PR as the semantic change; dead keys
  removed.
- **Fix direction:** delete dead keys/tables/permissions; make `docs/limits.md` the single
  normative contract and add a test that reads it or generates it.

### FP-21 — Management surfaces use three different enforcement mechanisms

- **Severity:** Medium
- **Status:** verified (code)
- **Invariant violated:** The same capability should be checked the same way on every
  surface.
- **Evidence:**
  - Members: `requireFeature('member.manage')` (`organization-member.controller.ts:29,56`).
  - Invitations: RLS only via `is_org_manager` (`20261024124756:575-604`); no controller
    feature check.
  - Roles: `requireFeature('role.builder')` + RLS `member.manage`.
  - Groups: `requireFeature('group.manage')` + RLS `group.manage`.
  - `can_assign_org_role` (`20261024124756:212-243`) grants the system `teacher` role the
    ability to invite `member` **by role name**, bypassing `member.manage`. The classroom
    invite UI that motivated it is commented out (`app-sidebar.tsx:45-52`,
    `docs` UI_HIDDEN), but the DB privilege is live.
  - Seats: account type MANAGER only; no feature check beyond RLS.
- **Scenario:** A plan where the teacher role lacks `member.manage` still allows teachers to
  invite students (by design in SQL), while member management via the API is denied. A
  custom role with `member.manage` can invite admins (FP-01).
- **Expected:** one capability + one check per action; no role-name special cases.
- **Fix direction:** route invitations through `requireFeature('member.manage')` (or a
  dedicated `invite.create` permission) and remove the teacher role-name exception; map every
  management surface to one capability table.

### FP-22 — Manager cannot use AI; rollout header is dead

- **Severity:** Low
- **Status:** verified (code)
- **Invariant violated:** A sold entitlement should be usable by the account type that buys
  the plan; a public contract should have a consumer.
- **Evidence:**
  - `routes.config.ts:25-30` and `ai/chat/route.ts:59` allow only STUDENT/EDUCATOR;
    `hub`/`campus` (manager plans) include `ai.chat`.
  - `apps/web/src/app/(backend)/api/v1/features/me/route.ts:14-20` sets
    `X-Feature-Rollout`; `grep` finds no consumer in `apps/web/src`.
- **Scenario:** A manager buys `hub`; `/features/me` includes `ai.chat`, but `/api/v1/ai/*`
  returns 403 and there is no AI nav item for managers.
- **Expected:** either managers get AI or the plan does not advertise it.
- **Fix direction:** decide and align the plan/route; remove the header or consume it.

### Unverified / needs runtime repro

| ID   | Hypothesis                                                                                             | Why unverified                                                             |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| U-01 | A legacy manager with `personal_plan_key='campus'` actually gets unlimited AI outside any org (FP-14). | ADR states it; not exercised against a DB.                                 |
| U-02 | `POST /organization/seats/pools {planKey:'campus'}` succeeds for a launch org (FP-02).                 | Code path is clear, but no HTTP run (no local stack).                      |
| U-03 | A custom-role educator can promote a confederate to admin (FP-01 → FP-21).                             | RLS/trigger chain is clear; needs a live org fixture.                      |
| U-04 | PostgREST content write bypass (FP-03) with a real JWT.                                                | RLS + grants are clear; not executed (no DB).                              |
| U-05 | `organizations.plan` direct update yields hub limits + launch features (FP-15).                        | Stated in docs and tested for limits; feature half not integration-tested. |
| U-06 | `role.builder` self-edit returns 200 and changes scopes (FP-04).                                       | Controller/service/RLS chain is clear; not executed.                       |

---

## 6. Reproduction cases (high severity)

> Do not run these against the shared QA database. Use a disposable local stack
> (`bun dev:up` + `bun dev:reset-db`) or unit fixtures. The seeded accounts are
> `manager@dev.local`, `teacher1@dev.local`, `student1@dev.local` (password per seed).

### R-1 — Custom role inherits management keys (FP-01)

1. Create/upgrade an org to `hub` (`select apply_org_plan('<org>', 'hub')` as service role).
2. As `manager@dev.local`: `POST /api/v1/organization/roles {"name":"assistant"}` → new role.
3. Assign `teacher1@dev.local` to `assistant`
   (`PUT /api/v1/organization/members {"targetUserId":"…","newOrgRoleId":"…"}`).
4. Sign in as `teacher1`, set `active_org_id` to the org, `GET /api/v1/features/me`.
5. Observe `org.manage`, `member.manage`, `role.builder`, `group.manage`, `branding`.
6. Observe `PUT /api/v1/organization/members` for another user returns 200; `DELETE` removes
   them; `PUT /api/v1/organization/roles/{assistant}/permissions` returns 200.
7. Expected: only the non-management hub entitlements (or none).

### R-2 — Billing bypass via seat pool (FP-02)

1. Org on `launch`; `POST /api/v1/organization/seats/pools {"planKey":"campus","quantity":1}`.
2. `POST /api/v1/organization/seats/assignments {"userId":"<admin or custom-role user>",
"poolId":"<new pool>"}`.
3. `GET /api/v1/features/me` and `GET /api/v1/me/plan` for that user → campus features /
   campus limits without `organizations.plan = 'campus'`.
4. Expected: `BAD_REQUEST`/`FORBIDDEN` unless the org owns that plan and the user's tier
   matches.

### R-3 — Feature on, limit 0 (FP-07)

1. Org on `hub`; student member with the `member` role.
2. Manager creates a `base` pool and assigns the student.
3. `GET /api/v1/features/me` → contains `ai.chat`.
4. `GET /api/v1/ai/usage` → `{ limit: 0 }`; `POST /api/v1/ai/chat` → `429
USAGE_LIMIT_EXCEEDED`.
5. Expected: either `ai.chat` absent (feature gated by quota) or a non-zero budget.

### R-4 — Seated admin loses admin capabilities (FP-05)

1. Create a fresh org whose roles are seeded from `hub` **without** `org.manage` (e.g.
   insert `organizations` with `plan='hub'` as service role, or delete the `org.manage` rows).
2. Assign the `admin` user a `campus` seat.
3. `GET /api/v1/features/me` → no `member.manage`/`role.builder`; `PUT
/api/v1/organization/members` → 403.
4. Expected: admin keeps member/role management regardless of seat.

### R-5 — Override grants a permission (FP-12)

1. As admin app: `POST /api/v1/user-overrides {"userId":"<educator>","featureKey":
"member.manage","isEnabled":true}`.
2. Sign in as the educator with an org role that lacks `member.manage`.
3. `PUT /api/v1/organization/members` → 200 (feature gate passes).
4. Expected: 403; overrides should not grant structural keys.

### R-6 — Feature flag delete / kill switch (FP-16, FP-10)

1. Ops sets `ai.chat.is_enabled=false`.
2. `/features/me` no longer contains `ai.chat`; `POST /api/v1/ai/chat` still returns 200
   while the user's token budget is positive.
3. Alternatively delete the `ai.chat` flag row: plans/overrides lose it, existing
   `org_role_features` keep it, and the missing row is treated as no gate.
4. Expected: the route must 403 when the feature is off; deletion must not fail open.

### R-7 — Stale cache (#799, FP-17)

1. Sign in as a manager of a `launch` org in a tab (so `/features/me` is cached).
2. Complete the checkout to `hub` (same tab).
3. Without reload: `/manage/settings` still shows the branding lock; `/manage/roles` still
   shows the role-builder lock.
4. A fresh `GET /api/v1/features/me` returns `branding` + `role.builder`.
5. Expected: the UI refetches/invalidates immediately after the purchase.

---

## 7. Test and doc gaps

### 7.1 Tests that encode the old/contradictory semantics

| Test                                                           | What it encodes                                                      | Contradiction                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `__tests__/unit/services/limits.resolver.test.ts:102-122`      | "personal plan never raises it" (org plan governs user keys)         | #971 reverses this for user-scope keys                                    |
| `__tests__/integration/limits-resolution.test.ts:181-209`      | `pro` personal inside `launch` → 100 cards / 0 tokens                | #971's acceptance case is the opposite                                    |
| `__tests__/unit/services/limits.resolver.test.ts:191-223`      | seat path is exclusive, no personal/org fallback                     | features are additive for the same seat                                   |
| `__tests__/unit/services/feature.resolver.test.ts:175-196`     | "falls back to personal when org role features are empty"            | current code falls back to the org plan first                             |
| `__tests__/unit/services/feature.resolver.test.ts:218-241`     | custom role inherits the org plan, no management keys in the mock    | real plans do include management keys                                     |
| `__tests__/integration/rls-tenant-isolation.test.ts:1106-1113` | unseated custom role has `is_org_manager=true` / `group.manage=true` | accepted escalation; contradicts "role-only permissions"                  |
| `__tests__/qa/MGR/MGR-SEAT-02.spec.ts:85-86,533-540`           | only three admin-only keys; `group.manage` never checked             | `group.manage` is a management permission                                 |
| `__tests__/integration/org-features.test.ts:134-150`           | member role rows exactly `flashcards,quiz,documents` on launch       | `launch` also has `group.manage`/`member.manage`/`org.manage` in the plan |

### 7.2 Missing quadrants / scenarios

- Paid org + free personal, both paid with different keys, both free (only #971's free org +
  paid personal is covered).
- Custom role with zero rows on a paid org, unseated and seated (`member.manage`,
  `role.builder`, `org.manage`).
- Seat plan that can raise/lower limits relative to the org plan (`base` seat in a `hub` org).
- Seated admin on a plan without `org.manage`.
- Override granting/revoking a structural key.
- Flag kill switch vs paid entitlement; deleted flag row.
- `role.builder` self-edit / scope ceiling.
- Invite path (RLS-only) vs member path (`requireFeature`).
- Cache invalidation after checkout, seat assignment, role change, flag edit (no unit/E2E
  test; #799 is a QA finding, not a regression test).
- `organizations.plan` direct update → feature/limit divergence.
- `max_students`/`max_groups` concurrency.
- Feature-enabled-but-quota-0 rendering.

### 7.3 Documentation gaps / contradictions

- `docs/limits.md` still documents the pre-#971 rule on the audited commit (the fix branch
  updates it); it is the normative doc, so it must land with the fix.
- `docs/plans/seat-based-licensing.md:154-155` says "no max(personal, org) mixing" — now
  false for user-scope keys.
- `docs/plans/archive/org-features-and-limits.md:170-174` describes the old empty-role
  fallback.
- `docs/decisions/0007-manager-plan-model.md:62-64` claims `org.manage` is needed to create
  an org — it is not checked.
- No doc defines the difference between entitlement/permission/limit/flag; `docs/limits.md`
  uses "features" for both.
- No doc lists the seat eligibility policy (`PLAN_TIER_MAP`) or why any pool can be minted.

---

## 8. Product questions (with recommended default)

These cannot be answered from the code. Defaults are the recommendation for the fix-design
agent; they are chosen to preserve #971's intent while restoring fail-closed authority.
The target model that resolves them is proposed in
[`docs/decisions/0008-role-based-authority.md`](../decisions/0008-role-based-authority.md).

1. **Is a personal paid plan portable across every org, or only for personal-use features?**
   **Default:** portable for personal-use entitlements (`ai.chat`, `flashcards`, `quiz`,
   `quiz.builder`, `advanced.stats`, `documents`) and per-member quotas; **not** for
   org-scoped keys (`branding`, `group.manage`, `member.manage`, `role.builder`,
   `org.manage`). This is what the #971 fix approximates with `ORG_SCOPED_FEATURES`, but it
   should be catalog metadata, not a list in one resolver.
2. **Are `org.manage`, `member.manage`, `role.builder`, `group.manage` ever purchasable?**
   **Default:** no. They are role permissions. Remove them from `FEATURES`/`plan_features`
   and distribute them through roles (or a dedicated capability table).
3. **Should a zero-row custom role inherit the org plan's management keys, or only
   non-management entitlements?**
   **Default:** neither by inheritance. A new custom role starts with **no** entitlements and
   no management permissions; the admin grants both explicitly. If product wants the
   "branding works out of the box" behaviour, seed only non-management entitlements and keep
   management role-only.
4. **Can a user override grant a structural permission such as `org.manage`?**
   **Default:** no. Overrides are entitlement comps; permission comps go through a separate,
   audited role/override mechanism. At minimum, reject `ADMIN_ONLY` + `group.manage`.
5. **Can a seat plan grant management keys, or only personal-use entitlements?**
   **Default:** only personal-use entitlements + user-scope quotas. Add `seatEligible` to the
   catalog; reject pools whose plan is not owned/entitled; never let a seat add a permission.
6. **Is `group.manage` teacher-level or admin-only?**
   **Default:** teacher-level (classroom rosters), but it must be a role permission, not a
   plan feature, and it must not be grantable by a seat/personal plan. Admin-only keys stay
   `member.manage`/`role.builder` (and `org.manage` disappears).
7. **Should a feature flag be able to remove a paid entitlement (kill switch), or only pause
   rollout?**
   **Default:** flags may pause/limit rollout and temporarily disable a surface for
   safety, but a permanent disable of a paid key requires a documented compensation path and
   must not be expressible as a row deletion. Rollout percentages should not apply to
   overrides/paid entitlements without an explicit opt-in.
8. **After a role/plan/org change, how quickly must `/features/me` reflect it?**
   **Default:** API is immediate (already true); UI must invalidate on the mutation and
   refetch on focus, with a hard bound of 60 s. Add invalidation after checkout, seat
   assignment, role change and flag edits.
9. **What should the UI do when a feature is enabled but its limit is `0`?**
   **Default:** do not show the working surface. Treat effective entitlement as
   `feature ∧ quota > 0`; show an upgrade/limit state, and make the API return the same
   `FEATURE_REQUIRES_UPGRADE`/`USAGE_LIMIT_EXCEEDED` consistently.
10. **Who is the org admin — role name, `org.manage`, `member.manage`, or account type?**
    **Default:** `member.manage` is the single capability for member/role/seat/settings
    authority (what RLS already uses); billing keeps `role.name='admin'` (or, better, the
    same capability); `account_type` is only a UI/route hint. Delete `org.manage`.
11. **Are per-member quotas an org policy or a personal entitlement?**
    **Default:** personal may raise, org may not lower (aligns with #971); org-scope capacity
    (`max_students`, `max_groups`) remains org-only. This is a deliberate reversal of #233
    Q1 for user-scope keys and needs to be recorded.
12. **Should `branding` be visible to all members but writable only by admins?**
    **Default:** yes (current intent): display entitlement is org-scoped and may be granted
    to member/teacher rows; write requires manager account type + `member.manage` (or a
    dedicated `branding.manage`), never the display entitlement alone.

---

## 9. Recommended fix batches (grouping only, in order)

1. **Catalog + metadata (foundation).**
   One `FEATURES` module with per-key `kind` (`entitlement|permission|limit|flag`), `scope`
   (`personal|org`), `seatEligible`, `minRole`. Delete the duplicate server/authz catalogs
   and the SQL/QA denylists; generate or assert them. Remove `org.manage` as a feature;
   remove `member.manage`/`role.builder`/`group.manage` from `plan_features`. Decide whether
   `quiz.builder`/`advanced.stats`/`documents` are real keys (enforce or delete).
2. **Single resolution contract.**
   One resolver returns `{ features, limits, source }` for a context. Define explicit layers
   (`org role`, `seat`, `personal`, `override`, `flag`) and explicit combination rules
   (`union` for features, `max` for user quotas, org-only for org quotas, permission keys
   role-only). Replace `enabled.size === 0` with an explicit layer flag. Make
   `FeatureResolver` verify membership like `LimitsResolver` and share the same "verified
   org" predicate.
3. **Role/plan separation.**
   Seed custom roles with no entitlements (or non-management only); make zero rows mean
   "none"; strip management keys on the custom-role branch; delete the `org.manage` marker
   and derive admin from the system role/capability. Add a self-edit/scope-ceiling guard to
   `setPermissions`, validate `permissionName`, and require the right capability for system
   roles.
4. **Close the enforcement matrix.**
   Add `requireFeature('ai.chat')` to the AI route, and decide/enforce `quiz`,
   `quiz.builder`, `advanced.stats`, `documents`; remove keys that are purely cosmetic.
   Make `branding` write use a permission, not the display entitlement. Route invitations
   through `member.manage` and delete the teacher role-name exception.
5. **Seat/override guardrails.**
   Validate `planKey` against an owned/entitled plan; add `seatEligible`; block management
   keys from overrides and seats; fix the custom-role tier bypass; make `addPool` require a
   purchased plan (or a billing hook).
6. **RLS parity or retreat.**
   Either generate `has_org_feature` from the same contract (including flags/overrides) or
   narrow RLS to the tenant floor only and stop pretending it models features. Decide
   whether PostgREST is a client: if not, revoke `authenticated` content grants; if yes, move
   `own`/`group` into RLS. Add the FK on `org_role_features.feature_key`.
7. **Cache + freshness.**
   Invalidate `featureKeys.all`/`permissionKeys.all` after checkout, seat assign/unassign,
   role change and flag edits; key queries by `activeOrg.id`; refetch on focus; add a
   regression test for #799. Remove the dead `X-Feature-Rollout` header or consume it.
8. **Limits hardening.**
   Atomic token accounting (reserve/increment), DB-level or trigger enforcement for caps,
   and a single `getUsage` that reports the _effective_ plan (or `{ plan, source }`) so the
   UI stops showing the personal plan for an org-resolved limit.
9. **Legacy cleanup + docs/tests.**
   Delete the legacy `permissions` rows that overlap `FEATURES`; remove the dead
   `resource_permissions`/`assignment.*` entries; update `docs/limits.md`, the seat plan and
   the ADR; rewrite the tests listed in §7.1; add the missing quadrants from §7.2.

---

## 10. Appendix

### 10.1 Files inspected

```
packages/authz/src/features.ts
packages/authz/src/lib/org-roles.ts
packages/authz/src/lib/permissions.ts
packages/authz/src/index.ts
packages/server/src/services/feature.resolver.ts
packages/server/src/services/limits.resolver.ts
packages/server/src/services/limit.catalog.ts
packages/server/src/services/seat.plan.ts
packages/server/src/services/seat.service.ts
packages/server/src/services/subscription-plan.service.ts
packages/server/src/services/org-role.service.ts
packages/server/src/services/organization-member.service.ts
packages/server/src/services/organization.service.ts
packages/server/src/services/group.service.ts
packages/server/src/services/invitation.service.ts
packages/server/src/services/mock-stripe.service.ts
packages/server/src/lib/features.ts
packages/server/src/lib/with-auth.ts
packages/server/src/lib/authz.ts
packages/server/src/controllers/{features,permissions,org-role,organization,organization-member,group,seat,ai-usage}.controller.ts
packages/server/src/models/{org-role,seat}.model.ts
packages/server/src/config/routes.config.ts
packages/server/src/types/database.ts (selected)
apps/web/src/hooks/{use-features,use-feature,use-permissions,use-permission,use-orgs,use-branding,use-group-options}.ts
apps/web/src/lib/{query-keys,query-cache,pricing-benefits}.ts
apps/web/src/components/{app-sidebar.tsx,groups/group-management-screen.tsx,ai/ai-chat-screen.tsx,study/quiz-content.tsx,flashcards/screens/deck-detail-screen.tsx,flashcards/shared/flashcard-toolbar.tsx,layout/*}
apps/web/src/app/(frontend)/{checkout/page.tsx,billing/success/page.tsx,manage/settings/page.tsx,manage/roles/page.tsx,manage/members/page.tsx,app/stats/*}
apps/web/src/app/(backend)/api/v1/{ai/chat,features/me,permissions/me,organization/*,organization/roles/*,organization/members,organization/seats/*,quiz/*}
apps/admin/src/server/{models,services,controllers}/(feature-flag|plan-feature|user-feature-override|plan-limit)*
apps/admin/src/app/(frontend)/{feature-flags,user-overrides,subscription-plans}
supabase/migrations/20260609065731_rbac_updated.sql
supabase/migrations/20260630000001_rename_universities_to_organizations.sql
supabase/migrations/20260630000004_merge_features_into_rbac.sql
supabase/migrations/20260703000001_feature_flags.sql
supabase/migrations/20260703000003_seed_features.sql
supabase/migrations/20260703000009_cleanup_user_role_enum.sql
supabase/migrations/20260703000010_add_account_type_org_roles.sql
supabase/migrations/20260707000004_plan_system.sql
supabase/migrations/20260707000005_org_role_features_and_limits.sql
supabase/migrations/20260707000006_handle_new_organization_trigger.sql
supabase/migrations/20260708000002_seat_based_licensing.sql
supabase/migrations/20260915000003_drop_plan_seat_allocations.sql
supabase/migrations/20260915000004_migrate_legacy_feature_keys.sql
supabase/migrations/20260915000005_drop_feature_permissions.sql
supabase/migrations/20260920000001_reenable_rls_sensitive_tables.sql
supabase/migrations/20260924000001_branding_feature.sql
supabase/migrations/20260924000002_strip_sys_admin.sql
supabase/migrations/20260925000001_org_role_features_rls_policies.sql
supabase/migrations/20261020000002_apply_org_plan.sql
supabase/migrations/20261024124756_rls_all_public_tables.sql
supabase/migrations/20261024124757_rls_function_and_grant_hardening.sql
supabase/migrations/20261024151122_drop_org_limits.sql
supabase/migrations/20261025222258_remove_max_storage_mb.sql
supabase/seeds/00_plans.sql
supabase/seeds/01_seed.sql
supabase/seeds/09_perms.sql
supabase/seeds/99_dev_grants.sql
__tests__/unit/services/feature.resolver.test.ts
__tests__/unit/services/limits.resolver.test.ts
__tests__/integration/limits-resolution.test.ts
__tests__/integration/manager-plan-model.test.ts
__tests__/integration/apply-org-plan.test.ts
__tests__/integration/org-features.test.ts
__tests__/integration/rls-tenant-isolation.test.ts (selected)
__tests__/integration/plan-limits.test.ts (selected)
__tests__/qa/MGR/MGR-SEAT-02.spec.ts (selected)
docs/limits.md
docs/decisions/0007-manager-plan-model.md
docs/plans/seat-based-licensing.md
docs/plans/archive/org-features-and-limits.md
AGENTS.md
```

### 10.2 SQL queries used (conceptual; none executed)

```sql
-- feature catalog / plan matrix
SELECT p.key, pf.feature_key FROM subscription_plans p
LEFT JOIN plan_features pf ON pf.plan_key = p.key ORDER BY p.sort_order, pf.feature_key;

-- limits per plan
SELECT plan_key, limit_key, limit_value FROM plan_limits ORDER BY plan_key, limit_key;

-- role snapshots
SELECT o.name AS org, r.name AS role, f.feature_key, f.is_enabled
FROM org_role_features f JOIN org_roles r ON r.id = f.org_role_id
JOIN organizations o ON o.id = r.organization_id
ORDER BY o.name, r.name, f.feature_key;

-- feature keys leaking into RBAC
SELECT name FROM permissions WHERE name IN (SELECT key FROM feature_flags);
SELECT r.name, p.permission_name, p.scope
FROM org_role_permissions p JOIN org_roles r ON r.id = p.org_role_id
WHERE p.permission_name IN ('ai.chat','org.manage','study.create','test.create');

-- seat plans vs org plans
SELECT o.name, o.plan, sp.plan_key AS seat_plan, sp.total, sp.assigned
FROM org_seat_pools sp JOIN organizations o ON o.id = sp.organization_id;

-- overrides on structural keys
SELECT u.email, o.feature_key, o.is_enabled, o.expires_at
FROM user_feature_overrides o JOIN profiles u ON u.id = o.user_id
WHERE o.feature_key IN ('org.manage','member.manage','role.builder','group.manage');
```

### 10.3 Commands run (read-only)

```bash
git log --oneline -25
git show fix/personal-plan-in-org:packages/server/src/services/personal-plan.ts
git diff bd696b59..fix/personal-plan-in-org --stat
git diff bd696b59..fix/personal-plan-in-org -- packages/server/src/services/{feature,limits}.resolver.ts
git diff bd696b59..fix/personal-plan-in-org -- __tests__/unit/services/{feature,limits}.resolver.test.ts
gh issue view 971/970/695/799/228/233/182/191 --json …
grep -rn "requireFeature|org.manage|group.manage|member.manage|role.builder|ai.chat|…"
```

`bunx vitest run __tests__/unit/services/{feature,limits}.resolver.test.ts` was attempted and
failed at startup because this worktree has no `node_modules` (`Cannot find module 'vite'`).
No files outside this report were modified.

### 10.4 Raw key list

`FEATURES` (both copies, byte-identical):

```
ai.chat, flashcards, quiz, quiz.builder, documents,
org.manage, group.manage, member.manage, role.builder,
advanced.stats, branding
```

`ADMIN_ONLY_FEATURES` (server copy): `org.manage`, `member.manage`, `role.builder`.

`ORG_SCOPED_FEATURES` (fix branch only): the three above + `group.manage`, `branding`.

`LIMITS`: `max_flashcards`, `max_decks`, `max_questions`, `max_question_banks`,
`max_quiz_attempts_per_day`, `max_ai_tokens_per_day` (user); `max_students`, `max_groups`
(org).

### 10.5 Positive findings (verified working)

- `getSeatPlanKey` is shared by both resolvers (`seat.plan.ts`), so the seat lookup itself
  cannot drift.
- `LimitsResolver` verifies `org_members` before trusting the cookie (`:63-65`).
- `apply_org_plan` does revoke features the new plan no longer includes (except
  `org.manage`).
- `org_role_features` has a read policy for org members (#124) and no write policy, so role
  snapshots cannot be tampered with through PostgREST.
- Expired user overrides are ignored (#382) and kept as audit rows.
- Missing `plan_limits` is `0` in every path (fail-closed).
- `max_students` invite-accept uses the service-role client (#182).
- Org switch invalidates feature/permission/AI caches (`use-orgs.ts:47-80`).
- `stripe/webhook` is the only public API exception; the mock webhook authenticates the
  caller and acts on their own account (`routes.config.ts`, `mock-stripe.service.ts`).
