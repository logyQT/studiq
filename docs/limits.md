# Plans, Features & Limits

> Canonical reference for plan entitlements and quota resolution (#232).
> Historical design: [`plans/archive/org-features-and-limits.md`](plans/archive/org-features-and-limits.md).
> Last updated: 2026-11-22 (phase 3c: the org plan is the only org entitlement state).

## Summary

A plan is a **template**: `plan_entitlements` and `plan_limits` rows keyed by
`plan_key`. Users and orgs _point at_ a plan (`profiles.personal_plan_key`,
`organizations.plan`); they never get a private copy of its limits.

- **Features** resolve live: `organizations.plan` → `plan_entitlements` for the
  org layer, and `org_roles.entitlement_profile` for the role layer.
  `org_role_features` is revokes-only (D19): an `is_enabled = false` row
  subtracts its key, and an enabled row is inert — ignored by both the resolver
  and the RLS twin (phase 3c).
- **Limits** are **never copied**. Every check reads the relevant plan's
  `plan_limits` row live.
- There is **no** `org_limits` table (dropped in #229), no per-org limit
  override, and no per-user limit override.
- Writing a `plan_limits.limit_value` (SQL, or the admin app's
  `PUT /api/v1/plan-limits/[id]`) takes effect on the **next request for every
  existing org and user on that plan** — no backfill, no restart, no per-org
  snapshot to refresh. The same is true of changing `organizations.plan`.

## Data model

| Table / column                                                          | Meaning                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscription_plans`                                                    | Plan catalog (`key`, name, price, `for_account_type`).                                                                                         |
| `plan_entitlements (plan_key, entitlement_key)`                         | Feature template for a plan.                                                                                                                   |
| `plan_limits (plan_key, limit_key, limit_value)`                        | Limit template for a plan. `-1` = unlimited.                                                                                                   |
| `profiles.personal_plan_key`                                            | Personal plan (seed default `base`; managers default to the free `launch` tier). An organization purchase never writes it (#228).              |
| `organizations.plan`                                                    | Organization plan (seed default `launch`).                                                                                                     |
| `org_role_features (org_role_id, feature_key, is_enabled)`              | Revokes-only since phase 3c (D19/D27): an explicit `is_enabled = false` subtracts one key from the role profile; an enabled row has no effect. |
| `org_seat_pools` / `org_seat_assignments`                               | Opt-in per-user seat; the pool's `plan_key` is the seat plan.                                                                                  |
| `user_feature_overrides (user_id, feature_key, is_enabled, expires_at)` | Strongest feature layer; expired rows are ignored.                                                                                             |
| `entitlement_flags (key, is_enabled)`                                   | Global kill switch only; a missing row fails closed (D8).                                                                                      |

The `base` / `launch` defaults come from the seed
(`supabase/seeds/00_plans.sql` → `ALTER TABLE … SET DEFAULT`), not from the
original table migrations.

Feature keys: `ENTITLEMENTS` in
`packages/authz/src/entitlements.ts` (`ai.chat`, `flashcards`,
`quiz`, `quiz.builder`, `advanced.stats`, `branding`). The four legacy
management markers (`org.manage`, `group.manage`, `member.manage`,
`role.builder`) left the catalog in phase 2b-7 — authority is permissions only
(ADR-0015 §4.1). `documents` is on the roadmap but has no surface yet, so it is
absent in v1 — excluded from the catalog, plans and pricing until it ships;
re-entry is data-only (catalog metadata, a flag row and the plan rows), not a
resolver change (ADR-0015 §5.1, open catalog).

Limit keys: `LIMITS` in
`packages/authz/src/limits.ts` — the single source of truth
for both the resolver and the DB rows:

| Scope                     | Keys                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `user` (per-member)       | `max_flashcards`, `max_decks`, `max_questions`, `max_question_banks`, `max_quiz_attempts_per_day`, `max_ai_tokens_per_day` |
| `org` (organization-wide) | `max_students`, `max_groups`                                                                                               |

## Plan-template propagation

`handle_new_organization()` — org creation
(`supabase/migrations/20261122120000_org_plan_writer_removed.sql`):

1. creates the `admin` / `teacher` / `member` system roles with their
   `entitlement_profile` (`all`, `all`, `learner`);
2. seeds their RBAC permissions;
3. writes no entitlements and no limits: both org layers resolve live from
   `organizations.plan`.

It creates **no seat pools** (pools are created on demand since Phase B.5).

`change_org_plan(org_id, plan)` — plan change:

1. validates the org and the plan, then updates `organizations.plan`;
2. nothing else — the org layer is derived live from
   `plan_entitlements`/`plan_limits`, so there is no feature snapshot to
   re-sync.

Editing `plan_entitlements` therefore changes existing orgs on the next
resolution, exactly as editing `plan_limits` does. A hand-inserted
`org_role_features` row with `is_enabled = false` survives a plan change and
keeps subtracting its key (D19).

## Feature resolution

`EntitlementResolver.resolveEntitlements(ctx)` —
`packages/server/src/services/entitlement.resolver.ts` (ADR-0015 §6.1; the
only reader of the plan/role/seat/override/flag tables, memoized once per
request on the ctx). Resolution order:

1. **Verified membership** — `active_org_id` is a cookie; only a real
   `org_members` row makes it an org context.
2. **Plan entitlement** (profile layer, ADR-0015 §5.3)
   - `org_roles.entitlement_profile`: `all` → the org plan ceiling, `learner` →
     `flashcards`, `quiz`, `ai.chat`, `branding` ∩ ceiling, `none` → nothing.
   - `org_role_features` rows then apply their `is_enabled = false` revokes
     only (D19) — an enabled row adds nothing, since 2b-7 removed the markers
     that were the only row-granted keys.
   - Seated (`org_seat_assignments` via `getSeatPlanKey`): the seat plan's
     `plan_entitlements` are intersected with the ceiling (a seat adds only
     keys the org plan carries).
3. **Personal plan** — applied on top of the entitlement above:
   `profiles.personal_plan_key` → `plan_entitlements`. A plan the member pays for
   personally is never shadowed by an org on a lower tier — a student on StudiQ
   Pro inside a free `launch` org keeps `ai.chat`. Inside an org the personal
   layer only adds `personalPortable` keys (D3): a personal plan cannot hand a
   `member` role an org-scoped entitlement such as `branding`. Manager plans are
   organization plans mirrored onto the buyer (#228), so a manager's
   `personal_plan_key` adds nothing in an org
   (`personalPlanApplies()`, `packages/server/src/services/personal-plan.ts`).
4. **User overrides** — an active `user_feature_overrides` row is the final word
   on its key in both directions (D26). Rows with `expires_at` in the past stay
   in the table for audit but are ignored.
5. **Kill switch** — `entitlement_flags.is_enabled = false` removes a surface
   key for everyone; a **missing row fails closed** (D8). Baseline keys
   (`flashcards`, `quiz`) are never gated (D9), and keys an active override owns
   are skipped (D26).
6. **Quota-0 exclusion** — an entitlement whose quota limit resolves to `0` is
   not effective, so the API and the UI agree.

## Limit resolution

`getEffectiveLimit(ctx, limitKey)` — `packages/server/src/services/limits.ts`,
a wrapper over the single resolver's composed `limits`
(`packages/server/src/services/entitlement.resolver.ts`, `composeLimits`).

> **2026-11-21 (phase 3b, ADR-0015 §6.2):** the seat is no longer exclusive
> (#233 Q1/Q3 reversed for user-scope keys): per-member keys now take
> `max(org, seat, personal)` with `-1` short-circuiting, so a `base` seat in a
> `hub` org keeps the hub allowance instead of the seat's `0`. Membership is
> verified before the seat plan is consulted, so a forged `active_org_id`
> plus a stale seat row resolves the personal plan (user keys) / `0` (org
> keys), never the seat's values. The resolution is batched — one
> `plan_entitlements` and one `plan_limits` read per resolution — at most
> seven queries in total.

**Rule (#233, org scope unchanged):** org-scope capacity (`scope: 'org'`) always
comes from the verified organization's plan — no seat and no personal plan can
widen it. Per-member keys (`scope: 'user'`) take the most permissive layer:
`max(org, seat, personal)`, so an org on the free tier never undercuts a plan
the member bought. A manager's personal plan is excluded inside an org — it
mirrors an org purchase (#228). A missing `plan_limits` row is `0` (blocked) in
every path.

| Context                                          | `scope: 'user'` keys               | `scope: 'org'` keys            |
| ------------------------------------------------ | ---------------------------------- | ------------------------------ |
| No active org                                    | personal plan                      | `0` (no org capacity to grant) |
| Active org, seated verified member               | max(org, seat, personal)           | org plan                       |
| Active org, unseated verified member             | max(org, personal)                 | org plan                       |
| Active org, manager (personal plan is a mirror)  | max(org, seat) (personal excluded) | org plan                       |
| Active org id without membership (forged cookie) | personal plan                      | `0`                            |
| Plan lacks the key                               | `0` + `warn()`                     | `0` + `warn()`                 |

`ctx.activeOrgId` comes from a client cookie, so the resolver verifies the
`org_members` row before treating it as a tenant scope — and before reading the
seat plan: a spoofed org id has no row and falls back to the personal plan
(user keys) or `0` (org keys), ignoring any stale seat row.

**Managers (#228):** a manager has no paid personal plan — their
`profiles.personal_plan_key` is the free tier. In a verified org a manager
therefore resolves limits from `max(org, seat)` — personal excluded — and never
from their personal key — it is a mirror of an org plan, never a second
entitlement (#228); the free personal tier applies only when there is no active
org. A manager carrying a paid org plan in `personal_plan_key` from an old
purchase cannot widen any org's limits.

`checkOrgLimit(orgId, limitKey, count, increment, client?)`
resolves **only** the org's plan and treats a missing `plan_limits` row as `0`
(blocked). An unknown organization throws `NOT_FOUND` (404). It is used before
the caller is a member — invite accept (`max_students`, with the service-role
client) — and for org-scoped group creation (`max_groups`).

Content counts follow the same scope rule: for `max_flashcards`, `max_decks`,
`max_questions` and `max_question_banks` the count inside an org is
`created_by = caller AND organization_id = active org`, so personal-space
content never consumes org capacity. Outside an org it is the caller's content
(`created_by` only). `max_quiz_attempts_per_day` and `max_ai_tokens_per_day`
already count per user.

## Plan display (`GET /api/v1/me/plan`)

`SubscriptionPlanService.getMyPlan(ctx)` —
`packages/server/src/services/subscription-plan.service.ts`

The plan page must show the plan the caller's limits and features are actually
resolved from, so `key` follows the same precedence as the resolvers — all three
layers now membership-verified through the single resolver (phase 3b):

1. **Seated student/educator in a verified org** → the seat plan
   (`org_seat_assignments` → `org_seat_pools.plan_key`). The seat feature
   upgrade (#270) is unchanged.
2. **Manager in a verified org** → `organizations.plan`. Managers are the org's
   billing contact, so they keep seeing the org subscription (#181). An
   organization purchase changes only `organizations.plan`: it never writes the
   buyer's `personal_plan_key` (#228), so the manager's personal plan stays the
   free tier outside an organization. Inside a verified org personal never
   applies and `organizations.plan` is NOT NULL, so there is no personal
   fallback on this path.
3. **Everyone else (or no active org)** → `profiles.personal_plan_key`. An
   unseated member's `active_org_id` membership never replaces their personal
   plan on this page (#181).

> **2026-11-21 (phase 3b, D28):** `key` keeps the single-plan value above, but
> `features` and `limits` are now the **effective** resolved set/limits
> (`max(org, seat, personal)` for user-scope keys), and the response carries the
> additive `sources` array naming every layer that contributed. A forged
> `active_org_id` with a stale seat row resolves the personal plan here too.
> The current-plan card on `/app/billing` and `/edu/billing` names one plan, so
> it renders that plan's **catalogue** row for `key` (features and limits), not
> this effective union; it shows no lists while the catalogue is unavailable.

Plan display is still a single `key`, not the union: an unseated member's
limits can come from the org plan while this page shows their personal plan
(#181/#270).

The organization ladder on `/pricing?audience=organization` badges its "current
plan" from the same precedence (#228): a manager reads `/api/v1/me/plan` (the
active org's plan), while students/educators keep reading `/api/v1/me/personal-plan`.

Value semantics:

| Value | Meaning                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------- |
| `-1`  | Unlimited.                                                                                                |
| `0`   | No limit row defined for that plan — blocked in **both** paths (`getEffectiveLimit` and `checkOrgLimit`). |
| `> 0` | Hard cap; `current + increment > value` throws `USAGE_LIMIT_EXCEEDED` (HTTP 429).                         |

Enforcement points:

| Limit key                   | Checked in                                    |
| --------------------------- | --------------------------------------------- |
| `max_flashcards`            | `flashcard.service` (create + bulk)           |
| `max_decks`                 | `flashcard-deck.service`                      |
| `max_questions`             | `question.service`                            |
| `max_question_banks`        | `question-bank.service` (create + bulk)       |
| `max_quiz_attempts_per_day` | `quiz.service`                                |
| `max_groups`                | `group.service` (`checkOrgLimit`)             |
| `max_students`              | `invitation.service` accept (`checkOrgLimit`) |
| `max_ai_tokens_per_day`     | `/api/v1/ai/chat` via `getUsage`              |

`getUsage(ctx, key)` returns `{ current, limit, plan, resetsAt }`; `current` is
today's `user_daily_activity.ai_input_tokens + ai_output_tokens`, `plan` is the
caller's `profiles.personal_plan_key` (for a manager the free `launch` tier
unless a legacy purchase row is still present), and `resetsAt` is the next UTC
midnight.

Client caches can lag server enforcement: `useApiQuery` defaults to
`staleTime: Infinity`, so the UI may keep showing an old count/quota until it
refetches. Resolution itself is immediate.

## Where to change plan data

- **Templates** — `supabase/seeds/00_plans.sql`. `bun run env:reset-db --yes` rewrites
  `plan_entitlements` / `plan_limits`, discarding runtime edits.
- **Runtime** — admin app: `GET/POST /api/v1/plan-limits`,
  `PUT/DELETE /api/v1/plan-limits/[id]` (id, not plan key). For
  `plan-features` the routes are `GET/POST /api/v1/plan-features` and
  `DELETE /api/v1/plan-features/[id]` (no update — remove and re-add). The
  admin UI at `/subscription-plans` currently shows limits read-only.
- **Org plan** — `change_org_plan(org_id, plan)` (service-role only) moves
  `organizations.plan`; changing the column directly has the same effect.

## Tests

- `__tests__/integration/limits-resolution.test.ts` — limits follow
  `organizations.plan` changes made **without** `change_org_plan()`, a spoofed
  `active_org_id` cookie does not grant org capacity, and the #233 precedence
  matrix (personal plan never raises org capacity).
- `__tests__/integration/change-org-plan.test.ts` — the plan RPC moves only
  `organizations.plan`, writes no feature rows, and preserves a revoke row.
- `__tests__/integration/plan-limit-catalog.test.ts` — every active plan
  defines every required limit key (#233 fail-closed catalog guard).
- `__tests__/integration/limit-count-scope.test.ts` — org-context content
  counts exclude personal-space content (#233).
- `__tests__/integration/plan-limit-enforcement.test.ts` /
  `plan-limits.test.ts` — HTTP enforcement paths.
- `__tests__/integration/org-features.test.ts` — seat/role feature resolution.
