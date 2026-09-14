# Foundation & Agentic Testing — Execution Plan (Tracking)

Status: ACTIVE
Last updated: 2026-09-14

## Decisions (locked)

- Monorepo 2 apps: `packages/authz` + `packages/ui` + `apps/web` + `apps/admin`
- Admin auth: app-level signed header (Ed25519 PEM keypair, verified in admin proxy)
- Tests: API-first `before()` seeding everywhere
- Feature-flag keys: flat keys everywhere (drop `FEATURE_FLAG_TO_FEATURE_KEY`)
- No backward-compat layers (pre-market, delete old paths cleanly)

## Order

- Phase A first (independent, immediate value)
- Phase B before Phase C (de-tangle before moving code into packages)
- Phase D last (runs on the stable foundation)

---

## Phase A — Reusable API-first `before()` (test foundation)

Status: IN PROGRESS (helper built + proof migrated + verification baseline captured; bulk suite migration pending)

### Verification baseline (2026-09-14)
- `bun run lint` — clean (typecheck + biome 629 files)
- `bun test:unit` — 580/580 green
- `bun test:integration` — **pre-existing red**, identical before/after this work:
  `8 failed | 9 passed, 70 failed | 111 passed (181)` — failures are DB drift vs old
  seed helpers (`questions.bank_id` NOT NULL, missing `launch` seat pool, etc.), not caused
  by the helper migration. Members suite (migrated to `before()`) passes 10/10.
- After onboarding fixes: `8 failed | 10 passed, 70 failed | 114 passed (184)` — same 8
  pre-existing failing files untouched; new green coverage from the fix regression tests.

### Onboarding blockers fixed (2026-09-14)
- 422 bulk invite (`targetOrgRoleId: 'member'` hardcoded name) — `createAndJoin` now returns
  `teacherRoleId`/`memberRoleId`/`defaultGroupId`; onboarding sends `memberRoleId`.
- 429 invite accept for fresh `base`-plan students — new `PlanResolver.checkOrgLimit()`
  resolves capacity from the invitation's org instead of the student's personal plan;
  accept now uses it; seed fallback removed. Regressions: `invite-accept.test.ts`,
  `organization-create.test.ts` (response shape), `members.test.ts` (real accept path).
- Details: `docs/plans/api-gaps.md`.

### Goals
- `__tests__/helpers/test-user.ts`: `before(profile)` — idempotent account creation + API-driven seeding
- Confirm-email bridge (service-role `auth.admin.updateUserById`)
- Migrate suites off direct service-role seeding
- Track API gaps (`api-gaps.md`) for routes that don't exist yet

### Tasks
- [x] `createTestUser({ role, email? })` — lookup → register API → confirm → `mockUser()`
- [x] `seedViaApi({ org, groups, members, questions, decks, flashcards, topics, quizzes, assignment })`
- [x] `before(profile)` orchestrator returning `{ user, orgId, groups, createdByIds }`
- [x] API-gap bridge (banks, `subjects`, direct member-add) + `api-gaps.md`
- [x] Migrate `members.test.ts` as proof (10/10 green) — defects surfaced: invite accept 429, group limit 1
- [ ] Migrate remaining integration suites (bulk) to `before()`
- [ ] Verify: `bun test:unit` + `bun test:integration` green

---

## Phase B — Decouple flags / perms / limits

Status: NOT STARTED

### Tasks
- [ ] B1 Flat canonical keys everywhere; delete `FEATURE_FLAG_TO_FEATURE_KEY`
- [ ] B2 `FeatureResolver`: user override → org_role override → plan entitlement → rollout% → global flag
- [ ] B3 Make `rollout_percentage` live (deterministic user_id bucketing + `X-Feature-Rollout` header)
- [ ] B4 Enforce `feature_permissions` (flag ⟹ required perms) or drop table
- [ ] B5 Split limits out of `PlanResolver` → `LimitsResolver`
- [ ] B6 Client: `useFeature()` + `usePermission()`; delete `useCan`
- [ ] B7 Split `/api/v1/permissions/me` → `/permissions/me` + `/features/me`
- [ ] B8 Unify `@/lib/access.ts` + `@/lib/rbac.ts` → one `@/lib/authz`; delete `rbac.ts`
- [ ] B9 Admin Rollout Control page (global / % / plan matrix / overrides + "Stop now")
- [ ] B10 Fix broken admin: `/admin/permissions` (dropped table), `/admin/error-logs` route, `/admin/ai` dead link
- [ ] Verify: unit tests for FeatureResolver precedence + rollout, RBAC union tests, lint, full suite green

---

## Phase C — Detach admin panel (monorepo)

Status: NOT STARTED

### Tasks
- [ ] C1 Bun workspace scaffold; create `packages/authz`, `packages/ui`
- [ ] C2 Move pure logic/constants/authz → `packages/authz`; UI primitives + shared layout → `packages/ui`
- [ ] C3 `apps/web`: remove admin; block `/admin*` + `/api/v1/admin*` in proxy
- [ ] C4 `apps/admin`: standalone Next app; own build/domain; service-role server-side session
- [ ] C5 PEM gate in `apps/admin/proxy.ts` (Ed25519, header signature, rotation list)
- [ ] C6 Split i18n `Admin*` namespaces into `apps/admin`
- [ ] C7 Two standalone builds; edge routing for `/admin*`
- [ ] C8 Hardening: introduce RLS on user content tables (biggest security gap today)
- [ ] Verify: PEM-gated admin smoke, main-app 404/403 on `/admin*`, all tests in both apps

---

## Phase D — Agentic testing on the foundation

Status: NOT STARTED

### Tasks
- [ ] D1 Manifest `tests/features/manifest.yaml` (roles, routes, flags, plan, before(profile))
- [ ] D2 Generator → deterministic matrix + smoke specs (LLM-free)
- [ ] D3 Agent loop (existing `LLM_*` endpoint + AI SDK tools): fill interactive specs, run, triage
- [ ] D4 Rollout tests first-class ("disable `quiz` → student loses access; re-enable → restored")
- [ ] D5 Classification: bug / vision-drift / flaky; fixes on a branch for review

---

## Definitions of Done (global)
- `bun run lint` clean in all packages
- All unit + integration tests green
- No orphan tables/dead code left (per AGENTS.md ethos)