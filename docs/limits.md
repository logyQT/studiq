# Plans, Features & Limits

> Canonical reference for plan entitlements and quota resolution (#232).
> Historical design: [`plans/archive/org-features-and-limits.md`](plans/archive/org-features-and-limits.md).
> Last updated: 2026-10-25.

## Summary

A plan is a **template**: `plan_features` and `plan_limits` rows keyed by
`plan_key`. Users and orgs _point at_ a plan (`profiles.personal_plan_key`,
`organizations.plan`); they never get a private copy of its limits.

- **Features** are snapshotted per org role into `org_role_features` at org
  creation and re-synced by `apply_org_plan()` on a plan change.
- **Limits** are **never copied**. Every check reads the relevant plan's
  `plan_limits` row live.
- There is **no** `org_limits` table (dropped in #229), no per-org limit
  override, and no per-user limit override.
- Writing a `plan_limits.limit_value` (SQL, or the admin app's
  `PUT /api/v1/plan-limits/[id]`) takes effect on the **next request for every
  existing org and user on that plan** — no backfill, no restart, no per-org
  snapshot to refresh. The same is true of changing `organizations.plan`.

## Data model

| Table / column                                                          | Meaning                                                                                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `subscription_plans`                                                    | Plan catalog (`key`, name, price, `for_account_type`).                                                                            |
| `plan_features (plan_key, feature_key)`                                 | Feature template for a plan.                                                                                                      |
| `plan_limits (plan_key, limit_key, limit_value)`                        | Limit template for a plan. `-1` = unlimited.                                                                                      |
| `profiles.personal_plan_key`                                            | Personal plan (seed default `base`; managers default to the free `launch` tier). An organization purchase never writes it (#228). |
| `organizations.plan`                                                    | Organization plan (seed default `launch`).                                                                                        |
| `org_role_features (org_role_id, feature_key, is_enabled)`              | Per-org-role feature snapshot.                                                                                                    |
| `org_seat_pools` / `org_seat_assignments`                               | Opt-in per-user seat; the pool's `plan_key` is the seat plan.                                                                     |
| `user_feature_overrides (user_id, feature_key, is_enabled, expires_at)` | Strongest feature layer; expired rows are ignored.                                                                                |
| `feature_flags (key, is_enabled, rollout_percentage)`                   | Global kill switch + rollout gate.                                                                                                |

The `base` / `launch` defaults come from the seed
(`supabase/seeds/00_plans.sql` → `ALTER TABLE … SET DEFAULT`), not from the
original table migrations.

Feature keys: `FEATURES` in
`packages/server/src/services/feature.resolver.ts` (`ai.chat`, `flashcards`,
`quiz`, `quiz.builder`, `documents`, `org.manage`, `group.manage`,
`member.manage`, `role.builder`, `advanced.stats`, `branding`).

Limit keys: `LIMITS` in
`packages/server/src/services/limit.catalog.ts` — the single source of truth
for both the resolver and the DB rows:

| Scope                     | Keys                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `user` (per-member)       | `max_flashcards`, `max_decks`, `max_questions`, `max_question_banks`, `max_quiz_attempts_per_day`, `max_ai_tokens_per_day` |
| `org` (organization-wide) | `max_students`, `max_groups`                                                                                               |

## Plan-template propagation

`handle_new_organization()` — org creation
(`supabase/migrations/20261024151122_drop_org_limits.sql`):

1. creates the `admin` / `teacher` / `member` system roles;
2. seeds their RBAC permissions;
3. copies `plan_features` for the org's plan into `org_role_features`:
   admin = all; teacher = all except `member.manage` / `role.builder`;
   member = `flashcards`, `quiz`, `ai.chat`, `documents`, `branding`.

It copies **no limits** and creates **no seat pools** (pools are created
on demand since Phase B.5).

`apply_org_plan(org_id, plan)` — plan change:

1. updates `organizations.plan`;
2. deletes from every role any feature the new plan does not include
   (`org.manage` is kept — it marks an org admin);
3. adds the new plan's features to the system roles (existing rows and
   `is_enabled` toggles are preserved via `ON CONFLICT DO NOTHING`).

Limits need no step: the next check already reads the new plan's rows.

Because features are snapshotted, editing `plan_features` does **not** change
existing orgs until `apply_org_plan()` runs; editing `plan_limits` does.
Personal plans are never snapshotted — features and limits both resolve from
the template on every request.

## Feature resolution

`FeatureResolver.resolveFeatures(ctx)` —
`packages/server/src/services/feature.resolver.ts`

1. **Plan entitlement**
   - No `activeOrgId` → skip to the personal fallback.
   - Seated (`org_seat_assignments` via `getSeatPlanKey`): start from the role's
     `org_role_features` (if any), then add the seat plan's `plan_features`.
     Strip `org.manage`, `member.manage`, `role.builder` unless the role already
     has `org.manage`.
   - Not seated, role has `org_role_features` rows: those rows are
     authoritative (a missing key is off).
   - Not seated, role has no rows (custom role): `organizations.plan` →
     `plan_features`.
2. **Personal plan** — always applied on top of the entitlement above:
   `profiles.personal_plan_key` → `plan_features`. A plan the member pays for
   personally is never shadowed by an org on a lower tier — a student on StudiQ
   Pro inside a free `launch` org keeps `ai.chat`. Inside an org the admin-only
   keys (`org.manage`, `member.manage`, `role.builder`) are stripped for
   non-admin roles, so a purchase can never escalate structure privileges.
   Manager plans are organization plans mirrored onto the buyer (#228), so a
   manager's `personal_plan_key` adds nothing in an org
   (`personalPlanApplies()`, `packages/server/src/services/personal-plan.ts`).
3. **User overrides** — active `user_feature_overrides` rows add/remove keys.
   Rows with `expires_at` in the past stay in the table for audit but are
   ignored.
4. **Rollout** — `feature_flags.rollout_percentage < 100` gates
   deterministically per `(key, user_id)`.
5. **Kill switch** — `feature_flags.is_enabled = false` removes the key for
   everyone.

## Limit resolution

`LimitsResolver.getEffectiveLimit(ctx, limitKey)` —
`packages/server/src/services/limits.resolver.ts`

**Rule (#233):** org-scope capacity (`scope: 'org'`) always comes from the
organization's plan — no seat and no personal plan can widen it. Per-member keys
(`scope: 'user'`) take the most permissive layer: a seat governs for the seated
member (Q3), otherwise the higher of the member's personal plan and the org plan
wins, so an org on the free tier never undercuts a plan the member bought. A
manager's personal plan is excluded inside an org — it mirrors an org purchase
(#228). A missing `plan_limits` row is `0` (blocked) in every path.

| Context                                          | `scope: 'user'` keys | `scope: 'org'` keys            |
| ------------------------------------------------ | -------------------- | ------------------------------ |
| No active org                                    | personal plan        | `0` (no org capacity to grant) |
| Active org, seated                               | seat plan            | org plan                       |
| Active org, unseated verified member             | personal ∪ org plan  | org plan                       |
| Active org, manager (personal plan is a mirror)  | org plan             | org plan                       |
| Active org id without membership (forged cookie) | personal plan        | `0`                            |
| Plan lacks the key                               | `0` + `warn()`       | `0` + `warn()`                 |

`ctx.activeOrgId` comes from a client cookie, so the resolver verifies the
`org_members` row before treating it as a tenant scope: a spoofed org id has no
row and falls back to the personal plan (user keys) or `0` (org keys).

**Managers (#228):** a manager has no paid personal plan — their
`profiles.personal_plan_key` is the free `launch` tier. In a verified org a
manager therefore resolves limits from the org plan only — their personal key is
a mirror of an org plan, never a second entitlement (#228; a seat still governs
per-member keys); the free personal tier applies only when there is no active
org. A manager carrying a paid org plan in `personal_plan_key` from an old
purchase cannot widen any org's limits.

`LimitsResolver.checkOrgLimit(orgId, limitKey, count, increment, client?)`
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
resolved from, so it follows the same precedence as the resolvers:

1. **Seated student/educator in the active org** → the seat plan
   (`getSeatPlanKey` → `org_seat_pools.plan_key`). The page then shows that
   plan's `plan_features` / `plan_limits`, matching the seat's per-member limit
   resolution (#233) and the seat feature upgrade (#270).
2. **Manager in the active org** → `organizations.plan`, falling back to the
   manager's personal plan when the org has no plan row. Managers are the org's
   billing contact, so they keep seeing the org subscription (#181). An
   organization purchase changes only `organizations.plan`: it never writes the
   buyer's `personal_plan_key` (#228), so the fallback is the manager's own free
   `launch` tier, not the org plan they just bought.
3. **Everyone else (or no active org)** → `profiles.personal_plan_key`. An
   unseated member's `active_org_id` membership never replaces their personal
   plan on this page (#181).

Plan display is a single plan, not the effective union/max: an unseated
member's limits come from the org plan while this page shows their personal
plan, and a seated member's features are `org role features ∪ seat plan
features`, so the displayed plan can be narrower than enforcement in those
mixes (#181/#270).

`/pricing/org` badges its "current plan" from the same precedence (#228): a
manager reads `/api/v1/me/plan` (the active org's plan), while
students/educators keep reading `/api/v1/me/personal-plan`.

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

- **Templates** — `supabase/seeds/00_plans.sql`. `bunx supabase db reset`
  rewrites `plan_features` / `plan_limits`, discarding runtime edits.
- **Runtime** — admin app: `GET/POST /api/v1/plan-limits`,
  `PUT/DELETE /api/v1/plan-limits/[id]` (id, not plan key). For
  `plan-features` the routes are `GET/POST /api/v1/plan-features` and
  `DELETE /api/v1/plan-features/[id]` (no update — remove and re-add). The
  admin UI at `/subscription-plans` currently shows limits read-only.
- **Org plan** — `apply_org_plan(org_id, plan)` (service-role only); changing
  `organizations.plan` on its own also changes limits immediately, but skips
  the feature re-sync.

## Tests

- `__tests__/integration/limits-resolution.test.ts` — limits follow
  `organizations.plan` changes made **without** `apply_org_plan()`, a spoofed
  `active_org_id` cookie does not grant org capacity, and the #233 precedence
  matrix (personal plan never raises org capacity).
- `__tests__/integration/plan-limit-catalog.test.ts` — every active plan
  defines every required limit key (#233 fail-closed catalog guard).
- `__tests__/integration/limit-count-scope.test.ts` — org-context content
  counts exclude personal-space content (#233).
- `__tests__/integration/plan-limit-enforcement.test.ts` /
  `plan-limits.test.ts` — HTTP enforcement paths.
- `__tests__/integration/org-features.test.ts` — seat/role feature resolution.
