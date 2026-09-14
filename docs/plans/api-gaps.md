# API Gaps & Defects surfaced by the API-first `before()` helper

Status: ACTIVE
Updated: 2026-09-14 (D1 + org-create shape gap FIXED)

Source of truth: `__tests__/helpers/test-user.ts` (`seedViaApi`). Everything below is
either (a) an endpoint that does not exist yet → helper falls back to service-role DB access,
or (b) a defect discovered while routing seeding through the real API → workaround in helper +
ticket for the fix.

## Fixed defects (closed 2026-09-14)

### D1 — Invite accept blocked for `base`-plan users (429 USAGE_LIMIT_EXCEEDED) — FIXED

- Cause: `getEffectiveLimit(ctx, 'max_students')` resolved limits from the *accepting
  student's* personal plan (`base` has no `max_students` row) → `[]` → `0` → blocked.
- Fix: new `PlanResolver.checkOrgLimit(orgId, key, count)` — capacity resolved against the
  invitation's **organization** (org `plan` → `plan_limits`, plus `org_limits` override,
  default `-1`). `acceptInvitation` now uses it. `regression: invite-accept.test.ts`,
  members suite exercises the real accept route (seed fallback removed).

### D2-ish — Bulk invite 422 `VALIDATION_UUID_INVALID` — FIXED

- Cause: onboarding (`setup/classroom/page.tsx`) sent `targetOrgRoleId: 'member'` (role
  NAME), while backend requires the org_role UUID; org create never returned those ids.
- Fix: `createAndJoin` now returns `teacherRoleId`, `memberRoleId`, `defaultGroupId`
  (alongside `adminRoleId`); onboarding sends `memberRoleId`.
  `regression: organization-create.test.ts`, `invite-accept.test.ts`.

## Gaps (no route exists) → DB fallback in helper

| Item | API gap | Helper workaround |
|------|---------|-------------------|
| Question banks | No `POST /api/v1/question-banks` | Service-role insert (`question_banks`) before creating questions |
| Subjects | No subject create route | Service-role insert (not yet used by helper — add when a subject is needed) |

### Minor API shape gaps (route exists but response is incomplete)

- `POST /api/v1/organization/invites` returns `inviteLink` only when
  `NODE_ENV === 'development'`. In tests it is `undefined`, so the helper reads the token
  from the `invitations` table. Suggest: always return the token/link (it is already
  env-gated for prod; exposing token helps API consumers).

## Open plan-config observations

### O1 — New org group limit is 1 (`max_groups`)

- The `launch` plan (`organizations.plan` default) has `max_groups: 1`, so an org owner can
  create only 1 group total. Creating 2+ groups via API → `429`. Capacity gap for tests
  that need several groups; helper currently fails loudly (do not silently skip).
- Deliberately left as-is: this is plan-template configuration, not a code defect. If it
  blocks product flows, raise `max_groups` in `00_plans.sql` / org plan.

## Not defects (seeding notes)

- Email confirmation is NOT auto-enabled for registered accounts — the helper confirms via
  service-role `auth.admin.updateUserById(id, { email_confirm: true })` (documented bridge).
- `profiles.personal_plan_key` defaults to `base` (from `00_plans.sql`) — no per-user plan
  seeding needed for runs.